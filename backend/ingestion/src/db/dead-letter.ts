import { eq, sql } from "drizzle-orm";
import { rawBatches, rawRecords } from "@mspbyte/drizzle";
import type { RawRecordEnvelope, SyncMode } from "@mspbyte/pipeline";
import { logger } from "../logger.js";
import { stablePayloadHash } from "./hash.js";

type Db = any;

export type DeadLetterContext = {
  syncRunId: string;
  linkId: string;
  siteId?: string;
  provider: string;
  type: string;
  mode: SyncMode;
  batchIndex: number;
};

export type PerRecordFailure = {
  externalId: string;
  op?: "upsert" | "delete";
  payload: unknown;
  error: unknown;
};

/**
 * Records per-record projection failures to the dead-letter store. The rows
 * that fail zod validation or normalization are inherently deterministic —
 * retrying won't help until the code is fixed — so we write them out on the
 * first (and every) attempt, keyed idempotently by (raw_batch_id, external_id).
 *
 * The batch row is created lazily: if no failures, no dead-letter write at all.
 */
export async function deadLetterPerRecordFailures(
  db: Db,
  context: DeadLetterContext,
  failures: readonly PerRecordFailure[],
): Promise<void> {
  if (failures.length === 0) return;

  const batchId = await ensureFailedBatch(db, context, failures.length, {
    reason: "per-record projection failures",
  });

  await insertFailedRecords(db, {
    rawBatchId: batchId,
    syncRunId: context.syncRunId,
    linkId: context.linkId,
    siteId: context.siteId,
    provider: context.provider,
    type: context.type,
    failures: failures.map((f) => ({
      externalId: f.externalId,
      op: f.op ?? "upsert",
      payload: f.payload,
      error: errorMessage(f.error),
    })),
  });

  logger.info("Dead-lettered per-record projection failures", {
    linkId: context.linkId,
    provider: context.provider,
    type: context.type,
    syncRunId: context.syncRunId,
    batchIndex: context.batchIndex,
    failedCt: failures.length,
  });
}

/**
 * Records a whole batch to the dead-letter store when projectBatch itself
 * threw (DB error, unhandled exception, etc). Called only on the final BullMQ
 * retry — transient errors are retried by the queue without dead-letter noise.
 */
export async function deadLetterBatchFailure(
  db: Db,
  context: DeadLetterContext,
  records: readonly RawRecordEnvelope[],
  error: unknown,
): Promise<void> {
  if (records.length === 0) return;

  const batchId = await ensureFailedBatch(db, context, records.length, {
    reason: errorMessage(error),
  });

  await insertFailedRecords(db, {
    rawBatchId: batchId,
    syncRunId: context.syncRunId,
    linkId: context.linkId,
    siteId: context.siteId,
    provider: context.provider,
    type: context.type,
    failures: records.map((record) => ({
      externalId: record.externalId,
      op: (record.op ?? "upsert") as "upsert" | "delete",
      payload: record.payload ?? {},
      error: errorMessage(error),
    })),
  });

  logger.warn("Dead-lettered whole batch after final retry", {
    linkId: context.linkId,
    provider: context.provider,
    type: context.type,
    syncRunId: context.syncRunId,
    batchIndex: context.batchIndex,
    recordCount: records.length,
    error: errorMessage(error),
  });
}

async function ensureFailedBatch(
  db: Db,
  context: DeadLetterContext,
  recordCount: number,
  opts: { reason: string },
): Promise<string> {
  const [row] = await db
    .insert(rawBatches)
    .values({
      syncRunId: context.syncRunId,
      linkId: context.linkId,
      siteId: context.siteId,
      provider: context.provider,
      type: context.type,
      mode: context.mode,
      batchIndex: context.batchIndex,
      recordCount,
      status: "failed",
      projectionError: opts.reason,
      projectedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [
        rawBatches.syncRunId,
        rawBatches.linkId,
        rawBatches.type,
        rawBatches.batchIndex,
      ],
      set: {
        recordCount,
        status: "failed",
        projectionError: opts.reason,
        projectedAt: new Date().toISOString(),
      },
    })
    .returning({ id: rawBatches.id });
  return row.id;
}

async function insertFailedRecords(
  db: Db,
  params: {
    rawBatchId: string;
    syncRunId: string;
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
    failures: Array<{
      externalId: string;
      op: "upsert" | "delete";
      payload: unknown;
      error: string;
    }>;
  },
): Promise<void> {
  if (params.failures.length === 0) return;

  const now = new Date().toISOString();
  const rows = params.failures.map((f) => {
    const payload = f.payload ?? {};
    return {
      rawBatchId: params.rawBatchId,
      syncRunId: params.syncRunId,
      linkId: params.linkId,
      siteId: params.siteId,
      provider: params.provider,
      type: params.type,
      externalId: f.externalId,
      op: f.op,
      schemaVersion: "1",
      payloadHash: stablePayloadHash(payload),
      payload,
      projectionStatus: "failed",
      projectionError: f.error,
      projectedAt: now,
    };
  });

  await db
    .insert(rawRecords)
    .values(rows)
    .onConflictDoUpdate({
      target: [rawRecords.rawBatchId, rawRecords.externalId],
      set: {
        op: sql`excluded.op`,
        payloadHash: sql`excluded.payload_hash`,
        payload: sql`excluded.payload`,
        projectionStatus: sql`excluded.projection_status`,
        projectionError: sql`excluded.projection_error`,
        projectedAt: sql`excluded.projected_at`,
      },
    });
}

/**
 * Marks a dead-letter record as recovered — used by the replay command after
 * a successful re-projection.
 */
export async function markRecordRecovered(
  db: Db,
  rawRecordId: string,
): Promise<void> {
  await db
    .update(rawRecords)
    .set({
      projectionStatus: "completed",
      projectionError: null,
      projectedAt: new Date().toISOString(),
    })
    .where(eq(rawRecords.id, rawRecordId));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
