import { and, eq, getColumns, inArray, sql } from "drizzle-orm";
import {
  rawBatches,
  rawRecords,
  syncRuns,
  syncRunStages,
  vendorTableRegistry,
  type VendorTableName,
} from "@mspbyte/drizzle";
import { getFacetTableMap } from "@mspbyte/shared";
import { logger } from "../logger.js";
import { normalizeVendorRecord } from "../normalizers/index.js";

type Db = any;

const facetTableMap = getFacetTableMap();
const skipOnUpdate = new Set(["id", "linkId", "externalId", "createdAt"]);

export type ProjectionMetrics = {
  recordsIn: number;
  recordsOut: number;
  createdCt: number;
  updatedCt: number;
  failedCt: number;
};

export async function startProjectionStage(
  db: Db,
  params: {
    syncRunId: string;
    provider: string;
    type: string;
    bullmqJobId: string;
  },
): Promise<string> {
  await db
    .update(syncRuns)
    .set({ status: "projecting" })
    .where(eq(syncRuns.id, params.syncRunId));
  const [row] = await db
    .insert(syncRunStages)
    .values({
      syncRunId: params.syncRunId,
      integrationId: params.provider,
      bullmqJobId: params.bullmqJobId,
      type: params.type,
      stage: "project",
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning({ id: syncRunStages.id });

  return row.id;
}

export async function projectRawBatch(
  db: Db,
  params: {
    orgId: string;
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
    syncRunId: string;
    rawBatchId: string;
  },
): Promise<ProjectionMetrics> {
  const sourceRows = await db
    .select({
      id: rawRecords.id,
      externalId: rawRecords.externalId,
      op: rawRecords.op,
      payloadHash: rawRecords.payloadHash,
      payload: rawRecords.payload,
    })
    .from(rawRecords)
    .where(
      and(
        eq(rawRecords.rawBatchId, params.rawBatchId),
        eq(rawRecords.projectionStatus, "pending"),
      ),
    );

  let recordsOut = 0;
  let failedCt = 0;
  let createdCt = 0;
  let updatedCt = 0;
  const failureSamples: Array<{
    rawRecordId: string;
    externalId: string;
    error: string;
  }> = [];

  for (const row of sourceRows) {
    try {
      const result =
        row.op === "delete"
          ? await projectDelete(db, params, row.externalId, row.payloadHash)
          : await projectUpsert(db, params, row.payload, row.payloadHash);

      recordsOut += result.recordsOut;
      createdCt += result.createdCt;
      updatedCt += result.updatedCt;

      await markRawRecordCompleted(db, row.id);
    } catch (error) {
      failedCt++;
      if (failureSamples.length < 5) {
        failureSamples.push({
          rawRecordId: row.id,
          externalId: row.externalId,
          error: errorMessage(error),
        });
      }
      await markRawRecordFailed(db, row.id, error);
    }
  }

  await completeRawBatch(db, params.rawBatchId, failedCt);
  await maybeCompleteRun(db, params.syncRunId);

  if (failedCt > 0) {
    logger.warn("Projection batch completed with raw record failures", {
      orgId: params.orgId,
      linkId: params.linkId,
      provider: params.provider,
      type: params.type,
      syncRunId: params.syncRunId,
      rawBatchId: params.rawBatchId,
      failedCt,
      failureSamples,
    });
  }

  return {
    recordsIn: sourceRows.length,
    recordsOut,
    createdCt,
    updatedCt,
    failedCt,
  };
}

export async function completeProjectionStage(
  db: Db,
  stageId: string,
  metrics: ProjectionMetrics,
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: "completed",
      finishedAt: new Date().toISOString(),
      recordsIn: metrics.recordsIn,
      recordsOut: metrics.recordsOut,
      createdCt: metrics.createdCt,
      updatedCt: metrics.updatedCt,
      failedCt: metrics.failedCt,
    })
    .where(eq(syncRunStages.id, stageId));
}

export async function failProjectionStage(
  db: Db,
  stageId: string,
  rawBatchId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(syncRunStages)
    .set({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: message,
    })
    .where(eq(syncRunStages.id, stageId));
  await db
    .update(rawBatches)
    .set({ status: "failed", projectionError: message })
    .where(eq(rawBatches.id, rawBatchId));
}

async function projectUpsert(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
  },
  payload: unknown,
  payloadHash: string,
): Promise<{ recordsOut: number; createdCt: number; updatedCt: number }> {
  const registry = tableRegistryFor(params.type);
  const now = new Date().toISOString();
  const projected = normalizeVendorRecord(
    params.provider,
    params.type,
    payload,
  );
  const existing = await findExistingVendorRow(
    db,
    registry.table,
    params.linkId,
    projected.externalId,
  );
  if (existing?.sourceHash === payloadHash && existing.deletedAt == null) {
    await touchVendorRow(db, registry.table, existing.id);
    return { recordsOut: 0, createdCt: 0, updatedCt: 0 };
  }

  const insertRow = {
    ...projected,
    linkId: params.linkId,
    siteId: params.siteId,
    sourceHash: payloadHash,
    deletedAt: null,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const columns = getColumns(registry.table as never);
  const setClause = Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !skipOnUpdate.has(key))
      .map(([key, column]) => [
        key,
        sql.raw(`excluded.${Object(column).name}`),
      ]),
  );

  const returned = await (
    db.insert(registry.table as never).values(insertRow) as any
  )
    .onConflictDoUpdate({ target: registry.conflictTarget, set: setClause })
    .returning({ xmax: sql<string>`xmax::text` });

  const wasCreated = returned[0]?.xmax === "0";
  return {
    recordsOut: 1,
    createdCt: wasCreated ? 1 : 0,
    updatedCt: wasCreated ? 0 : 1,
  };
}

async function findExistingVendorRow(
  db: Db,
  table: unknown,
  linkId: string,
  externalId: unknown,
): Promise<
  | { id: string; sourceHash: string | null; deletedAt: string | null }
  | undefined
> {
  if (typeof externalId !== "string")
    throw new Error("Projected row missing externalId");

  const vendorTable = table as any;
  const [row] = await db
    .select({
      id: vendorTable.id,
      sourceHash: vendorTable.sourceHash,
      deletedAt: vendorTable.deletedAt,
    })
    .from(vendorTable)
    .where(
      and(
        eq(vendorTable.linkId, linkId),
        eq(vendorTable.externalId, externalId),
      ),
    )
    .limit(1);

  return row;
}

async function touchVendorRow(
  db: Db,
  table: unknown,
  id: string,
): Promise<void> {
  const vendorTable = table as any;
  await db
    .update(vendorTable)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(vendorTable.id, id));
}

async function projectDelete(
  db: Db,
  params: {
    linkId: string;
    type: string;
  },
  externalId: string,
  payloadHash: string,
): Promise<{ recordsOut: number; createdCt: number; updatedCt: number }> {
  const registry = tableRegistryFor(params.type);
  const table = registry.table as any;
  const now = new Date().toISOString();
  const returned = await db
    .update(table)
    .set({
      deletedAt: now,
      sourceHash: payloadHash,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(table.linkId, params.linkId), eq(table.externalId, externalId)),
    )
    .returning({ id: table.id });

  return {
    recordsOut: returned.length,
    createdCt: 0,
    updatedCt: returned.length,
  };
}

async function markRawRecordCompleted(
  db: Db,
  rawRecordId: string,
): Promise<void> {
  await db
    .update(rawRecords)
    .set({
      projectionStatus: "completed",
      projectedAt: new Date().toISOString(),
      projectionError: null,
    })
    .where(eq(rawRecords.id, rawRecordId));
}

async function markRawRecordFailed(
  db: Db,
  rawRecordId: string,
  error: unknown,
): Promise<void> {
  await db
    .update(rawRecords)
    .set({
      projectionStatus: "failed",
      projectionError: errorMessage(error),
    })
    .where(eq(rawRecords.id, rawRecordId));
}

async function completeRawBatch(
  db: Db,
  rawBatchId: string,
  failedCt: number,
): Promise<void> {
  await db
    .update(rawBatches)
    .set({
      status: failedCt > 0 ? "failed" : "completed",
      projectedAt: new Date().toISOString(),
      projectionError:
        failedCt > 0 ? `${failedCt} raw records failed projection` : null,
    })
    .where(eq(rawBatches.id, rawBatchId));
}

async function maybeCompleteRun(db: Db, syncRunId: string): Promise<void> {
  const pending = await db
    .select({ id: rawBatches.id })
    .from(rawBatches)
    .where(
      and(
        eq(rawBatches.syncRunId, syncRunId),
        inArray(rawBatches.status, ["pending"]),
      ),
    )
    .limit(1);

  if (pending.length > 0) return;

  const failed = await db
    .select({ id: rawBatches.id })
    .from(rawBatches)
    .where(
      and(
        eq(rawBatches.syncRunId, syncRunId),
        inArray(rawBatches.status, ["failed"]),
      ),
    )
    .limit(1);

  await db
    .update(syncRuns)
    .set({
      status: failed.length > 0 ? "projection_failed" : "completed",
      finishedAt: new Date().toISOString(),
    })
    .where(eq(syncRuns.id, syncRunId));
}

function tableRegistryFor(type: string) {
  const tableName = facetTableMap.get(type as never) as
    | VendorTableName
    | undefined;
  if (!tableName) throw new Error(`No vendor table mapping for facet ${type}`);

  const registry =
    vendorTableRegistry[tableName as keyof typeof vendorTableRegistry];
  if (!registry) throw new Error(`No vendor table registered for ${tableName}`);

  return registry;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
