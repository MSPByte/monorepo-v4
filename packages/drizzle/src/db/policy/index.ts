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
import { sql } from "drizzle-orm";
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

export const findingsWithContext = policySchema
  .view("findings_with_context", {
    id: uuid("id").notNull(),
    policyId: text("policy_id").notNull(),
    policyName: text("policy_name").notNull(),
    providerId: text("provider_id"),
    linkId: uuid("link_id"),
    siteId: uuid("site_id"),
    siteName: text("site_name").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceTable: text("resource_table"),
    resourceId: text("resource_id").notNull(),
    resourceName: text("resource_name").notNull(),
    resourceExternalId: text("resource_external_id"),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    severity: integer("severity").notNull(),
    status: text("status", {
      enum: ["open", "acknowledged", "suppressed", "resolved", "regressed"],
    }).notNull(),
    evidenceSummary: text("evidence_summary").notNull(),
    recommendation: text("recommendation"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "string" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  })
  .with({ securityInvoker: true })
  .as(sql`
    select
      f.id,
      f.policy_id,
      p.name as policy_name,
      f.provider_id,
      f.link_id,
      f.site_id,
      coalesce(s.name, 'Unassigned') as site_name,
      f.resource_type,
      f.resource_table,
      f.resource_id,
      coalesce(a.display_name, pe.display_name, f.resource_external_id, f.resource_id) as resource_name,
      f.resource_external_id,
      f.fingerprint,
      f.title,
      f.summary,
      f.severity,
      f.status,
      coalesce(f.summary, f.evidence->>'summary', 'Structured evidence is available on the finding.') as evidence_summary,
      f.recommendation,
      f.first_seen_at,
      f.last_seen_at
    from policy.findings f
    inner join policy.policies p on p.id = f.policy_id
    left join public.sites s on s.id = f.site_id
    left join canonical.assets a on f.resource_type = 'asset' and f.resource_id = a.id::text
    left join canonical.people pe on f.resource_type = 'person' and f.resource_id = pe.id::text
  `);

export const policiesWithStats = policySchema
  .view("policies_with_stats", {
    id: text("id").notNull(),
    source: text("source", { enum: ["catalog", "custom"] }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    providerId: text("provider_id"),
    targetType: text("target_type").notNull(),
    scope: text("scope").notNull(),
    severity: integer("severity").notNull(),
    enabled: boolean("enabled").notNull(),
    recommendation: text("recommendation"),
    frameworkList: text("framework_list").notNull(),
    openFindingCount: integer("open_finding_count").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  })
  .with({ securityInvoker: true })
  .as(sql`
    select
      p.id,
      p.source,
      p.name,
      p.description,
      p.category,
      p.provider_id,
      p.target_type,
      p.target_type as scope,
      p.severity,
      p.enabled,
      p.recommendation,
      coalesce(fr.framework_list, '') as framework_list,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      p.updated_at
    from policy.policies p
    left join lateral (
      select string_agg(distinct ps.name, ', ' order by ps.name) as framework_list
      from policy.policy_set_items psi
      inner join policy.policy_sets ps on ps.id = psi.policy_set_id
      where psi.policy_id = p.id
    ) fr on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.policy_id = p.id
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
  `);

export const policySetsWithStats = policySchema
  .view("policy_sets_with_stats", {
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    providerId: text("provider_id"),
    enabled: boolean("enabled").notNull(),
    policyCount: integer("policy_count").notNull(),
    openFindings: integer("open_findings").notNull(),
    passRate: integer("pass_rate").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  })
  .with({ securityInvoker: true })
  .as(sql`
    select
      ps.id,
      ps.name,
      ps.description,
      ps.category,
      ps.provider_id,
      ps.enabled,
      coalesce(pc.policy_count, 0)::int as policy_count,
      coalesce(of.open_findings, 0)::int as open_findings,
      case
        when coalesce(pc.policy_count, 0) = 0 then 100
        else greatest(0, least(100, round(100 - (coalesce(of.open_findings, 0)::numeric / pc.policy_count::numeric * 10))::int))
      end as pass_rate,
      ps.updated_at
    from policy.policy_sets ps
    left join lateral (
      select count(*)::int as policy_count
      from policy.policy_set_items psi
      where psi.policy_set_id = ps.id
    ) pc on true
    left join lateral (
      select count(distinct f.id)::int as open_findings
      from policy.policy_set_items psi
      inner join policy.findings f on f.policy_id = psi.policy_id
      where psi.policy_set_id = ps.id
        and f.status in ('open', 'acknowledged', 'regressed')
    ) of on true
  `);

export type Finding = typeof findings.$inferSelect;
export type FindingWithContext = typeof findingsWithContext.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type PolicyAssignment = typeof policyAssignments.$inferSelect;
export type PolicySet = typeof policySets.$inferSelect;
export type PolicyWithStats = typeof policiesWithStats.$inferSelect;
export type PolicySetWithStats = typeof policySetsWithStats.$inferSelect;
