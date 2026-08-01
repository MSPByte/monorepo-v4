import { and, eq, isNull } from "drizzle-orm";
import {
  getCatalogDb,
  getTenantServiceDbByOrgId,
  organization,
  pipelineOrgWhere,
} from "@mspbyte/drizzle-catalog";
import { integrationLinks, integrations, syncContext } from "@mspbyte/drizzle";
import {
  enqueueIngestionJob,
  getActiveIngestionRunTypes,
  getOrCreateQueue,
  getScheduledIngestionKeys,
  hasActiveIngestionRun,
  nextIngestionJobId,
  orgQueueName,
  QUEUES,
  scheduledKey,
  type IngestionJobData,
  type SyncMode,
} from "@mspbyte/pipeline";
import { env, hasMicrosoftCredentials, requireEncryptionKey } from "./env.js";
import { logger } from "./logger.js";
import { serializeError } from "./errors.js";
import type { RedisConnection } from "./redis.js";
import { maybeGetAdapter } from "./adapters/registry.js";
import { scheduleNextRun } from "./schedule-planner.js";

type Db = any;

export type TriggerType = "scheduled" | "manual";

export type EnqueueIngestionParams = {
  orgId: string;
  linkId: string;
  type: string;
  mode?: SyncMode;
  triggerType?: TriggerType;
  force?: boolean;
};

// Safety-net poller. In steady state, every (link, facet) already has a
// self-scheduled delayed job sitting in Redis — this scan finds and repairs
// the gaps: brand-new links, links whose settings changed, links whose
// delayed job vanished (Redis eviction, worker crashed before scheduleNextRun
// could fire, etc). Runs on a slow cadence (~5 min).
export async function scheduleDueIngestion(
  redis: RedisConnection,
  triggerType: TriggerType = "scheduled",
): Promise<void> {
  const catalogDb = getCatalogDb(env.CATALOG_DATABASE_URL);
  const orgs = await catalogDb
    .select({ id: organization.id, isDev: organization.isDev })
    .from(organization)
    .where(activeOrgWhere());

  logger.info("Safety-net scan for orgs missing scheduled ingestion", {
    orgCount: orgs.length,
    runtimeEnvironment: env.RUNTIME_ENVIRONMENT,
    triggerType,
  });

  await runWithConcurrency(orgs, env.SCHEDULE_ORG_CONCURRENCY, async (org) => {
    try {
      await scanOrg(redis, org);
    } catch (error) {
      // Isolate per-org failures so one bad tenant DB doesn't stall the whole
      // scan for the other orgs running in parallel.
      logger.error("Scheduler scan failed for organization", {
        orgId: org.id,
        error: serializeError(error),
      });
    }
  });
}

async function scanOrg(
  redis: RedisConnection,
  org: { id: string; isDev: boolean },
): Promise<void> {
  const tenant = await getTenantServiceDbByOrgId(
    org.id,
    requireEncryptionKey(),
    env.CATALOG_DATABASE_URL,
  );
  const rows = await listActiveLinks(tenant.db);
  if (rows.length === 0) return;

  // One Redis fetch per org: pull every delayed/waiting/active/paused job in
  // the ingest queue and build a Set of (linkId::facet) keys we can check
  // inline. Cheap even for hundreds of scheduled facets.
  const scheduled = await getScheduledIngestionKeys(redis, org.id);

  for (const row of rows) {
    const adapter = maybeGetAdapter(row.link.integrationId);
    if (!adapter) {
      logger.debug("Skipping integration link without registered ingestion adapter", {
        orgId: org.id,
        linkId: row.link.id,
        integrationId: row.link.integrationId,
      });
      continue;
    }

    if (!isProviderReady(row.link.integrationId)) {
      logger.warn("Skipping integration link because provider credentials are not configured", {
        orgId: org.id,
        linkId: row.link.id,
        integrationId: row.link.integrationId,
      });
      continue;
    }

    if (row.credentialExpiration && new Date(row.credentialExpiration).getTime() <= Date.now()) {
      logger.warn("Skipping integration link with expired credentials", {
        orgId: org.id,
        linkId: row.link.id,
        integrationId: row.link.integrationId,
      });
      continue;
    }

    // In-flight syncRuns block scheduling: a manual run may be executing right
    // now, and the worker's finally block will re-schedule the delayed next on
    // completion.
    const activeTypes = await getActiveIngestionRunTypes(
      tenant.db,
      row.link.id,
      env.ACTIVE_RUN_STALE_MS,
    );

    for (const facet of adapter.types) {
      if (scheduled.has(scheduledKey(row.link.id, facet))) continue;
      if (activeTypes.has(facet)) continue;

      await scheduleNextRun(redis, tenant.db, {
        orgId: org.id,
        linkId: row.link.id,
        integrationId: row.link.integrationId,
        siteId: row.link.siteId ?? undefined,
        externalId: row.link.externalId,
        linkMeta: row.link.meta,
        integrationConfig: row.integrationConfig,
        facet,
      });
    }
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

export async function enqueueManualIngestion(
  redis: RedisConnection,
  params: EnqueueIngestionParams,
): Promise<{ syncRunId: string; jobId: string }> {
  const tenant = await getTenantServiceDbByOrgId(
    params.orgId,
    requireEncryptionKey(),
    env.CATALOG_DATABASE_URL,
  );
  const [row] = await tenant.db
    .select({
      link: integrationLinks,
      integrationConfig: integrations.config,
    })
    .from(integrationLinks)
    .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
    .where(eq(integrationLinks.id, params.linkId))
    .limit(1);

  if (!row) throw new Error(`Integration link not found: ${params.linkId}`);

  const adapter = maybeGetAdapter(row.link.integrationId);
  if (!adapter) throw new Error(`No adapter registered for provider: ${row.link.integrationId}`);
  if (!adapter.types.includes(params.type)) {
    throw new Error(`Adapter ${adapter.providerId} does not support ingestion type ${params.type}`);
  }

  if (!params.force && (await hasActiveIngestionRun(tenant.db, params.linkId, params.type, env.ACTIVE_RUN_STALE_MS))) {
    throw new Error(`An ingestion run is already active for link ${params.linkId}`);
  }

  const mode = params.mode ?? "full";
  const cursor =
    mode === "incremental"
      ? await getStoredCursor(tenant.db, params.linkId, row.link.integrationId, params.type)
      : undefined;

  // Cancel any delayed "next" job for this (link, facet). Otherwise the
  // manual run + delayed next could both fire close together, doubling work.
  // The worker's finally block will re-schedule a fresh delayed next when the
  // manual run completes.
  const queue = getOrCreateQueue<IngestionJobData>(
    redis,
    orgQueueName(QUEUES.INGEST, params.orgId),
  );
  await queue.remove(nextIngestionJobId(params.linkId, params.type)).catch(() => {
    /* noop */
  });

  const result = await enqueueIngestionJob(redis, tenant.db, {
    orgId: params.orgId,
    link: row.link,
    integrationConfig: row.integrationConfig,
    type: params.type,
    mode,
    cursor,
  });

  logger.info("Queued ingestion job", {
    orgId: params.orgId,
    linkId: params.linkId,
    integrationId: row.link.integrationId,
    type: params.type,
    mode,
    syncRunId: result.syncRunId,
    bullmqJobId: result.jobId,
    triggerType: params.triggerType ?? "manual",
  });

  return result;
}

async function listActiveLinks(db: Db) {
  return db
    .select({
      link: integrationLinks,
      integrationConfig: integrations.config,
      credentialExpiration: integrations.credentialExpiration,
    })
    .from(integrationLinks)
    .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
    .where(and(eq(integrationLinks.status, "active"), isNull(integrations.deletedAt)));
}

function activeOrgWhere() {
  return pipelineOrgWhere({
    isProduction: env.IS_PRODUCTION,
    targetOrgIds: env.TARGET_ORG_IDS,
  });
}

function isProviderReady(integrationId: string): boolean {
  if (integrationId === "microsoft-365") return hasMicrosoftCredentials();
  return true;
}

async function getStoredCursor(
  db: Db,
  linkId: string,
  integrationId: string,
  type: string,
): Promise<string | undefined> {
  const [context] = await db
    .select({ cursor: syncContext.cursor })
    .from(syncContext)
    .where(
      and(
        eq(syncContext.linkId, linkId),
        eq(syncContext.integrationId, integrationId),
        eq(syncContext.type, type),
      ),
    )
    .limit(1);

  return context?.cursor ?? undefined;
}
