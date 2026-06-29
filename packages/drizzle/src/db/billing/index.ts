import {
  uuid,
  text,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
  index
} from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { billingSchema } from '../schemas.js';
import { integrationLinks, sites } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: true });

export const billingPsaItems = billingSchema.table(
  'psa_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceProvider: text('source_provider').notNull(),
    sourceTable: text('source_table').notNull(),
    sourceId: uuid('source_id'),
    linkId: uuid('link_id').references(() => integrationLinks.id, { onDelete: 'set null' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    externalId: text('external_id').notNull(),
    customerName: text('customer_name'),
    contractName: text('contract_name'),
    itemName: text('item_name').notNull(),
    description: text('description'),
    quantity: integer('quantity').notNull().default(0),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
    cost: numeric('cost', { precision: 12, scale: 2 }),
    recurringPeriod: text('recurring_period'),
    rawSummary: jsonb('raw_summary').notNull().default({}),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique().on(t.sourceProvider, t.externalId),
    index('billing_psa_items_site_idx').on(t.siteId),
    rls
  ]
);

export const billingReconciliationRules = billingSchema.table(
  'reconciliation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    psaItemMatch: jsonb('psa_item_match').notNull().default({}),
    vendorProvider: text('vendor_provider').notNull(),
    vendorFacet: text('vendor_facet').notNull(),
    vendorFilters: jsonb('vendor_filters').notNull().default([]),
    countMode: text('count_mode').notNull().default('count_rows'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [index('billing_reconciliation_rules_site_idx').on(t.siteId), rls]
);

export const billingReconciliationRuns = billingSchema.table(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
    trigger: text('trigger', { enum: ['manual', 'scheduled'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    error: text('error')
  },
  () => [rls]
);

export const billingReconciliationResults = billingSchema.table(
  'reconciliation_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => billingReconciliationRuns.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    psaItemId: uuid('psa_item_id').references(() => billingPsaItems.id, { onDelete: 'set null' }),
    ruleId: uuid('rule_id').references(() => billingReconciliationRules.id, {
      onDelete: 'set null'
    }),
    billedQuantity: integer('billed_quantity').notNull().default(0),
    actualQuantity: integer('actual_quantity').notNull().default(0),
    diffQuantity: integer('diff_quantity').notNull().default(0),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
    monthlyDelta: numeric('monthly_delta', { precision: 12, scale: 2 }).notNull().default('0'),
    status: text('status', {
      enum: ['matched', 'underbilled', 'overbilled', 'missing_rule', 'missing_psa_line']
    }).notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('billing_reconciliation_results_run_idx').on(t.runId),
    index('billing_reconciliation_results_site_idx').on(t.siteId),
    rls
  ]
);

export type BillingPsaItem = typeof billingPsaItems.$inferSelect;
export type BillingReconciliationRule = typeof billingReconciliationRules.$inferSelect;
export type BillingReconciliationRun = typeof billingReconciliationRuns.$inferSelect;
export type BillingReconciliationResult = typeof billingReconciliationResults.$inferSelect;
