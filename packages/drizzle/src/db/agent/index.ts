import { uuid, text, integer, jsonb, timestamp, varchar, boolean, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { agentSchema } from '../schemas.js';
import { sites, siteGroups } from '../public/index.js';

export const agents = agentSchema.table(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    platform: text('platform').notNull(),
    version: text('version').notNull(),
    machineId: text('machine_id'),
    serial: text('serial'),
    username: text('username'),
    sid: text('sid'),
    ipAddress: text('ip_address'),
    extAddress: text('ext_address'),
    macAddress: text('mac_address'),
    lastCheckinAt: timestamp('last_checkin_at', { withTimezone: true, mode: 'string' }),
    registeredAt: timestamp('registered_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' })
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

export const agentLogs = agentSchema.table(
  'logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    message: text('message').notNull(),
    status: integer('status').notNull(),
    timeElapsedMs: integer('time_elapsed_ms').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: false })]
);

export const agentTickets = agentSchema.table(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id').notNull(),
    summary: text('summary'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

// Per-site enrollment token. The hash enables fast existence checks; the AES-GCM
// encrypted ciphertext enables plaintext reveal and CSV export without storing raw tokens.
export const agentSiteTokens = agentSchema.table(
  'site_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .unique()
      .references(() => sites.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenEncrypted: text('token_encrypted'),
    label: text('label'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' })
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

// Tenant-wide form definitions. `rows` is the display-safe field tree; `psaMappings`
// maps field IDs to PSA ticket fields and is never sent to agents.
export const agentForms = agentSchema.table(
  'forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    rows: jsonb('rows').notNull().default([]),
    ticketTitle: text('ticket_title'),
    ticketBody: text('ticket_body'),
    psaMappings: jsonb('psa_mappings').notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

// Tenant-wide named config bundles (branding, tray, form list).
// Previously per-site; now reusable configs assigned to sites or site groups via agentBundleAssignments.
// The etag is a SHA-256 hex digest of the data JSON, used for 304 responses when agents poll.
export const agentBundles = agentSchema.table(
  'bundles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    etag: varchar('etag', { length: 64 }).notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

// Maps a named config bundle to a site or site group.
// Resolution order at bundle serve time: site assignment → site group assignment → isDefault bundle.
export const agentBundleAssignments = agentSchema.table(
  'bundle_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bundleId: uuid('bundle_id')
      .notNull()
      .references(() => agentBundles.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    siteGroupId: uuid('site_group_id').references(() => siteGroups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('bundle_assignments_site_unique').on(t.siteId),
    unique('bundle_assignments_site_group_unique').on(t.siteGroupId),
    check('chk_assignment_target', sql`(${t.siteId} IS NOT NULL AND ${t.siteGroupId} IS NULL) OR (${t.siteId} IS NULL AND ${t.siteGroupId} IS NOT NULL)`),
    crudPolicy({ role: authenticatedRole, read: true, modify: true }),
  ]
);

export type Agent = typeof agents.$inferSelect;
export type AgentLog = typeof agentLogs.$inferSelect;
export type AgentTicket = typeof agentTickets.$inferSelect;
export type AgentSiteToken = typeof agentSiteTokens.$inferSelect;
export type AgentBundle = typeof agentBundles.$inferSelect;
export type AgentBundleAssignment = typeof agentBundleAssignments.$inferSelect;
export type AgentForm = typeof agentForms.$inferSelect;
