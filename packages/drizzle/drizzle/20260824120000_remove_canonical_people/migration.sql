-- Canonical people are no longer modeled. Remove their dependent data and
-- rebuild the views before dropping the table.
DELETE FROM canonical.entity_sources WHERE canonical_type = 'person';--> statement-breakpoint
DELETE FROM policy.findings WHERE resource_type = 'person';--> statement-breakpoint
DELETE FROM policy.findings
WHERE policy_id IN (SELECT id FROM policy.policies WHERE target_type = 'person');--> statement-breakpoint
DELETE FROM policy.policies WHERE target_type = 'person';--> statement-breakpoint
DROP VIEW IF EXISTS canonical.people_with_sites;--> statement-breakpoint
DROP VIEW IF EXISTS policy.findings_with_context;--> statement-breakpoint
DROP VIEW IF EXISTS public.sites_with_counts;--> statement-breakpoint
DROP TABLE canonical.people;--> statement-breakpoint
CREATE VIEW public.sites_with_counts WITH (security_invoker = true) AS (
  SELECT
    s.id,
    s.name,
    s.description,
    coalesce(a.asset_count, 0)::int AS asset_count,
    coalesce(f.open_finding_count, 0)::int AS open_finding_count,
    100::int AS framework_score,
    100::int AS policy_health,
    coalesce(src.sources, array[]::text[]) AS sources,
    coalesce(array_to_string(src.sources, ', '), '') AS source_list,
    s.created_at,
    s.updated_at
  FROM public.sites s
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS asset_count FROM canonical.assets a WHERE a.site_id = s.id
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS open_finding_count
    FROM policy.findings pf
    WHERE pf.site_id = s.id AND pf.status IN ('open', 'acknowledged', 'regressed')
  ) f ON true
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
);--> statement-breakpoint
CREATE VIEW policy.findings_with_context WITH (security_invoker = true) AS (
  SELECT
    f.id, f.policy_id, p.name AS policy_name, f.provider_id, f.link_id, f.site_id,
    coalesce(l.name, '-') AS link_name, coalesce(s.name, '-') AS site_name,
    f.resource_type, f.resource_table, f.resource_id,
    coalesce(a.display_name, f.resource_external_id, f.resource_id) AS resource_name,
    f.resource_external_id, f.fingerprint, f.title, f.summary, f.severity, f.status,
    coalesce(f.summary, f.evidence->>'summary', 'Structured evidence is available on the finding.') AS evidence_summary,
    f.recommendation, f.suppressed_until, f.suppressed_at, f.suppression_reason,
    f.suppressed_by, f.first_seen_at, f.last_seen_at
  FROM policy.findings f
  INNER JOIN policy.policies p ON p.id = f.policy_id
  LEFT JOIN public.sites s ON s.id = f.site_id
  LEFT JOIN public.integration_links l ON l.id = f.link_id
  LEFT JOIN canonical.assets a ON f.resource_type = 'asset' AND f.resource_id = a.id::text
);
