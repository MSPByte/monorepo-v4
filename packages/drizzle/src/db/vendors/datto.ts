import { uuid, text, boolean, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { vendorsSchema } from '../schemas.js';
import { integrationLinks, sites } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const dattoEndpoints = vendorsSchema.table(
  'datto_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    hostname: text('hostname').notNull(),
    category: text('category', { enum: ['workstation', 'server', 'other'] }).notNull(),
    os: text('os').notNull(),
    ipAddress: text('ip_address').notNull(),
    extAddress: text('ext_address').notNull(),
    online: boolean('online').notNull(),
    udfs: jsonb('udfs').notNull().default({}),
    lastRebootAt: timestamp('last_reboot_at', { withTimezone: true, mode: 'string' }).notNull(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true, mode: 'string' }),
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
