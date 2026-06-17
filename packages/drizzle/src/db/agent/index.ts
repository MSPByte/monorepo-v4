import { uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
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
    ipAddress: text('ip_address'),
    extAddress: text('ext_address'),
    macAddress: text('mac_address'),
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

export type Agent = typeof agents.$inferSelect;
export type AgentLog = typeof agentLogs.$inferSelect;
export type AgentTicket = typeof agentTickets.$inferSelect;
