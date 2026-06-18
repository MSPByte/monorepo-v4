import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  index,
  unique,
} from "drizzle-orm/pg-core";
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
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: true })],
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

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    definitionId: text("definition_id"),
    linkId: uuid("link_id").references(() => integrationLinks.id, {
      onDelete: "cascade",
    }),
    siteId: uuid("site_id").references(() => sites.id),
    entityType: text("entity_type"),
    entityRef: text("entity_ref"),
    entityId: text("entity_id"),
    status: text("status", { enum: ["active", "resolved", "suppressed"] })
      .notNull()
      .default("active"),
    severity: integer("severity").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    firstSeen: timestamp("first_seen", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      mode: "string",
    }),
    suppressedAt: timestamp("suppressed_at", {
      withTimezone: true,
      mode: "string",
    }),
    suppressedUntil: timestamp("suppressed_until", {
      withTimezone: true,
      mode: "string",
    }),
    suppressionNote: text("suppression_note"),
    suppressedBy: text("suppressed_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("alerts_upsert_idx").on(
      t.linkId,
      t.definitionId,
      t.entityRef,
      t.status,
    ),
    index("alerts_dashboard_idx").on(t.siteId, t.status),
    index("alerts_link_status_seen_idx").on(t.linkId, t.status, t.lastSeenAt),
    crudPolicy({ role: authenticatedRole, read: true, modify: true }),
  ],
);

export * from "./views/sites.js";

export type Role = typeof roles.$inferSelect;
export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type IntegrationLink = typeof integrationLinks.$inferSelect;
