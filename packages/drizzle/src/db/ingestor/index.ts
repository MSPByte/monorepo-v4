import {
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
  check,
  index,
} from "drizzle-orm/pg-core";
import { crudPolicy, authenticatedRole } from "drizzle-orm/neon";
import { sql } from "drizzle-orm";
import { ingestorSchema } from "../schemas.js";
import { integrationLinks, sites } from "../public/index.js";

export const syncRuns = ingestorSchema.table(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => integrationLinks.id, {
        onDelete: "cascade",
      }),
    integrationId: text("integration_id").notNull(),
    bullmqJobId: text("bullmq_job_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  () => [
    check("valid_mode", sql`mode in ('full', 'incremental')`),
    crudPolicy({ role: authenticatedRole, read: true, modify: false }),
  ],
);

export const syncRunStages = ingestorSchema.table(
  "sync_run_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    integrationId: text("integration_id").notNull(),
    bullmqJobId: text("bullmq_job_id").notNull(),
    type: text("type").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull().default("pending"),
    recordsIn: integer("records_in").notNull().default(0),
    recordsOut: integer("records_out").notNull().default(0),
    createdCt: integer("created_ct").notNull().default(0),
    updatedCt: integer("updated_ct").notNull().default(0),
    failedCt: integer("failed_ct").notNull().default(0),
    metrics: jsonb("metrics"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      mode: "string",
    }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: false })],
);

export const syncContext = ingestorSchema.table(
  "sync_context",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => integrationLinks.id, {
        onDelete: "cascade",
      }),
    integrationId: text("integration_id").notNull(),
    type: text("type").notNull(),
    cursor: text("cursor"),
    fullSyncAt: timestamp("full_sync_at", {
      withTimezone: true,
      mode: "string",
    }),
    incrementalSyncAt: timestamp("incremental_sync_at", {
      withTimezone: true,
      mode: "string",
    }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastFailureAt: timestamp("last_failure_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastErrorClass: text("last_error_class"),
    lastErrorMessage: text("last_error_message"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("unique_sync_context").on(t.linkId, t.integrationId, t.type),
    crudPolicy({ role: authenticatedRole, read: true, modify: false }),
  ],
);

export const rawBatches = ingestorSchema.table(
  "raw_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => integrationLinks.id, {
        onDelete: "cascade",
      }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    type: text("type").notNull(),
    mode: text("mode").notNull(),
    batchIndex: integer("batch_index").notNull(),
    cursorIn: text("cursor_in"),
    cursorOut: text("cursor_out"),
    status: text("status").notNull().default("pending"),
    recordCount: integer("record_count").notNull().default(0),
    projectedAt: timestamp("projected_at", {
      withTimezone: true,
      mode: "string",
    }),
    projectionError: text("projection_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("raw_batches_valid_mode", sql`mode in ('full', 'incremental')`),
    unique("raw_batches_run_type_index").on(
      t.syncRunId,
      t.linkId,
      t.type,
      t.batchIndex,
    ),
    index("raw_batches_projection_idx").on(t.status, t.provider, t.type),
    index("raw_batches_reconciliation_idx").on(
      t.syncRunId,
      t.linkId,
      t.type,
      t.mode,
    ),
    crudPolicy({ role: authenticatedRole, read: true, modify: false }),
  ],
);

export const rawRecords = ingestorSchema.table(
  "raw_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rawBatchId: uuid("raw_batch_id")
      .notNull()
      .references(() => rawBatches.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    linkId: uuid("link_id")
      .notNull()
      .references(() => integrationLinks.id, {
        onDelete: "cascade",
      }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    type: text("type").notNull(),
    externalId: text("external_id").notNull(),
    op: text("op").notNull().default("upsert"),
    payloadHash: text("payload_hash").notNull(),
    schemaVersion: text("schema_version").notNull().default("1"),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    projectedAt: timestamp("projected_at", {
      withTimezone: true,
      mode: "string",
    }),
    projectionStatus: text("projection_status").notNull().default("pending"),
    projectionError: text("projection_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("raw_records_valid_op", sql`op in ('upsert', 'delete')`),
    unique("raw_records_batch_external").on(t.rawBatchId, t.externalId),
    index("raw_records_projection_idx").on(
      t.projectionStatus,
      t.provider,
      t.type,
    ),
    index("raw_records_source_lookup_idx").on(t.linkId, t.type, t.externalId),
    index("raw_records_reconciliation_idx").on(
      t.syncRunId,
      t.linkId,
      t.type,
      t.externalId,
    ),
    crudPolicy({ role: authenticatedRole, read: true, modify: false }),
  ],
);

export type SyncRun = typeof syncRuns.$inferSelect;
export type SyncRunStage = typeof syncRunStages.$inferSelect;
export type SyncContext = typeof syncContext.$inferSelect;
export type RawBatch = typeof rawBatches.$inferSelect;
export type RawRecord = typeof rawRecords.$inferSelect;
