import { and, eq } from "drizzle-orm";
import {
  rawBatches,
  rawRecords,
  syncContext,
  syncRuns,
  syncRunStages,
} from "@mspbyte/drizzle";
import type { RawRecordEnvelope, SyncMode } from "@mspbyte/pipeline";
import { sql } from "drizzle-orm";
import { stablePayloadHash } from "./hash.js";

type Db = any;

export type StageMetrics = {
  recordsIn?: number;
  recordsOut?: number;
  createdCt?: number;
  updatedCt?: number;
  failedCt?: number;
  metrics?: Record<string, unknown>;
};

export async function startStage(
  db: Db,
  params: {
    syncRunId: string;
    integrationId: string;
    bullmqJobId: string;
    type: string;
    stage: string;
  },
): Promise<string> {
  await db.update(syncRuns).set({ status: "running" }).where(eq(syncRuns.id, params.syncRunId));

  const [row] = await db
    .insert(syncRunStages)
    .values({
      syncRunId: params.syncRunId,
      integrationId: params.integrationId,
      bullmqJobId: params.bullmqJobId,
      type: params.type,
      stage: params.stage,
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning({ id: syncRunStages.id });

  return row.id;
}

export async function completeStage(
  db: Db,
  stageId: string,
  metrics: StageMetrics = {},
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: "completed",
      finishedAt: new Date().toISOString(),
      recordsIn: metrics.recordsIn ?? 0,
      recordsOut: metrics.recordsOut ?? 0,
      createdCt: metrics.createdCt ?? 0,
      updatedCt: metrics.updatedCt ?? 0,
      failedCt: metrics.failedCt ?? 0,
      metrics: metrics.metrics ?? null,
    })
    .where(eq(syncRunStages.id, stageId));
}

export async function failStage(db: Db, stageId: string, error: unknown): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: errorMessage(error),
    })
    .where(eq(syncRunStages.id, stageId));
}

export async function completeRun(db: Db, syncRunId: string): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: "completed", finishedAt: new Date().toISOString() })
    .where(eq(syncRuns.id, syncRunId));
}

export async function failRun(db: Db, syncRunId: string, _error: unknown): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: new Date().toISOString() })
    .where(eq(syncRuns.id, syncRunId));
}

export async function createRawBatch(
  db: Db,
  params: {
    syncRunId: string;
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
    mode: SyncMode;
    batchIndex: number;
    recordCount: number;
    cursorIn?: string;
    cursorOut?: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(rawBatches)
    .values({
      syncRunId: params.syncRunId,
      linkId: params.linkId,
      siteId: params.siteId,
      provider: params.provider,
      type: params.type,
      mode: params.mode,
      batchIndex: params.batchIndex,
      recordCount: params.recordCount,
      cursorIn: params.cursorIn,
      cursorOut: params.cursorOut,
      status: "pending",
      projectionError: null,
    })
    .onConflictDoUpdate({
      target: [rawBatches.syncRunId, rawBatches.linkId, rawBatches.type, rawBatches.batchIndex],
      set: {
        mode: params.mode,
        recordCount: params.recordCount,
        cursorIn: params.cursorIn ?? null,
        cursorOut: params.cursorOut ?? null,
        status: "pending",
        projectionError: null,
      },
    })
    .returning({ id: rawBatches.id });

  return row.id;
}

export async function insertRawRecords(
  db: Db,
  params: {
    rawBatchId: string;
    syncRunId: string;
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
    records: Array<RawRecordEnvelope>;
  },
): Promise<void> {
  if (params.records.length === 0) return;

  const rows = params.records.map((record) => {
    const payload = record.payload ?? {};

    return {
      rawBatchId: params.rawBatchId,
      syncRunId: params.syncRunId,
      linkId: params.linkId,
      siteId: params.siteId,
      provider: params.provider,
      type: params.type,
      externalId: record.externalId,
      op: record.op ?? "upsert",
      schemaVersion: record.schemaVersion ?? "1",
      payloadHash: stablePayloadHash(payload),
      payload,
      projectionStatus: "pending",
      projectionError: null,
    };
  });

  await db
    .insert(rawRecords)
    .values(rows)
    .onConflictDoUpdate({
      target: [rawRecords.rawBatchId, rawRecords.externalId],
      set: {
        op: sql`excluded.op`,
        schemaVersion: sql`excluded.schema_version`,
        payloadHash: sql`excluded.payload_hash`,
        payload: sql`excluded.payload`,
        projectionStatus: "pending",
        projectionError: null,
      },
    });
}

export async function recordFetchSuccess(
  db: Db,
  params: {
    linkId: string;
    integrationId: string;
    type: string;
    mode: SyncMode;
    cursor?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const values = {
    linkId: params.linkId,
    integrationId: params.integrationId,
    type: params.type,
    cursor: params.cursor,
    consecutiveFailures: 0,
    lastSuccessAt: now,
    fullSyncAt: params.mode === "full" ? now : undefined,
    incrementalSyncAt: params.mode === "incremental" ? now : undefined,
    updatedAt: now,
  };

  await db
    .insert(syncContext)
    .values(values)
    .onConflictDoUpdate({
      target: [syncContext.linkId, syncContext.integrationId, syncContext.type],
      set: {
        cursor: params.cursor ?? sql`${syncContext.cursor}`,
        consecutiveFailures: 0,
        lastSuccessAt: now,
        fullSyncAt: params.mode === "full" ? now : sql`${syncContext.fullSyncAt}`,
        incrementalSyncAt:
          params.mode === "incremental" ? now : sql`${syncContext.incrementalSyncAt}`,
        lastErrorClass: null,
        lastErrorMessage: null,
        updatedAt: now,
      },
    });
}

export async function recordFetchFailure(
  db: Db,
  params: {
    linkId: string;
    integrationId: string;
    type: string;
    error: unknown;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const [existing] = await db
    .select({ consecutiveFailures: syncContext.consecutiveFailures })
    .from(syncContext)
    .where(
      and(
        eq(syncContext.linkId, params.linkId),
        eq(syncContext.integrationId, params.integrationId),
        eq(syncContext.type, params.type),
      ),
    )
    .limit(1);

  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;

  await db
    .insert(syncContext)
    .values({
      linkId: params.linkId,
      integrationId: params.integrationId,
      type: params.type,
      consecutiveFailures,
      lastFailureAt: now,
      lastErrorClass: errorClass(params.error),
      lastErrorMessage: errorMessage(params.error),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [syncContext.linkId, syncContext.integrationId, syncContext.type],
      set: {
        consecutiveFailures,
        lastFailureAt: now,
        lastErrorClass: errorClass(params.error),
        lastErrorMessage: errorMessage(params.error),
        updatedAt: now,
      },
    });
}

function errorClass(error: unknown): string {
  if (error instanceof Error) return error.name;
  return "Error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
