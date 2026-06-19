import {
  uuid,
  text,
  timestamp,
  jsonb,
  unique,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { crudPolicy, authenticatedRole } from "drizzle-orm/neon";
import { canonicalSchema } from "../schemas.js";
import { integrationLinks, sites } from "../public/index.js";

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const people = canonicalSchema.table(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    primaryEmail: text("primary_email").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "inactive", "unknown"] })
      .notNull()
      .default("unknown"),
    sourceConfidence: text("source_confidence", {
      enum: ["high", "medium", "low"],
    })
      .notNull()
      .default("high"),
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("people_site_email").on(t.siteId, t.primaryEmail),
    index("people_email_idx").on(t.primaryEmail),
    rls,
  ],
);

export const assets = canonicalSchema.table(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    hostname: text("hostname"),
    serialNumber: text("serial_number"),
    os: text("os"),
    assetType: text("asset_type", {
      enum: ["workstation", "server", "network", "mobile", "unknown"],
    })
      .notNull()
      .default("unknown"),
    status: text("status", { enum: ["active", "inactive", "unknown"] })
      .notNull()
      .default("unknown"),
    sourceConfidence: text("source_confidence", {
      enum: ["high", "medium", "low"],
    })
      .notNull()
      .default("medium"),
    attributes: jsonb("attributes").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assets_site_hostname_idx").on(t.siteId, t.hostname),
    index("assets_site_serial_idx").on(t.siteId, t.serialNumber),
    rls,
  ],
);

export const entitySources = canonicalSchema.table(
  "entity_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalType: text("canonical_type", {
      enum: ["person", "asset"],
    }).notNull(),
    canonicalId: uuid("canonical_id").notNull(),
    vendorTable: text("vendor_table").notNull(),
    vendorRecordId: uuid("vendor_record_id").notNull(),
    linkId: uuid("link_id").references(() => integrationLinks.id, {
      onDelete: "cascade",
    }),
    siteId: uuid("site_id"),
    provider: text("provider").notNull(),
    type: text("type").notNull(),
    externalId: text("external_id").notNull(),
    confidence: integer("confidence").notNull(),
    matchMethod: text("match_method").notNull(),
    matchEvidence: jsonb("match_evidence").notNull().default({}),
    status: text("status", {
      enum: ["candidate", "confirmed", "rejected", "superseded"],
    })
      .notNull()
      .default("confirmed"),
    manuallyConfirmedAt: timestamp("manually_confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
    manuallyRejectedAt: timestamp("manually_rejected_at", {
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
    unique("entity_sources_vendor_record").on(t.vendorTable, t.vendorRecordId),
    index("entity_sources_canonical_idx").on(t.canonicalType, t.canonicalId),
    index("entity_sources_lookup_idx").on(t.provider, t.type, t.externalId),
    rls,
  ],
);

export const assetsWithSites = canonicalSchema
  .view("assets_with_sites", {
    id: uuid("id").notNull(),
    siteId: uuid("site_id"),
    siteName: text("site_name").notNull(),
    displayName: text("display_name").notNull(),
    hostname: text("hostname"),
    serialNumber: text("serial_number"),
    os: text("os"),
    assetType: text("asset_type", {
      enum: ["workstation", "server", "network", "mobile", "unknown"],
    }).notNull(),
    status: text("status", { enum: ["active", "inactive", "unknown"] }).notNull(),
    sourceConfidence: text("source_confidence", {
      enum: ["high", "medium", "low"],
    }).notNull(),
    sources: text("sources").array().notNull(),
    sourceList: text("source_list").notNull(),
    openFindingCount: integer("open_finding_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  })
  .with({ securityInvoker: true })
  .as(sql`
    select
      a.id,
      a.site_id,
      coalesce(s.name, 'Unassigned') as site_name,
      a.display_name,
      a.hostname,
      a.serial_number,
      a.os,
      a.asset_type,
      a.status,
      a.source_confidence,
      coalesce(src.sources, array[]::text[]) as sources,
      coalesce(array_to_string(src.sources, ', '), '') as source_list,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      a.created_at,
      a.updated_at
    from canonical.assets a
    left join public.sites s on s.id = a.site_id
    left join lateral (
      select array_agg(distinct es.provider order by es.provider) as sources
      from canonical.entity_sources es
      where es.canonical_type = 'asset'
        and es.canonical_id = a.id
        and es.status = 'confirmed'
    ) src on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.resource_type = 'asset'
        and pf.resource_id = a.id::text
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
  `);

export const peopleWithSites = canonicalSchema
  .view("people_with_sites", {
    id: uuid("id").notNull(),
    siteId: uuid("site_id"),
    siteName: text("site_name").notNull(),
    primaryEmail: text("primary_email").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "inactive", "unknown"] }).notNull(),
    sourceConfidence: text("source_confidence", {
      enum: ["high", "medium", "low"],
    }).notNull(),
    sources: text("sources").array().notNull(),
    sourceList: text("source_list").notNull(),
    openFindingCount: integer("open_finding_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  })
  .with({ securityInvoker: true })
  .as(sql`
    select
      p.id,
      p.site_id,
      coalesce(s.name, 'Unassigned') as site_name,
      p.primary_email,
      p.display_name,
      p.status,
      p.source_confidence,
      coalesce(src.sources, array[]::text[]) as sources,
      coalesce(array_to_string(src.sources, ', '), '') as source_list,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      p.created_at,
      p.updated_at
    from canonical.people p
    left join public.sites s on s.id = p.site_id
    left join lateral (
      select array_agg(distinct es.provider order by es.provider) as sources
      from canonical.entity_sources es
      where es.canonical_type = 'person'
        and es.canonical_id = p.id
        and es.status = 'confirmed'
    ) src on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.resource_type = 'person'
        and pf.resource_id = p.id::text
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
  `);

export type EntitySource = typeof entitySources.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type AssetWithSite = typeof assetsWithSites.$inferSelect;
export type PersonWithSite = typeof peopleWithSites.$inferSelect;
