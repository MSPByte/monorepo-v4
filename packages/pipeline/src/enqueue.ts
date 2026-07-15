import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { syncRuns, integrationLinks } from "@mspbyte/drizzle";
import {
  assertBullMqName,
  ingestionRootJobId,
  orgQueueName,
  QUEUES,
} from "./queues.js";
import type { IngestionJobData, SyncMode } from "./ingestion.js";

type Db = any;

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

export async function hasActiveIngestionRun(
  db: Db,
  linkId: string,
  type: string,
  staleAfterMs: number,
): Promise<boolean> {
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

  const staleBefore = Date.now() - staleAfterMs;
  if (new Date(run.createdAt).getTime() > staleBefore) return true;

  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: new Date().toISOString() })
    .where(eq(syncRuns.id, run.id));

  return false;
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
