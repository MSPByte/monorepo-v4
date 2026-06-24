import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid
} from 'drizzle-orm/pg-core';

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentSiteId: uuid('parent_site_id').references((): AnyPgColumn => sites.id, {
      onDelete: 'set null'
    }),
    name: text('name').notNull(),
    description: text('description'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('sites_parent_site_idx').on(t.parentSiteId),
    crudPolicy({ role: authenticatedRole, read: true, modify: true })
  ]
);

export const siteGroups = pgTable(
  'site_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique('site_groups_name_unique').on(t.name),
    crudPolicy({ role: authenticatedRole, read: true, modify: true })
  ]
);

export const siteGroupMembers = pgTable(
  'site_group_members',
  {
    siteGroupId: uuid('site_group_id')
      .notNull()
      .references(() => siteGroups.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique('site_group_members_unique').on(t.siteGroupId, t.siteId),
    index('site_group_members_site_idx').on(t.siteId),
    crudPolicy({ role: authenticatedRole, read: true, modify: true })
  ]
);

export type Site = typeof sites.$inferSelect;
export type SiteGroup = typeof siteGroups.$inferSelect;
export type SiteGroupMember = typeof siteGroupMembers.$inferSelect;
