CREATE TABLE "integration_link_site_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "link_id" uuid NOT NULL REFERENCES "integration_links"("id") ON DELETE CASCADE,
  "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "source" text NOT NULL DEFAULT 'manual',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "integration_link_site_assignments_unique" UNIQUE("link_id", "site_id")
);--> statement-breakpoint
ALTER TABLE "integration_link_site_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "integration_link_site_assignments_site_idx" ON "integration_link_site_assignments" ("site_id");--> statement-breakpoint
CREATE INDEX "integration_link_site_assignments_link_idx" ON "integration_link_site_assignments" ("link_id");--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "integration_link_site_assignments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "integration_link_site_assignments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "integration_link_site_assignments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "integration_link_site_assignments" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE TABLE "m365_domain_site_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "link_id" uuid NOT NULL REFERENCES "integration_links"("id") ON DELETE CASCADE,
  "domain" text NOT NULL,
  "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "m365_domain_site_mappings_unique" UNIQUE("link_id", "domain")
);--> statement-breakpoint
ALTER TABLE "m365_domain_site_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "m365_domain_site_mappings_site_idx" ON "m365_domain_site_mappings" ("site_id");--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "m365_domain_site_mappings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "m365_domain_site_mappings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "m365_domain_site_mappings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "m365_domain_site_mappings" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint

-- Move legacy domain mappings onto their active tenant links. Child mapping
-- links never owned M365 ingestion and are intentionally removed below.
INSERT INTO "integration_link_site_assignments" ("link_id", "site_id", "source")
SELECT il.id, (mapping->>'siteId')::uuid, 'migration'
FROM "integration_links" il
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(il.meta->'siteMappings', '[]'::jsonb)) AS mapping
WHERE il.integration_id = 'microsoft-365'
  AND il.site_id IS NULL
  AND mapping ? 'siteId'
ON CONFLICT ("link_id", "site_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "m365_domain_site_mappings" ("link_id", "domain", "site_id")
SELECT il.id, lower(domain.value), (mapping->>'siteId')::uuid
FROM "integration_links" il
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(il.meta->'siteMappings', '[]'::jsonb)) AS mapping
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(mapping->'domains', '[]'::jsonb)) AS domain(value)
WHERE il.integration_id = 'microsoft-365'
  AND il.site_id IS NULL
  AND mapping ? 'siteId'
ON CONFLICT ("link_id", "domain") DO UPDATE SET "site_id" = EXCLUDED."site_id", "updated_at" = now();--> statement-breakpoint
INSERT INTO "integration_link_site_assignments" ("link_id", "site_id", "source")
SELECT (child.meta->>'parentLinkId')::uuid, child.site_id, 'migration'
FROM "integration_links" child
WHERE child.integration_id = 'microsoft-365'
  AND child.status = 'mapping'
  AND child.meta->>'source' = 'domain-mapping'
  AND child.meta ? 'parentLinkId'
ON CONFLICT ("link_id", "site_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "m365_domain_site_mappings" ("link_id", "domain", "site_id")
SELECT (child.meta->>'parentLinkId')::uuid, lower(domain.value), child.site_id
FROM "integration_links" child
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(child.meta->'domains', '[]'::jsonb)) AS domain(value)
WHERE child.integration_id = 'microsoft-365'
  AND child.status = 'mapping'
  AND child.meta->>'source' = 'domain-mapping'
  AND child.meta ? 'parentLinkId'
  AND child.site_id IS NOT NULL
ON CONFLICT ("link_id", "domain") DO UPDATE SET "site_id" = EXCLUDED."site_id", "updated_at" = now();--> statement-breakpoint
-- Ensure existing M365 identities immediately reflect the normalized domain
-- attribution table, including clearing identities with no domain mapping.
UPDATE "vendors"."m365_identities" identity
SET "site_id" = (
  SELECT mapping."site_id"
  FROM "m365_domain_site_mappings" mapping
  WHERE mapping."link_id" = link."id"
    AND mapping."domain" = lower(split_part(identity."email", '@', 2))
)
FROM "integration_links" link
WHERE identity."link_id" = link."id"
  AND link."integration_id" = 'microsoft-365'
  AND link."site_id" IS NULL
  AND identity."site_id" IS DISTINCT FROM (
    SELECT mapping."site_id"
    FROM "m365_domain_site_mappings" mapping
    WHERE mapping."link_id" = link."id"
      AND mapping."domain" = lower(split_part(identity."email", '@', 2))
  );--> statement-breakpoint
DELETE FROM "integration_links"
WHERE integration_id = 'microsoft-365'
  AND status = 'mapping'
  AND meta->>'source' = 'domain-mapping';--> statement-breakpoint
UPDATE "integration_links"
SET meta = meta - 'siteMappings'
WHERE integration_id = 'microsoft-365'
  AND site_id IS NULL
  AND meta ? 'siteMappings';--> statement-breakpoint
DROP VIEW IF EXISTS "sites_with_counts";--> statement-breakpoint
CREATE VIEW "sites_with_counts" WITH (security_invoker = true) AS (
  SELECT
    s.id,
    s.name,
    s.description,
    COALESCE(a.asset_count, 0)::int AS asset_count,
    COALESCE(p.people_count, 0)::int AS people_count,
    COALESCE(f.open_finding_count, 0)::int AS open_finding_count,
    100::int AS framework_score,
    100::int AS policy_health,
    COALESCE(src.sources, ARRAY[]::text[]) AS sources,
    COALESCE(array_to_string(src.sources, ', '), '') AS source_list,
    s.created_at,
    s.updated_at
  FROM public.sites s
  LEFT JOIN LATERAL (SELECT count(*)::int AS asset_count FROM canonical.assets a WHERE a.site_id = s.id) a ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS people_count FROM canonical.people p WHERE p.site_id = s.id) p ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS open_finding_count FROM policy.findings pf WHERE pf.site_id = s.id AND pf.status IN ('open', 'acknowledged', 'regressed')) f ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT source.integration_id ORDER BY source.integration_id) AS sources
    FROM (
      SELECT il.integration_id
      FROM public.integration_links il
      WHERE il.site_id = s.id AND il.status IN ('active', 'mapping')
      UNION
      SELECT il.integration_id
      FROM public.integration_link_site_assignments ils
      JOIN public.integration_links il ON il.id = ils.link_id
      WHERE ils.site_id = s.id AND il.status = 'active'
    ) source
  ) src ON true
);
