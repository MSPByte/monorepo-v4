import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getCatalogDb, getTenantServiceDbByOrgId, organization } from "@mspbyte/drizzle-catalog";
import { integrationLinks, integrations, syncContext, syncRuns } from "@mspbyte/drizzle";
import {
  assertBullMqName,
  ingestionRootJobId,
  orgQueueName,
  QUEUES,
  type IngestionJobData,
  type SyncMode,
} from "@mspbyte/pipeline";
import { INTEGRATIONS, type FacetSyncConfig, type ProviderId } from "@mspbyte/shared";
import { canProcessOrg, env, hasMicrosoftCredentials, requireEncryptionKey } from "./env.js";
import { logger } from "./logger.js";
import type { RedisConnection } from "./redis.js";
import { maybeGetAdapter } from "./adapters/registry.js";

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

export async function scheduleDueIngestion(
  redis: RedisConnection,
  triggerType: TriggerType = "scheduled",
): Promise<void> {
  const catalogDb = getCatalogDb(env.CATALOG_DATABASE_URL);
  const orgs = await catalogDb
    .select({ id: organization.id, isDev: organization.isDev })
    .from(organization)
    .where(activeOrgWhere());

  logger.info("Scanning active organizations for due ingestion work", {
    orgCount: orgs.length,
    requireDevOrgs: env.REQUIRE_DEV_ORGS,
    runtimeEnvironment: env.RUNTIME_ENVIRONMENT,
  });

  for (const org of orgs) {
    const tenant = await getTenantServiceDbByOrgId(org.id, requireEncryptionKey(), env.CATALOG_DATABASE_URL);
    const rows = await listActiveLinks(tenant.db);

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

      for (const type of adapter.types) {
        if (await hasActiveRun(tenant.db, row.link.id, type)) continue;

        const decision = await decideSyncMode(tenant.db, row.link.id, row.link.integrationId, type);
        if (!decision.due) continue;

        await enqueueIngestionForLink(redis, tenant.db, {
          orgId: org.id,
          link: row.link,
          integrationConfig: row.integrationConfig,
          type,
          mode: decision.mode,
          cursor: decision.cursor,
          triggerType,
        });
      }
    }
  }
}

export async function enqueueManualIngestion(
  redis: RedisConnection,
  params: EnqueueIngestionParams,
): Promise<{ syncRunId: string; jobId: string }> {
  await assertOrgCanBeProcessed(params.orgId);

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

  if (!params.force && (await hasActiveRun(tenant.db, params.linkId, params.type))) {
    throw new Error(`An ingestion run is already active for link ${params.linkId}`);
  }

  const mode = params.mode ?? "full";
  const cursor =
    mode === "incremental"
      ? await getStoredCursor(tenant.db, params.linkId, row.link.integrationId, params.type)
      : undefined;

  return enqueueIngestionForLink(redis, tenant.db, {
    orgId: params.orgId,
    link: row.link,
    integrationConfig: row.integrationConfig,
    type: params.type,
    mode,
    cursor,
    triggerType: params.triggerType ?? "manual",
  });
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
  const filters = [eq(organization.status, "active")];

  if (env.REQUIRE_DEV_ORGS) filters.push(eq(organization.isDev, true));
  if (env.TARGET_ORG_IDS.length > 0) {
    filters.push(inArray(organization.id, env.TARGET_ORG_IDS));
  }

  return and(...filters);
}

async function assertOrgCanBeProcessed(orgId: string): Promise<void> {
  const catalogDb = getCatalogDb(env.CATALOG_DATABASE_URL);
  const [org] = await catalogDb
    .select({
      id: organization.id,
      isDev: organization.isDev,
      status: organization.status,
    })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  if (!org) throw new Error(`Org not found: ${orgId}`);
  if (org.status !== "active") throw new Error(`Org is not active: ${orgId}`);
  if (!canProcessOrg(org)) {
    throw new Error(
      `Org ${orgId} is not marked is_dev; ingestion is restricted to development orgs in ${env.RUNTIME_ENVIRONMENT}`,
    );
  }
}

async function enqueueIngestionForLink(
  redis: RedisConnection,
  db: Db,
  params: {
    orgId: string;
    link: typeof integrationLinks.$inferSelect;
    integrationConfig: unknown;
    type: string;
    mode: SyncMode;
    cursor?: string;
    triggerType: TriggerType;
  },
): Promise<{ syncRunId: string; jobId: string }> {
  const ingestionRunId = randomUUID();
  const bullmqJobId = ingestionRootJobId(params.link.id, ingestionRunId);

  const [syncRun] = await db
    .insert(syncRuns)
    .values({
      linkId: params.link.id,
      integrationId: params.link.integrationId,
      bullmqJobId,
      type: params.type,
      status: "pending",
      mode: params.mode,
      startedAt: new Date().toISOString(),
    })
    .returning({ id: syncRuns.id });

  const queueName = orgQueueName(QUEUES.INGEST, params.orgId);
  const queue = new Queue<IngestionJobData, { syncRunId: string; jobId: string }, string>(queueName, {
    connection: redis as never,
  });

  try {
    const jobName = assertBullMqName(
      `ingest_${params.link.integrationId}_${params.type}_${syncRun.id}`,
      "BullMQ job name",
    );
    const job = await queue.add(
      jobName,
      {
        orgId: params.orgId,
        linkId: params.link.id,
        siteId: params.link.siteId ?? undefined,
        integrationId: params.link.integrationId,
        provider: params.link.integrationId,
        type: params.type,
        syncRunId: syncRun.id,
        mode: params.mode,
        cursor: params.cursor,
        linkMeta: linkMetaWithExternalId(params.link.meta, params.link.externalId),
        integrationConfig: asRecord(params.integrationConfig),
      },
      {
        jobId: bullmqJobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    await db.update(syncRuns).set({ status: "queued" }).where(eq(syncRuns.id, syncRun.id));

    logger.info("Queued ingestion job", {
      orgId: params.orgId,
      linkId: params.link.id,
      integrationId: params.link.integrationId,
      type: params.type,
      mode: params.mode,
      syncRunId: syncRun.id,
      bullmqJobId: job.id,
    });

    return { syncRunId: syncRun.id, jobId: String(job.id) };
  } catch (error) {
    await db
      .update(syncRuns)
      .set({ status: "enqueue_failed", finishedAt: new Date().toISOString() })
      .where(eq(syncRuns.id, syncRun.id));
    throw error;
  } finally {
    await queue.close();
  }
}

async function hasActiveRun(db: Db, linkId: string, type: string): Promise<boolean> {
  const [run] = await db
    .select({ id: syncRuns.id, createdAt: syncRuns.createdAt })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.linkId, linkId),
        eq(syncRuns.type, type),
        inArray(syncRuns.status, ["pending", "queued", "running"]),
      ),
    )
    .limit(1);

  if (!run) return false;

  const staleBefore = Date.now() - env.ACTIVE_RUN_STALE_MS;
  if (new Date(run.createdAt).getTime() > staleBefore) return true;

  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: new Date().toISOString() })
    .where(eq(syncRuns.id, run.id));

  logger.warn("Marked stale ingestion run as failed before scheduling replacement", {
    linkId,
    type,
    syncRunId: run.id,
  });

  return false;
}

async function decideSyncMode(
  db: Db,
  linkId: string,
  integrationId: string,
  type: string,
): Promise<{ due: boolean; mode: SyncMode; cursor?: string }> {
  const syncConfig = getFacetSyncConfig(integrationId, type);
  if (syncConfig?.enabled === false) return { due: false, mode: "full" };

  const [context] = await db
    .select()
    .from(syncContext)
    .where(
      and(
        eq(syncContext.linkId, linkId),
        eq(syncContext.integrationId, integrationId),
        eq(syncContext.type, type),
      ),
    )
    .limit(1);

  if (!context?.lastSuccessAt) return { due: true, mode: "full" };

  if (!syncConfig?.supportsIncremental) {
    const intervalMs = syncConfig?.intervalMs ?? env.FULL_SYNC_INTERVAL_MS;
    return {
      due: Date.now() - dateMs(context.lastSuccessAt)! >= intervalMs,
      mode: "full",
    };
  }

  const now = Date.now();
  const fullIntervalMs = syncConfig.fullIntervalMs ?? syncConfig.intervalMs ?? env.FULL_SYNC_INTERVAL_MS;
  const incrementalIntervalMs =
    syncConfig.incrementalIntervalMs ?? syncConfig.intervalMs ?? env.INCREMENTAL_SYNC_INTERVAL_MS;
  const lastFullAt = dateMs(context.fullSyncAt);
  const lastIncrementalAt = dateMs(context.incrementalSyncAt ?? context.lastSuccessAt);

  if (!lastFullAt || now - lastFullAt >= fullIntervalMs) {
    return { due: true, mode: "full" };
  }

  if (context.cursor && (!lastIncrementalAt || now - lastIncrementalAt >= incrementalIntervalMs)) {
    return { due: true, mode: "incremental", cursor: context.cursor };
  }

  return { due: false, mode: "full" };
}

function getFacetSyncConfig(integrationId: string, type: string): FacetSyncConfig | undefined {
  const integration = INTEGRATIONS[integrationId as ProviderId];
  return integration?.supportedFacets.find((facet) => facet.facet === type)?.sync;
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

function dateMs(value: string | Date | null | undefined): number | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? undefined : time;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function linkMetaWithExternalId(
  meta: unknown,
  externalId: string | null,
): Record<string, unknown> | undefined {
  const record = asRecord(meta) ?? {};
  if (externalId && typeof record.externalId !== "string") {
    record.externalId = externalId;
  }

  return Object.keys(record).length > 0 ? record : undefined;
}
