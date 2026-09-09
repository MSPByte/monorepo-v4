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
    // The small, authored operator contract for a package. Steps reference a
    // prompt id through their runtime binding; this keeps the runner focused
    // on the preset rather than exposing implementation inputs one by one.
    prompts: jsonb('prompts').notNull().default(sql`'[]'::jsonb`),
    // Ordered terminal lanes. These deliberately are not a general graph:
    // the main steps run first, then exactly one terminal lane may run.
    outcomeSteps: jsonb('outcome_steps')
      .notNull()
      .default(sql`'{"onSuccess":[],"onFailure":[]}'::jsonb`),
    // Ordered list of package-level FailureAction records (see @mspbyte/capabilities).
    // Worker executes them after any terminal failed/halted/partial state.
    failureActions: jsonb('failure_actions').notNull().default(sql`'[]'::jsonb`),
    // The package's public output contract: array of { name, sourceStepPosition,
    // sourcePath, outputType, description? } entries that a parent package can
    // wire to via priorOutput bindings when this package is referenced as a
    // sub-package step.
    exposedOutputs: jsonb('exposed_outputs').notNull().default(sql`'[]'::jsonb`),
    // Scoping: uuid arrays of sites/site-groups/integration-links this
    // package is allowed to run against. All empty => global.
    allowedSites: jsonb('allowed_sites').notNull().default(sql`'[]'::jsonb`),
    allowedSiteGroups: jsonb('allowed_site_groups').notNull().default(sql`'[]'::jsonb`),
    allowedIntegrationLinks: jsonb('allowed_integration_links')
      .notNull()
      .default(sql`'[]'::jsonb`),
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

// A one-time, durable launch request. The complete package snapshot and its
// resolved operator answers are captured here so a later package edit cannot
// silently change work that has already been scheduled.
export const packageSchedules = packagesSchema.table(
  'package_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'restrict' }),
    packageVersion: integer('package_version').notNull(),
    packageSnapshot: jsonb('package_snapshot').notNull(),
    linkId: uuid('link_id').references(() => integrationLinks.id, { onDelete: 'set null' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    runtimeInputs: jsonb('runtime_inputs').notNull().default(sql`'{}'::jsonb`),
    billingSnapshot: jsonb('billing_snapshot').notNull().default(sql`'{}'::jsonb`),
    // The operator's requested local wall-clock time and IANA zone are kept
    // alongside the absolute instant for a human-readable audit trail.
    scheduledLocalTime: text('scheduled_local_time').notNull(),
    timeZone: text('time_zone').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true, mode: 'string' }).notNull(),
    status: text('status', { enum: ['scheduled', 'dispatching', 'dispatched', 'canceled'] })
      .notNull()
      .default('scheduled'),
    createdByUserId: text('created_by_user_id').notNull(),
    canceledByUserId: text('canceled_by_user_id'),
    canceledAt: timestamp('canceled_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('package_schedules_due_idx').on(t.status, t.scheduledFor),
    index('package_schedules_package_idx').on(t.packageId, t.scheduledFor),
    index('package_schedules_site_idx').on(t.siteId, t.scheduledFor),
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
    // At most one run can be dispatched from a one-time schedule. The unique
    // constraint is the durable duplicate guard when scheduler replicas race.
    scheduleId: uuid('schedule_id').references(() => packageSchedules.id, {
      onDelete: 'set null',
    }),
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
      enum: ['manual', 'finding', 'scheduled', 'api', 'form'],
    }).notNull(),
    triggerRef: jsonb('trigger_ref'),
    startStepIndex: integer('start_step_index').notNull().default(0),
    // Sensitive fields inside runtimeInputs are encrypted inline as
    // `iv:tag:cipher` (see `packages/encryption`).
    runtimeInputs: jsonb('runtime_inputs').notNull().default(sql`'{}'::jsonb`),
    status: text('status', {
      enum: [
        'pending',
        'queued',
        'running',
        'completed',
        'failed',
        'halted',
        'partial',
        'canceled',
      ],
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
    // Immutable display label captured at dispatch time. A run may be created
    // by a person today or an automated finding/schedule tomorrow, so the
    // list never has to guess who (or what) initiated it from a nullable ID.
    triggerSourceLabel: text('trigger_source_label'),
    // Incremented when an operator reruns part of this job. It is also used
    // to make each BullMQ enqueue id unique while preserving one run record.
    executionAttempt: integer('execution_attempt').notNull().default(0),
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
    unique('package_runs_schedule_unique').on(t.scheduleId),
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
    // A run has one main path and at most one terminal reaction lane. Keeping
    // this explicit makes execution history understandable without admitting
    // arbitrary workflow graphs.
    lane: text('lane', { enum: ['main', 'on_success', 'on_failure'] })
      .notNull()
      .default('main'),
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
    unique('package_run_steps_run_lane_position').on(t.packageRunId, t.lane, t.position),
    index('package_run_steps_run_idx').on(t.packageRunId),
    systemRls,
  ],
);

// Reverse-index for sub-package references. One row per (parent, step_position)
// pair; supports cycle checks and "who references me" lookups without scanning
// every parent's steps jsonb. Rewritten atomically on every parent save.
export const packageDependencies = packagesSchema.table(
  'package_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentPackageId: uuid('parent_package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    childPackageId: uuid('child_package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'restrict' }),
    stepPosition: integer('step_position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('package_dependencies_parent_idx').on(t.parentPackageId),
    index('package_dependencies_child_idx').on(t.childPackageId),
    unique('package_dependencies_parent_step_unique').on(t.parentPackageId, t.stepPosition),
    authoredRls,
  ],
);

export type PackageDefinition = typeof packages.$inferSelect;
export type PackageRun = typeof packageRuns.$inferSelect;
export type PackageRunStep = typeof packageRunSteps.$inferSelect;
export type PackageDependency = typeof packageDependencies.$inferSelect;
