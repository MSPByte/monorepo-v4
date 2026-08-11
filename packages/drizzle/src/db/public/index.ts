import {
  index,
  unique,
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  uniqueIndex,
  boolean
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { sites, siteGroups } from './sites.js';

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description'),
    level: integer('level').notNull().default(0),
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
      enum: ['active', 'error', 'disabled', 'dispositioned', 'mapping']
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
    uniqueIndex('integration_links_tenant_unique')
      .on(t.integrationId, t.externalId)
      .where(sql`${t.siteId} is null`),
    uniqueIndex('integration_links_site_tenant_unique')
      .on(t.integrationId, t.externalId, t.siteId)
      .where(sql`${t.siteId} is not null`),
    index('integration_links_status_idx').on(t.status),
    crudPolicy({ role: authenticatedRole, read: true, modify: true })
  ]
);

export const siteGroupLinkMembers = pgTable(
  'site_group_link_members',
  {
    siteGroupId: uuid('site_group_id')
      .notNull()
      .references(() => siteGroups.id, { onDelete: 'cascade' }),
    integrationLinkId: uuid('integration_link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique('site_group_link_members_unique').on(t.siteGroupId, t.integrationLinkId),
    index('site_group_link_members_link_idx').on(t.integrationLinkId),
    crudPolicy({ role: authenticatedRole, read: true, modify: true })
  ]
);

export type Role = typeof roles.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserRoleGrant = typeof userRoleGrants.$inferSelect;
export type NewUserRoleGrant = typeof userRoleGrants.$inferInsert;
export type Integration = typeof integrations.$inferSelect;
export type IntegrationLink = typeof integrationLinks.$inferSelect;
export type SiteGroupLinkMember = typeof siteGroupLinkMembers.$inferSelect;

export * from './views/index.js';
export * from './sites.js';
export * from './site-profile.js';
