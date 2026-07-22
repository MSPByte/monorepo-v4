import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  unique,
  index,
  boolean
} from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { sites } from './sites.js';

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description'),
    level: integer('level').notNull().default(0),
    // DEPRECATED: legacy boolean-bag attributes. Replaced by `permissions`.
    // Retained until Stage 4 so the migration path can translate on the fly.
    attributes: jsonb('attributes').notNull().default({}),
    permissions: text('permissions').array().notNull().default([]),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authUserId: text('auth_user_id').notNull().unique(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    // DEPRECATED: single-role FK. Replaced by `user_role_grants`. Retained
    // until Stage 4 for the migration window; do not read in new code.
    roleId: uuid('role_id').references(() => roles.id),
    preferences: jsonb('preferences').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

export const userRoleGrants = pgTable(
  'user_role_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    scopeKind: text('scope_kind', { enum: ['all', 'sites', 'groups'] }).notNull(),
    scopeIds: uuid('scope_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique('user_role_grants_uniq').on(t.userId, t.roleId, t.scopeKind, t.scopeIds),
    index('user_role_grants_user_id_idx').on(t.userId),
    crudPolicy({ role: authenticatedRole, read: true, modify: true })
  ]
);

// id is the stable integration type string, e.g. 'microsoft-365', 'sophos'
export const integrations = pgTable(
  'integrations',
  {
    id: text('id').primaryKey(),
    config: jsonb('config').notNull(),
    credentialExpiration: timestamp('credential_expiration', {
      withTimezone: true,
      mode: 'string'
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })]
);

export const integrationLinks = pgTable(
  'integration_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id'),
    name: text('name'),
    status: text('status', {
      enum: ['active', 'error', 'disabled', 'dispositioned']
    }).default('active'),
    disposition: text('disposition', {
      enum: ['managed', 'third_party', 'not_managed']
    }),
    note: text('note'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique().on(t.integrationId, t.externalId),
    index('integration_links_status_idx').on(t.status),
    crudPolicy({ role: authenticatedRole, read: true, modify: true })
  ]
);

export type Role = typeof roles.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserRoleGrant = typeof userRoleGrants.$inferSelect;
export type NewUserRoleGrant = typeof userRoleGrants.$inferInsert;
export type Integration = typeof integrations.$inferSelect;
export type IntegrationLink = typeof integrationLinks.$inferSelect;

export * from './views/index.js';
export * from './sites.js';
export * from './site-profile.js';
