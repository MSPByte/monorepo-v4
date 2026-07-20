import { and, eq, getColumns, inArray, sql } from "drizzle-orm";
import {
  getProjectionSchema,
  syncRunStages,
  vendorTableRegistry,
  type VendorTableName,
} from "@mspbyte/drizzle";
import { getFacetTableMap, type ProviderFacet } from "@mspbyte/shared";
import type { RawRecordEnvelope, SyncMode } from "@mspbyte/pipeline";
import { logger } from "../logger.js";
import { normalizeVendorRecord } from "../adapters/normalize.js";
import { stablePayloadHash } from "./hash.js";
import {
  isSophosTamperProtectionFacet,
  projectSophosTamperProtection,
} from "./sophos-tamper-protection.js";

type Db = any;
type VendorRowState = {
  id: string;
  sourceHash: string | null;
};
type ProjectionResult = {
  recordsOut: number;
  createdCt: number;
  updatedCt: number;
};
type ProjectionFailure = {
  externalId: string;
  op: "upsert" | "delete";
  payload: unknown;
  error: unknown;
};

const facetTableMap = getFacetTableMap();
const skipOnUpdate = new Set(["id", "linkId", "externalId", "createdAt"]);

export type ProjectBatchParams = {
  orgId: string;
  linkId: string;
  siteId?: string;
  provider: string;
  type: string;
  syncRunId: string;
  mode: SyncMode;
  batchIndex: number;
};

export type ProjectBatchFailure = {
  externalId: string;
  op: "upsert" | "delete";
  payload: unknown;
  error: unknown;
};

export type ProjectBatchMetrics = {
  recordsIn: number;
  recordsOut: number;
  createdCt: number;
  updatedCt: number;
  failedCt: number;
  failures: ProjectBatchFailure[];
};

const EMPTY_METRICS: ProjectBatchMetrics = {
  recordsIn: 0,
  recordsOut: 0,
  createdCt: 0,
  updatedCt: 0,
  failedCt: 0,
  failures: [],
};

/**
 * Projects an in-memory batch of adapter records into the vendor-specific
 * table. Replaces the old raw_records → projection queue round-trip: the
 * ingestion worker calls this directly with each page it fetches, so no rows
 * ever hit raw_records on the happy path.
 */
export async function projectBatch(
  db: Db,
  params: ProjectBatchParams,
  records: readonly RawRecordEnvelope[],
): Promise<ProjectBatchMetrics> {
  if (records.length === 0) return { ...EMPTY_METRICS, failures: [] };

  const withHashes = records.map((record) => ({
    externalId: record.externalId,
    op: record.op ?? "upsert",
    payload: record.payload ?? {},
    payloadHash: stablePayloadHash(record.payload ?? {}),
  }));

  const { result, failures } = isSophosTamperProtectionFacet(params.type)
    ? await projectRowsIndividually(db, params, withHashes)
    : await projectRowsBatch(db, params, withHashes);

  if (failures.length > 0) {
    logger.warn("Projection completed with row failures", {
      orgId: params.orgId,
      linkId: params.linkId,
      provider: params.provider,
      type: params.type,
      syncRunId: params.syncRunId,
      failedCt: failures.length,
      failureSamples: failures.slice(0, 5).map((failure) => ({
        externalId: failure.externalId,
        error: errorMessage(failure.error),
      })),
    });
  }

  return {
    recordsIn: withHashes.length,
    recordsOut: result.recordsOut,
    createdCt: result.createdCt,
    updatedCt: result.updatedCt,
    failedCt: failures.length,
    failures,
  };
}

type PreparedRow = {
  externalId: string;
  op: string;
  payload: unknown;
  payloadHash: string;
};

async function projectRowsBatch(
  db: Db,
  params: ProjectBatchParams,
  rows: PreparedRow[],
): Promise<{ result: ProjectionResult; failures: ProjectionFailure[] }> {
  const upsertRows = rows.filter((row) => row.op !== "delete");
  const deleteRows = rows.filter((row) => row.op === "delete");
  const failures: ProjectionFailure[] = [];
  const result: ProjectionResult = { recordsOut: 0, createdCt: 0, updatedCt: 0 };

  if (upsertRows.length > 0) {
    const projectedRows: Array<{
      externalId: string;
      payloadHash: string;
      projected: Record<string, unknown>;
    }> = [];

    const schema = projectionSchemaForFacet(params.type);
    for (const row of upsertRows) {
      try {
        const projected = normalizeVendorRecord(params.provider, params.type, row.payload);
        if (typeof projected.externalId !== "string") {
          throw new Error("Projected row missing externalId");
        }
        if (schema) {
          const parsed = schema.safeParse(projected);
          if (!parsed.success) {
            throw new Error(
              `Projection schema validation failed: ${parsed.error.message}`,
            );
          }
        }
        projectedRows.push({
          externalId: projected.externalId,
          payloadHash: row.payloadHash,
          projected,
        });
      } catch (error) {
        failures.push({
          externalId: row.externalId,
          op: "upsert",
          payload: row.payload,
          error,
        });
      }
    }

    const upsertResult = await projectUpsertsBatch(db, params, projectedRows);
    result.recordsOut += upsertResult.recordsOut;
    result.createdCt += upsertResult.createdCt;
    result.updatedCt += upsertResult.updatedCt;
  }

  if (deleteRows.length > 0) {
    const deleteResult = await projectDeletesBatch(db, params, deleteRows);
    result.recordsOut += deleteResult.recordsOut;
    result.createdCt += deleteResult.createdCt;
    result.updatedCt += deleteResult.updatedCt;
  }

  return { result, failures };
}

async function projectRowsIndividually(
  db: Db,
  params: ProjectBatchParams,
  rows: PreparedRow[],
): Promise<{ result: ProjectionResult; failures: ProjectionFailure[] }> {
  const result: ProjectionResult = { recordsOut: 0, createdCt: 0, updatedCt: 0 };
  const failures: ProjectionFailure[] = [];

  for (const row of rows) {
    try {
      if (row.op === "delete") {
        const del = await projectDelete(db, params, row.externalId);
        result.recordsOut += del.recordsOut;
        result.createdCt += del.createdCt;
        result.updatedCt += del.updatedCt;
      } else {
        const up = await projectUpsertSingle(db, params, row.payload, row.payloadHash);
        result.recordsOut += up.recordsOut;
        result.createdCt += up.createdCt;
        result.updatedCt += up.updatedCt;
      }
    } catch (error) {
      failures.push({
        externalId: row.externalId,
        op: row.op === "delete" ? "delete" : "upsert",
        payload: row.payload,
        error,
      });
    }
  }

  return { result, failures };
}

async function projectUpsertsBatch(
  db: Db,
  params: ProjectBatchParams,
  rows: Array<{ externalId: string; payloadHash: string; projected: Record<string, unknown> }>,
): Promise<ProjectionResult> {
  if (rows.length === 0) return { recordsOut: 0, createdCt: 0, updatedCt: 0 };

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
    return { recordsOut: 0, createdCt: 0, updatedCt: 0 };
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

  return { recordsOut: writeRows.length, createdCt, updatedCt };
}

async function projectDeletesBatch(
  db: Db,
  params: { linkId: string; type: string },
  rows: PreparedRow[],
): Promise<ProjectionResult> {
  if (rows.length === 0) return { recordsOut: 0, createdCt: 0, updatedCt: 0 };

  const registry = tableRegistryFor(params.type);
  const table = registry.table as any;
  const externalIds = rows.map((row) => row.externalId);

  const returned = await db
    .delete(table)
    .where(and(eq(table.linkId, params.linkId), inArray(table.externalId, externalIds)))
    .returning({ id: table.id });

  return {
    recordsOut: returned.length,
    createdCt: 0,
    updatedCt: returned.length,
  };
}

async function projectUpsertSingle(
  db: Db,
  params: ProjectBatchParams,
  payload: unknown,
  payloadHash: string,
): Promise<ProjectionResult> {
  if (isSophosTamperProtectionFacet(params.type)) {
    return projectSophosTamperProtection(db, params, payload);
  }
  const registry = tableRegistryFor(params.type);
  const now = new Date().toISOString();
  const projected = normalizeVendorRecord(params.provider, params.type, payload);
  const schema = projectionSchemaForFacet(params.type);
  if (schema) {
    const parsed = schema.safeParse(projected);
    if (!parsed.success) {
      throw new Error(
        `Projection schema validation failed: ${parsed.error.message}`,
      );
    }
  }
  const existing = await findExistingVendorRow(db, registry.table, params.linkId, projected.externalId);
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
  const returned = await (db.insert(table as never).values(insertRow) as any)
    .onConflictDoUpdate({ target: registry.conflictTarget, set: setClause })
    .returning({ xmax: sql<string>`xmax::text` });

  const wasCreated = returned[0]?.xmax === "0";
  return {
    recordsOut: 1,
    createdCt: wasCreated ? 1 : 0,
    updatedCt: wasCreated ? 0 : 1,
  };
}

async function projectDelete(
  db: Db,
  params: { linkId: string; type: string },
  externalId: string,
): Promise<ProjectionResult> {
  const registry = tableRegistryFor(params.type);
  const table = registry.table as any;
  const returned = await db
    .delete(table)
    .where(and(eq(table.linkId, params.linkId), eq(table.externalId, externalId)))
    .returning({ id: table.id });
  return { recordsOut: returned.length, createdCt: 0, updatedCt: returned.length };
}

async function findExistingVendorRow(
  db: Db,
  table: unknown,
  linkId: string,
  externalId: unknown,
): Promise<VendorRowState | undefined> {
  if (typeof externalId !== "string") throw new Error("Projected row missing externalId");
  const vendorTable = table as any;
  const selection = {
    id: requiredColumn(vendorTable, "id"),
    ...(vendorTable.sourceHash ? { sourceHash: vendorTable.sourceHash } : {}),
  };
  const [row] = await db
    .select(selection)
    .from(vendorTable)
    .where(and(eq(vendorTable.linkId, linkId), eq(vendorTable.externalId, externalId)))
    .limit(1);
  if (!row) return undefined;
  return { id: row.id, sourceHash: row.sourceHash ?? null };
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
    .where(and(eq(vendorTable.linkId, linkId), inArray(vendorTable.externalId, unique(externalIds))));
  return new Map(
    rows.map((row: VendorRowState & { externalId: string }) => [
      row.externalId,
      { id: row.id, sourceHash: row.sourceHash ?? null },
    ]),
  );
}

async function touchVendorRow(db: Db, table: unknown, id: string): Promise<void> {
  const vendorTable = table as any;
  await db
    .update(vendorTable)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(vendorTable.id, id));
}

async function touchVendorRows(db: Db, table: unknown, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const vendorTable = table as any;
  await db
    .update(vendorTable)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(inArray(vendorTable.id, ids));
}

function tableRegistryFor(type: string) {
  const tableName = facetTableMap.get(type as ProviderFacet) as VendorTableName | undefined;
  if (!tableName) throw new Error(`No vendor table mapping for facet ${type}`);
  const registry = vendorTableRegistry[tableName as keyof typeof vendorTableRegistry];
  if (!registry) throw new Error(`No vendor table registered for ${tableName}`);
  return registry;
}

function projectionSchemaForFacet(type: string) {
  const tableName = facetTableMap.get(type as ProviderFacet) as VendorTableName | undefined;
  if (!tableName) return undefined;
  return getProjectionSchema(tableName);
}

function vendorUpsertSetClause(table: unknown): Record<string, unknown> {
  const columns = getColumns(table as never);
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !skipOnUpdate.has(key))
      .map(([key, column]) => [key, sql.raw(`excluded.${Object(column).name}`)]),
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function lastByExternalId<T extends { externalId: string }>(rows: T[]): T[] {
  return [...new Map(rows.map((row) => [row.externalId, row])).values()];
}

function requiredColumn(table: Record<string, unknown>, columnName: string) {
  const column = table[columnName];
  if (!column) throw new Error(`Vendor table missing required column ${columnName}`);
  return column;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Contract step stage tracking ─────────────────────────────────────────────
// Used by contracts/runner.ts to emit sync_run_stages entries for the
// enrich/link post-projection groups.

export async function startProjectionStepStage(
  db: Db,
  params: {
    syncRunId: string;
    provider: string;
    type: string;
    bullmqJobId: string;
    stage: "enrich" | "link";
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
  metrics: { steps: Array<{ ran: boolean; metrics: Record<string, unknown> }> },
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: "completed",
      finishedAt: new Date().toISOString(),
      metrics: metrics as unknown as Record<string, unknown>,
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
