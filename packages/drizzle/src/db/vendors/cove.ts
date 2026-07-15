import { uuid, text, integer, bigint, timestamp, unique } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { vendorsSchema } from '../schemas.js';
import { integrationLinks, sites } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const coveEndpoints = vendorsSchema.table(
  'cove_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    endpointName: text('endpoint_name').notNull(),
    hostname: text('hostname').notNull(),
    type: text('type', { enum: ['workstation', 'server'] }).notNull(),
    profile: text('profile').notNull(),
    retentionPolicy: text('retention_policy').notNull(),
    status: text('status', { enum: ['active', 'inactive', 'error'] }).notNull(),
    lsvStatus: text('lsv_status'),
    errors: integer('errors').notNull().default(0),
    selectedSize: bigint('selected_size', { mode: 'number' }).notNull().default(0),
    usedStorage: bigint('used_storage', { mode: 'number' }).notNull().default(0),
    last28Days: text('last_28_days').notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'string' }),
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
  (t) => [unique().on(t.linkId, t.externalId), rls]
);
