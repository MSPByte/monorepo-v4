import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Redis } from "ioredis";
import { syncRuns, syncRunStages, integrationLinks } from "@mspbyte/drizzle";
import {
  assertBullMqName,
  ingestionRootJobId,
  nextIngestionJobId,
  orgQueueName,
  pipelineJobPriority,
  QUEUES,
} from "./queues.js";
import { getOrCreateQueue } from "./queue-registry.js";
import type { IngestionJobData, SyncMode } from "./ingestion.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type Db = PostgresJsDatabase;

export type EnqueueIngestionJobParams = {
  orgId: string;
  link: typeof integrationLinks.$inferSelect;
  integrationConfig?: unknown;
  type: string;
  mode: SyncMode;
  cursor?: string;
};

export type EnqueueIngestionJobResult = {
  syncRunId: string;
  jobId: string;
};

export async function enqueueIngestionJob(
  redis: Redis,
  db: Db,
  params: EnqueueIngestionJobParams,
): Promise<EnqueueIngestionJobResult> {
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
    .returning({ id: syncRuns.id }) as [{ id: string }, ...{ id: string }[]];

  const queueName = orgQueueName(QUEUES.INGEST, params.orgId);
  const queue = getOrCreateQueue<IngestionJobData, { syncRunId: string; jobId: string }>(
    redis,
    queueName,
  );

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

    return { syncRunId: syncRun.id, jobId: String(job.id) };
  } catch (error) {
    await db
      .update(syncRuns)
      .set({ status: "enqueue_failed", finishedAt: new Date().toISOString() })
      .where(eq(syncRuns.id, syncRun.id));
    throw error;
  }
}

export type EnqueueNextIngestionParams = {
  orgId: string;
  linkId: string;
  integrationId: string;
  siteId?: string;
  externalId?: string | null;
  linkMeta?: unknown;
  integrationConfig?: unknown;
  type: string;
  mode: SyncMode;
  cursor?: string;
  delayMs: number;
};

// Enqueues the *next* scheduled run of an ingestion facet as a delayed
// BullMQ job. Uses a deterministic jobId so redundant enqueue attempts (from
// the worker at completion + the safety-net poller) are dedup'd. Unlike
// enqueueIngestionJob, this does not create a syncRuns row — the worker
// creates one when the job actually starts, so we don't accumulate hours-old
// "pending" rows for facets that run every few hours.
export async function enqueueNextIngestion(
  redis: Redis,
  params: EnqueueNextIngestionParams,
): Promise<{ jobId: string; delayMs: number }> {
  const queueName = orgQueueName(QUEUES.INGEST, params.orgId);
  const queue = getOrCreateQueue<IngestionJobData>(redis, queueName);
  const jobId = nextIngestionJobId(params.linkId, params.type);

  // Remove any prior scheduled entry (delayed / waiting / completed / failed)
  // so the new delay + payload actually take effect. `remove` is a no-op if
  // the job doesn't exist.
  await queue.remove(jobId).catch(() => {
    /* noop */
  });

  const jobName = assertBullMqName(
    `ingest_${params.integrationId}_${params.type}_next`,
    "BullMQ job name",
  );

  await queue.add(
    jobName,
    {
      orgId: params.orgId,
      linkId: params.linkId,
      siteId: params.siteId,
      integrationId: params.integrationId,
      provider: params.integrationId,
      type: params.type,
      mode: params.mode,
      cursor: params.cursor,
      linkMeta: linkMetaWithExternalId(params.linkMeta, params.externalId ?? null),
      integrationConfig: asRecord(params.integrationConfig),
    },
    {
      jobId,
      delay: Math.max(0, params.delayMs),
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      priority: pipelineJobPriority(params.integrationId),
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );

  return { jobId, delayMs: Math.max(0, params.delayMs) };
}

// Returns the set of (linkId, facet) tuples that already have a
// scheduled / waiting / active job in this org's ingest queue. Used by the
// safety-net poller to skip facets that don't need re-scheduling.
export async function getScheduledIngestionKeys(
  redis: Redis,
  orgId: string,
): Promise<Set<string>> {
  const queueName = orgQueueName(QUEUES.INGEST, orgId);
  const queue = getOrCreateQueue<IngestionJobData>(redis, queueName);
  const jobs = await queue.getJobs(["delayed", "waiting", "active", "paused"]);
  const keys = new Set<string>();
  for (const job of jobs) {
    if (!job?.data) continue;
    keys.add(scheduledKey(job.data.linkId, job.data.type));
  }
  return keys;
}

export function scheduledKey(linkId: string, facet: string): string {
  return `${linkId}::${facet}`;
}

export async function hasActiveIngestionRun(
  db: Db,
  linkId: string,
  type: string,
  staleAfterMs: number,
): Promise<boolean> {
  const active = await getActiveIngestionRunTypes(db, linkId, staleAfterMs);
  return active.has(type);
}

export async function reconcileStaleIngestionRuns(
  db: Db,
  staleAfterMs: number,
  params: { linkId?: string } = {},
): Promise<string[]> {
  const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
  const where = and(
    params.linkId ? eq(syncRuns.linkId, params.linkId) : undefined,
    inArray(syncRuns.status, ["pending", "queued", "running"]),
    or(
      lt(syncRuns.createdAt, staleBefore),
      and(isNull(syncRuns.createdAt), lt(syncRuns.startedAt, staleBefore)),
    ),
  );

  const staleRuns = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(where);

  const staleIds = staleRuns.map((run: { id: string }) => run.id);
  if (staleIds.length === 0) return [];

  const finishedAt = new Date().toISOString();
  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt })
    .where(inArray(syncRuns.id, staleIds));

  await db
    .update(syncRunStages)
    .set({
      status: "failed",
      finishedAt,
      error: "Marked failed after exceeding ingestion stale timeout",
    })
    .where(
      and(
        inArray(syncRunStages.syncRunId, staleIds),
        eq(syncRunStages.status, "running"),
      ),
    );

  return staleIds;
}

// Batched version of hasActiveIngestionRun — one query per link returns the
// set of facet types with an in-flight run. Stale runs are marked failed as
// a side effect so the caller sees only fresh in-flight work.
export async function getActiveIngestionRunTypes(
  db: Db,
  linkId: string,
  staleAfterMs: number,
): Promise<Set<string>> {
  await reconcileStaleIngestionRuns(db, staleAfterMs, { linkId });

  const runs = await db
    .select({ type: syncRuns.type })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.linkId, linkId),
        inArray(syncRuns.status, ["pending", "queued", "running"]),
      ),
    );
  const active = new Set<string>();
  for (const run of runs as Array<{ type: string }>) active.add(run.type);

  return active;
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
