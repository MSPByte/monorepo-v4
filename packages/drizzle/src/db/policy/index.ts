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

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const policies = policySchema.table(
  "policies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    targetType: text("target_type", { enum: ["person", "asset"] }).notNull(),
    severity: integer("severity").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    definition: jsonb("definition").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  () => [rls],
);

export const policySets = policySchema.table(
  "policy_sets",
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
  (t) => [unique("policy_sets_name").on(t.name), rls],
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

export const findings = policySchema.table(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: text("policy_id")
      .notNull()
      .references(() => policies.id),
    resourceType: text("resource_type", {
      enum: ["person", "asset"],
    }).notNull(),
    resourceId: uuid("resource_id").notNull(),
    siteId: uuid("site_id"),
    fingerprint: text("fingerprint").notNull(),
    severity: integer("severity").notNull(),
    status: text("status", {
      enum: ["open", "acknowledged", "suppressed", "resolved", "regressed"],
    })
      .notNull()
      .default("open"),
    evidence: jsonb("evidence").notNull().default({}),
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
    rls,
  ],
);

export type Finding = typeof findings.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type PolicySet = typeof policySets.$inferSelect;
