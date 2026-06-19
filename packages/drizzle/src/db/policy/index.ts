import {
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { crudPolicy, authenticatedRole } from "drizzle-orm/neon";
import { policySchema } from "../schemas.js";
import {
  integrationLinks,
  integrations,
  siteGroups,
  sites,
} from "../public/index.js";

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: true });

export const policies = policySchema.table(
  "policies",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["catalog", "custom"] })
      .notNull()
      .default("custom"),
    sourceId: text("source_id"),
    version: integer("version").notNull().default(1),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    providerId: text("provider_id").references(() => integrations.id, {
      onDelete: "set null",
    }),
    targetType: text("target_type", {
      enum: ["tenant", "site", "integration_link", "person", "asset", "vendor"],
    }).notNull(),
    severity: integer("severity").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    recommendation: text("recommendation"),
    definition: jsonb("definition").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("policies_provider_idx").on(t.providerId),
    index("policies_enabled_idx").on(t.enabled),
    rls,
  ],
);

export const policySets = policySchema.table(
  "policy_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source", { enum: ["catalog", "custom"] })
      .notNull()
      .default("custom"),
    sourceId: text("source_id"),
    version: integer("version").notNull().default(1),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    providerId: text("provider_id").references(() => integrations.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("policy_sets_name").on(t.name),
    index("policy_sets_provider_idx").on(t.providerId),
    rls,
  ],
);

export const policySetItems = policySchema.table(
  "policy_set_items",
  {
    policySetId: uuid("policy_set_id")
      .notNull()
      .references(() => policySets.id, { onDelete: "cascade" }),
    policyId: text("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("policy_set_items_unique").on(t.policySetId, t.policyId), rls],
);

export const policyAssignments = policySchema.table(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type", { enum: ["policy", "policy_set"] })
      .notNull()
      .default("policy"),
    policyId: text("policy_id").references(() => policies.id, {
      onDelete: "cascade",
    }),
    policySetId: uuid("policy_set_id").references(() => policySets.id, {
      onDelete: "cascade",
    }),
    scopeType: text("scope_type", {
      enum: ["global", "site", "site_group", "integration_link"],
    })
      .notNull()
      .default("global"),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "cascade",
    }),
    siteGroupId: uuid("site_group_id").references(() => siteGroups.id, {
      onDelete: "cascade",
    }),
    linkId: uuid("link_id").references(() => integrationLinks.id, {
      onDelete: "cascade",
    }),
    includeChildSites: boolean("include_child_sites").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    parameters: jsonb("parameters").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("policy_assignments_policy_idx").on(t.policyId),
    index("policy_assignments_policy_set_idx").on(t.policySetId),
    index("policy_assignments_scope_idx").on(
      t.scopeType,
      t.siteId,
      t.siteGroupId,
      t.linkId,
    ),
    rls,
  ],
);

export const findings = policySchema.table(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: text("policy_id")
      .notNull()
      .references(() => policies.id),
    policySetId: uuid("policy_set_id").references(() => policySets.id, {
      onDelete: "set null",
    }),
    policyAssignmentId: uuid("policy_assignment_id").references(
      () => policyAssignments.id,
      { onDelete: "set null" },
    ),
    providerId: text("provider_id").references(() => integrations.id, {
      onDelete: "set null",
    }),
    linkId: uuid("link_id").references(() => integrationLinks.id, {
      onDelete: "cascade",
    }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    resourceType: text("resource_type").notNull(),
    resourceTable: text("resource_table"),
    resourceId: text("resource_id").notNull(),
    resourceExternalId: text("resource_external_id"),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    severity: integer("severity").notNull(),
    status: text("status", {
      enum: ["open", "acknowledged", "suppressed", "resolved", "regressed"],
    })
      .notNull()
      .default("open"),
    evidence: jsonb("evidence").notNull().default({}),
    impact: jsonb("impact").notNull().default({}),
    remediation: jsonb("remediation").notNull().default({}),
    recommendation: text("recommendation"),
    firstSeenAt: timestamp("first_seen_at", {
      withTimezone: true,
      mode: "string",
    })
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
    suppressedUntil: timestamp("suppressed_until", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("findings_fingerprint_unique").on(t.fingerprint),
    index("findings_work_queue_idx").on(t.status, t.severity, t.lastSeenAt),
    index("findings_resource_idx").on(t.resourceType, t.resourceId),
    index("findings_policy_idx").on(t.policyId, t.status),
    index("findings_scope_idx").on(t.siteId, t.linkId, t.status),
    rls,
  ],
);

export type Finding = typeof findings.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type PolicyAssignment = typeof policyAssignments.$inferSelect;
export type PolicySet = typeof policySets.$inferSelect;
