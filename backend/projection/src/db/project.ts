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
import {
  isSophosTamperProtectionFacet,
  projectSophosTamperProtection,
  softDeleteSophosTamperProtection,
} from "./sophos-tamper-protection.js";

type Db = any;
type VendorRowState = {
  id: string;
  sourceHash: string | null;
};
type RawProjectionRow = {
  id: string;
  externalId: string;
  op: string;
  payloadHash: string;
  payload: unknown;
};
type ProjectionResult = {
  recordsOut: number;
  createdCt: number;
  updatedCt: number;
};
type RawRecordFailure = {
  rawRecordId: string;
  externalId: string;
  error: unknown;
};

const facetTableMap = getFacetTableMap();
const skipOnUpdate = new Set(["id", "linkId", "externalId", "createdAt"]);

export type ProjectionMetrics = {
  recordsIn: number;
  recordsOut: number;
  createdCt: number;
  updatedCt: number;
  failedCt: number;
  runCompleted: boolean;
  runStatus?: "completed" | "projection_failed";
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

  const { result, completedIds, failures } =
    isSophosTamperProtectionFacet(params.type)
      ? await projectRowsIndividually(db, params, sourceRows)
      : await projectRowsBatch(db, params, sourceRows);

  await markRawRecordsCompleted(db, completedIds);
  await markRawRecordsFailed(db, failures);

  await completeRawBatch(db, params.rawBatchId, failures.length);
  const runStatus = await maybeCompleteRun(db, params.syncRunId);

  if (failures.length > 0) {
    logger.warn("Projection batch completed with raw record failures", {
      orgId: params.orgId,
      linkId: params.linkId,
      provider: params.provider,
      type: params.type,
      syncRunId: params.syncRunId,
      rawBatchId: params.rawBatchId,
      failedCt: failures.length,
      failureSamples: failures.slice(0, 5).map((failure) => ({
        rawRecordId: failure.rawRecordId,
        externalId: failure.externalId,
        error: errorMessage(failure.error),
      })),
    });
  }

  return {
    recordsIn: sourceRows.length,
    recordsOut: result.recordsOut,
    createdCt: result.createdCt,
    updatedCt: result.updatedCt,
    failedCt: failures.length,
    runCompleted: runStatus != null,
    runStatus,
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
  syncRunId: string,
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
  await db
    .update(syncRuns)
    .set({
      status: "projection_failed",
      finishedAt: new Date().toISOString(),
    })
    .where(eq(syncRuns.id, syncRunId));
}

export async function failProjectionRun(
  db: Db,
  syncRunId: string,
  error: unknown,
): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      status: "projection_failed",
      finishedAt: new Date().toISOString(),
    })
    .where(eq(syncRuns.id, syncRunId));

  logger.warn("Projection run marked failed", {
    syncRunId,
    error: errorMessage(error),
  });
}

export async function startProjectionStepStage(
  db: Db,
  params: {
    syncRunId: string;
    provider: string;
    type: string;
    bullmqJobId: string;
    stage: "link" | "enrich";
  },
): Promise<string> {
  const [row] = await db
    .insert(syncRunStages)
    .values({
      syncRunId: params.syncRunId,
      integrationId: params.provider,
      bullmqJobId: params.bullmqJobId,
      type: params.type,
      stage: params.stage,
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning({ id: syncRunStages.id });

  return row.id;
}

export async function completeProjectionStepStage(
  db: Db,
  stageId: string,
  metrics: Record<string, unknown>,
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: "completed",
      finishedAt: new Date().toISOString(),
      metrics,
    })
    .where(eq(syncRunStages.id, stageId));
}

export async function failProjectionStepStage(
  db: Db,
  stageId: string,
  error: unknown,
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: errorMessage(error),
    })
    .where(eq(syncRunStages.id, stageId));
}

async function projectRowsBatch(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
  },
  rows: RawProjectionRow[],
): Promise<{
  result: ProjectionResult;
  completedIds: string[];
  failures: RawRecordFailure[];
}> {
  const upsertRows = rows.filter((row) => row.op !== "delete");
  const deleteRows = rows.filter((row) => row.op === "delete");
  const completedIds: string[] = [];
  const failures: RawRecordFailure[] = [];
  const result: ProjectionResult = {
    recordsOut: 0,
    createdCt: 0,
    updatedCt: 0,
  };

  if (upsertRows.length > 0) {
    const projectedRows: Array<{
      rawRecordId: string;
      externalId: string;
      payloadHash: string;
      projected: Record<string, unknown>;
    }> = [];

    for (const row of upsertRows) {
      try {
        const projected = normalizeVendorRecord(
          params.provider,
          params.type,
          row.payload,
        );
        if (typeof projected.externalId !== "string") {
          throw new Error("Projected row missing externalId");
        }

        projectedRows.push({
          rawRecordId: row.id,
          externalId: projected.externalId,
          payloadHash: row.payloadHash,
          projected,
        });
      } catch (error) {
        failures.push({
          rawRecordId: row.id,
          externalId: row.externalId,
          error,
        });
      }
    }

    const upsertResult = await projectUpsertsBatch(db, params, projectedRows);
    result.recordsOut += upsertResult.recordsOut;
    result.createdCt += upsertResult.createdCt;
    result.updatedCt += upsertResult.updatedCt;
    completedIds.push(...upsertResult.completedIds);
  }

  if (deleteRows.length > 0) {
    const deleteResult = await projectDeletesBatch(db, params, deleteRows);
    result.recordsOut += deleteResult.recordsOut;
    result.createdCt += deleteResult.createdCt;
    result.updatedCt += deleteResult.updatedCt;
    completedIds.push(...deleteRows.map((row) => row.id));
  }

  return { result, completedIds, failures };
}

async function projectRowsIndividually(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
  },
  rows: RawProjectionRow[],
): Promise<{
  result: ProjectionResult;
  completedIds: string[];
  failures: RawRecordFailure[];
}> {
  const result: ProjectionResult = {
    recordsOut: 0,
    createdCt: 0,
    updatedCt: 0,
  };
  const completedIds: string[] = [];
  const failures: RawRecordFailure[] = [];

  for (const row of rows) {
    try {
      const rowResult =
        row.op === "delete"
          ? await projectDelete(db, params, row.externalId)
          : await projectUpsert(db, params, row.payload, row.payloadHash);

      result.recordsOut += rowResult.recordsOut;
      result.createdCt += rowResult.createdCt;
      result.updatedCt += rowResult.updatedCt;
      completedIds.push(row.id);
    } catch (error) {
      failures.push({
        rawRecordId: row.id,
        externalId: row.externalId,
        error,
      });
    }
  }

  return { result, completedIds, failures };
}

async function projectUpsertsBatch(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    type: string;
  },
  rows: Array<{
    rawRecordId: string;
    externalId: string;
    payloadHash: string;
    projected: Record<string, unknown>;
  }>,
): Promise<ProjectionResult & { completedIds: string[] }> {
  if (rows.length === 0) {
    return { recordsOut: 0, createdCt: 0, updatedCt: 0, completedIds: [] };
  }

  const registry = tableRegistryFor(params.type);
  const table = registry.table as any;
  const now = new Date().toISOString();
  const existingByExternalId = await findExistingVendorRows(
    db,
    table,
    params.linkId,
    rows.map((row) => row.externalId),
  );
  const unchangedIds: string[] = [];
  const changedRows: typeof rows = [];

  for (const row of rows) {
    const existing = existingByExternalId.get(row.externalId);
    if (existing?.sourceHash === row.payloadHash) {
      unchangedIds.push(existing.id);
    } else {
      changedRows.push(row);
    }
  }

  await touchVendorRows(db, table, unchangedIds);

  if (changedRows.length === 0) {
    return {
      recordsOut: 0,
      createdCt: 0,
      updatedCt: 0,
      completedIds: rows.map((row) => row.rawRecordId),
    };
  }

  const writeRows = lastByExternalId(changedRows);
  const insertRows = writeRows.map((row) => {
    const insertRow: Record<string, unknown> = {
      ...row.projected,
      linkId: params.linkId,
      siteId: params.siteId,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    if (table.sourceHash) insertRow.sourceHash = row.payloadHash;
    return insertRow;
  });
  const setClause = vendorUpsertSetClause(table);
  const returned = await (db.insert(table as never).values(insertRows) as any)
    .onConflictDoUpdate({ target: registry.conflictTarget, set: setClause })
    .returning({ xmax: sql<string>`xmax::text` });
  const createdCt = returned.filter((row: { xmax?: string }) => row.xmax === "0").length;
  const updatedCt = returned.length - createdCt;

  return {
    recordsOut: writeRows.length,
    createdCt,
    updatedCt,
    completedIds: rows.map((row) => row.rawRecordId),
  };
}

async function projectDeletesBatch(
  db: Db,
  params: {
    linkId: string;
    type: string;
  },
  rows: RawProjectionRow[],
): Promise<ProjectionResult> {
  if (rows.length === 0) return { recordsOut: 0, createdCt: 0, updatedCt: 0 };

  const registry = tableRegistryFor(params.type);
  const table = registry.table as any;
  const externalIds = rows.map((row) => row.externalId);

  const returned = await db
    .delete(table)
    .where(
      and(eq(table.linkId, params.linkId), inArray(table.externalId, externalIds)),
    )
    .returning({ id: table.id });

  return {
    recordsOut: returned.length,
    createdCt: 0,
    updatedCt: returned.length,
  };
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
  if (isSophosTamperProtectionFacet(params.type)) {
    return projectSophosTamperProtection(db, params, payload);
  }
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
  if (existing?.sourceHash === payloadHash) {
    await touchVendorRow(db, registry.table, existing.id);
    return { recordsOut: 0, createdCt: 0, updatedCt: 0 };
  }

  const table = registry.table as any;
  const insertRow: Record<string, unknown> = {
    ...projected,
    linkId: params.linkId,
    siteId: params.siteId,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
  if (table.sourceHash) insertRow.sourceHash = payloadHash;

  const setClause = vendorUpsertSetClause(table);

  const returned = await (
    db.insert(table as never).values(insertRow) as any
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
): Promise<VendorRowState | undefined> {
  if (typeof externalId !== "string")
    throw new Error("Projected row missing externalId");

  const vendorTable = table as any;
  const selection = {
    id: requiredColumn(vendorTable, "id"),
    ...(vendorTable.sourceHash ? { sourceHash: vendorTable.sourceHash } : {}),
  };
  const [row] = await db
    .select(selection)
    .from(vendorTable)
    .where(
      and(
        eq(vendorTable.linkId, linkId),
        eq(vendorTable.externalId, externalId),
      ),
    )
    .limit(1);

  if (!row) return undefined;
  return {
    id: row.id,
    sourceHash: row.sourceHash ?? null,
  };
}

async function findExistingVendorRows(
  db: Db,
  table: unknown,
  linkId: string,
  externalIds: string[],
): Promise<Map<string, VendorRowState>> {
  if (externalIds.length === 0) return new Map();

  const vendorTable = table as any;
  const selection = {
    id: requiredColumn(vendorTable, "id"),
    externalId: requiredColumn(vendorTable, "externalId"),
    ...(vendorTable.sourceHash ? { sourceHash: vendorTable.sourceHash } : {}),
  };
  const rows = await db
    .select(selection)
    .from(vendorTable)
    .where(
      and(
        eq(vendorTable.linkId, linkId),
        inArray(vendorTable.externalId, unique(externalIds)),
      ),
    );

  return new Map(
    rows.map((row: VendorRowState & { externalId: string }) => [
      row.externalId,
      {
        id: row.id,
        sourceHash: row.sourceHash ?? null,
      },
    ]),
  );
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

async function touchVendorRows(
  db: Db,
  table: unknown,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  const vendorTable = table as any;
  await db
    .update(vendorTable)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(inArray(vendorTable.id, ids));
}

async function projectDelete(
  db: Db,
  params: {
    linkId: string;
    type: string;
  },
  externalId: string,
): Promise<{ recordsOut: number; createdCt: number; updatedCt: number }> {
  if (isSophosTamperProtectionFacet(params.type)) {
    const cleared = await softDeleteSophosTamperProtection(
      db,
      params,
      externalId,
    );
    return { recordsOut: cleared, createdCt: 0, updatedCt: cleared };
  }
  const registry = tableRegistryFor(params.type);
  const table = registry.table as any;

  const returned = await db
    .delete(table)
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

async function markRawRecordsCompleted(
  db: Db,
  rawRecordIds: string[],
): Promise<void> {
  if (rawRecordIds.length === 0) return;

  await db
    .update(rawRecords)
    .set({
      projectionStatus: "completed",
      projectedAt: new Date().toISOString(),
      projectionError: null,
    })
    .where(inArray(rawRecords.id, rawRecordIds));
}

async function markRawRecordsFailed(
  db: Db,
  failures: RawRecordFailure[],
): Promise<void> {
  if (failures.length === 0) return;

  const now = new Date().toISOString();
  const projectionError = caseByRawRecordId(
    failures.map((failure) => [
      failure.rawRecordId,
      errorMessage(failure.error),
    ]),
    rawRecords.projectionError,
  );

  await db
    .update(rawRecords)
    .set({
      projectionStatus: "failed",
      projectedAt: now,
      projectionError,
    })
    .where(inArray(rawRecords.id, failures.map((failure) => failure.rawRecordId)));
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

async function maybeCompleteRun(
  db: Db,
  syncRunId: string,
): Promise<"completed" | "projection_failed" | undefined> {
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

  if (pending.length > 0) return undefined;

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

  const status = failed.length > 0 ? "projection_failed" : "completed";
  await db
    .update(syncRuns)
    .set({
      status,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(syncRuns.id, syncRunId));

  return status;
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

function vendorUpsertSetClause(table: unknown): Record<string, unknown> {
  const columns = getColumns(table as never);
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !skipOnUpdate.has(key))
      .map(([key, column]) => [
        key,
        sql.raw(`excluded.${Object(column).name}`),
      ]),
  );
}

function caseByRawRecordId(
  values: Array<[string, string]>,
  fallback: unknown,
) {
  return sql`case ${rawRecords.id} ${sql.join(
    values.map(([id, value]) => sql`when ${id} then ${value}`),
    sql.raw(" "),
  )} else ${fallback as never} end`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function lastByExternalId<T extends { externalId: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.externalId, row])).values()];
}

function requiredColumn(table: Record<string, unknown>, columnName: string) {
  const column = table[columnName];
  if (!column)
    throw new Error(`Vendor table missing required column ${columnName}`);
  return column;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
