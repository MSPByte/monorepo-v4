import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { sql } from 'drizzle-orm';
import { packagesSchema } from '../schemas.js';
import { integrationLinks, sites } from '../public/index.js';

const authoredRls = crudPolicy({ role: authenticatedRole, read: true, modify: true });
const systemRls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const packages = packagesSchema.table(
  'packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: ['draft', 'active', 'archived'] })
      .notNull()
      .default('draft'),
    version: integer('version').notNull().default(1),
    // Steps live inline here as an ordered array during Phase 1. A dedicated
    // `package_steps` table lands in Phase 2 when the builder UI needs it.
    steps: jsonb('steps').notNull().default(sql`'[]'::jsonb`),
    authorUserId: text('author_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('packages_status_name_idx').on(t.status, t.name),
    authoredRls,
  ],
);

export const packageRuns = packagesSchema.table(
  'package_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'restrict' }),
    packageVersion: integer('package_version').notNull(),
    // Frozen copy of the package definition (name + steps + bindings) at run
    // time so retries and audits stay reproducible after the package is edited.
    packageSnapshot: jsonb('package_snapshot').notNull(),
    parentRunId: uuid('parent_run_id').references((): AnyPgColumn => packageRuns.id, {
      onDelete: 'set null',
    }),
    fanoutParentId: uuid('fanout_parent_id').references((): AnyPgColumn => packageRuns.id, {
      onDelete: 'set null',
    }),
    linkId: uuid('link_id').references(() => integrationLinks.id, {
      onDelete: 'set null',
    }),
    siteId: uuid('site_id').references(() => sites.id, {
      onDelete: 'set null',
    }),
    triggerType: text('trigger_type', {
      enum: ['manual', 'finding', 'scheduled', 'api'],
    }).notNull(),
    triggerRef: jsonb('trigger_ref'),
    startStepIndex: integer('start_step_index').notNull().default(0),
    // Sensitive fields inside runtimeInputs are encrypted inline as
    // `iv:tag:cipher` (see `packages/encryption`).
    runtimeInputs: jsonb('runtime_inputs').notNull().default(sql`'{}'::jsonb`),
    status: text('status', {
      enum: ['pending', 'queued', 'running', 'completed', 'failed', 'halted', 'partial'],
    })
      .notNull()
      .default('pending'),
    bullmqJobId: text('bullmq_job_id'),
    billingSnapshot: jsonb('billing_snapshot').notNull().default(sql`'{}'::jsonb`),
    billingTotal: numeric('billing_total', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    // Sensitive outputs become unreadable after this timestamp; the TTL worker
    // null-writes them and stamps sensitiveOutputsPurgedAt.
    outputsExpiresAt: timestamp('outputs_expires_at', {
      withTimezone: true,
      mode: 'string',
    })
      .notNull()
      .default(sql`now() + interval '48 hours'`),
    sensitiveOutputsPurgedAt: timestamp('sensitive_outputs_purged_at', {
      withTimezone: true,
      mode: 'string',
    }),
    triggeredByUserId: text('triggered_by_user_id'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('package_runs_package_created_idx').on(t.packageId, t.createdAt),
    index('package_runs_status_created_idx').on(t.status, t.createdAt),
    index('package_runs_site_created_idx').on(t.siteId, t.createdAt),
    index('package_runs_parent_idx').on(t.parentRunId),
    index('package_runs_fanout_parent_idx').on(t.fanoutParentId),
    index('package_runs_ttl_idx')
      .on(t.outputsExpiresAt)
      .where(sql`sensitive_outputs_purged_at is null`),
    systemRls,
  ],
);

export const packageRunSteps = packagesSchema.table(
  'package_run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageRunId: uuid('package_run_id')
      .notNull()
      .references(() => packageRuns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    capabilityId: text('capability_id').notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'success', 'skip', 'fail'],
    })
      .notNull()
      .default('pending'),
    skipReason: text('skip_reason'),
    // Sensitive fields encrypted inline.
    resolvedInputs: jsonb('resolved_inputs').notNull().default(sql`'{}'::jsonb`),
    outputs: jsonb('outputs').notNull().default(sql`'{}'::jsonb`),
    errorClass: text('error_class'),
    errorMessage: text('error_message'),
    billable: boolean('billable').notNull().default(false),
    unitPrice: numeric('unit_price', { precision: 12, scale: 4 }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    auditLogIds: jsonb('audit_log_ids').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('package_run_steps_run_position').on(t.packageRunId, t.position),
    index('package_run_steps_run_idx').on(t.packageRunId),
    systemRls,
  ],
);

export type PackageDefinition = typeof packages.$inferSelect;
export type PackageRun = typeof packageRuns.$inferSelect;
export type PackageRunStep = typeof packageRunSteps.$inferSelect;
