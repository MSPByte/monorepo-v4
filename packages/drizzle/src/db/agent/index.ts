import { uuid, text, integer, jsonb, timestamp, varchar } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { agentSchema } from '../schemas.js';
import { sites } from '../public/index.js';

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

// Per-site enrollment token. Long-standing; MSP regenerates when needed.
// The plaintext token is never stored — only a SHA-256 hex digest.
export const agentSiteTokens = agentSchema.table(
  'site_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .unique()
      .references(() => sites.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
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

// Per-site config bundle: branding, tray menu, form definitions.
// The etag is a SHA-256 hex digest of the data JSON used for 304 responses.
export const agentBundles = agentSchema.table(
  'bundles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .unique()
      .references(() => sites.id, { onDelete: 'cascade' }),
    etag: varchar('etag', { length: 64 }).notNull(),
    data: jsonb('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

export type Agent = typeof agents.$inferSelect;
export type AgentLog = typeof agentLogs.$inferSelect;
export type AgentTicket = typeof agentTickets.$inferSelect;
export type AgentSiteToken = typeof agentSiteTokens.$inferSelect;
export type AgentBundle = typeof agentBundles.$inferSelect;
export type AgentForm = typeof agentForms.$inferSelect;
