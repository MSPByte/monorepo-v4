import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  index,
  unique,
  pgView,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { crudPolicy, authenticatedRole } from "drizzle-orm/neon";

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    description: text("description"),
    level: integer("level").notNull().default(0),
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: text("auth_user_id").notNull().unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    roleId: uuid("role_id").references(() => roles.id),
    preferences: jsonb("preferences").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })],
);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentSiteId: uuid("parent_site_id").references(
      (): AnyPgColumn => sites.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    description: text("description"),
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sites_parent_site_idx").on(t.parentSiteId),
    crudPolicy({ role: authenticatedRole, read: true, modify: true }),
  ],
);

export const siteGroups = pgTable(
  "site_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("site_groups_name_unique").on(t.name),
    crudPolicy({ role: authenticatedRole, read: true, modify: true }),
  ],
);

export const siteGroupMembers = pgTable(
  "site_group_members",
  {
    siteGroupId: uuid("site_group_id")
      .notNull()
      .references(() => siteGroups.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("site_group_members_unique").on(t.siteGroupId, t.siteId),
    index("site_group_members_site_idx").on(t.siteId),
    crudPolicy({ role: authenticatedRole, read: true, modify: true }),
  ],
);

// id is the stable integration type string, e.g. 'microsoft-365', 'sophos'
export const integrations = pgTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    config: jsonb("config").notNull(),
    credentialExpiration: timestamp("credential_expiration", {
      withTimezone: true,
      mode: "string",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })],
);

export const integrationLinks = pgTable(
  "integration_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id),
    externalId: text("external_id"),
    name: text("name"),
    status: text("status", {
      enum: ["active", "error", "disabled", "dispositioned"],
    }).default("active"),
    disposition: text("disposition", {
      enum: ["managed", "third_party", "not_managed"],
    }),
    note: text("note"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.integrationId, t.externalId),
    crudPolicy({ role: authenticatedRole, read: true, modify: true }),
  ],
);

export const sitesWithCounts = pgView("sites_with_counts", {
  id: uuid("id").notNull(),
  parentSiteId: uuid("parent_site_id"),
  name: text("name").notNull(),
  description: text("description"),
  assetCount: integer("asset_count").notNull(),
  peopleCount: integer("people_count").notNull(),
  openFindingCount: integer("open_finding_count").notNull(),
  frameworkScore: integer("framework_score").notNull(),
  policyHealth: integer("policy_health").notNull(),
  sources: text("sources").array().notNull(),
  sourceList: text("source_list").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})
  .with({ securityInvoker: true })
  .as(sql`
    select
      s.id,
      s.parent_site_id,
      s.name,
      s.description,
      coalesce(a.asset_count, 0)::int as asset_count,
      coalesce(p.people_count, 0)::int as people_count,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      100::int as framework_score,
      100::int as policy_health,
      coalesce(src.sources, array[]::text[]) as sources,
      coalesce(array_to_string(src.sources, ', '), '') as source_list,
      s.created_at,
      s.updated_at
    from public.sites s
    left join lateral (
      select count(*)::int as asset_count
      from canonical.assets a
      where a.site_id = s.id
    ) a on true
    left join lateral (
      select count(*)::int as people_count
      from canonical.people p
      where p.site_id = s.id
    ) p on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.site_id = s.id
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
    left join lateral (
      select array_agg(distinct es.provider order by es.provider) as sources
      from canonical.entity_sources es
      where es.site_id = s.id
        and es.status = 'confirmed'
    ) src on true
  `);

export type Role = typeof roles.$inferSelect;
export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type SiteWithCounts = typeof sitesWithCounts.$inferSelect;
export type SiteGroup = typeof siteGroups.$inferSelect;
export type SiteGroupMember = typeof siteGroupMembers.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type IntegrationLink = typeof integrationLinks.$inferSelect;
