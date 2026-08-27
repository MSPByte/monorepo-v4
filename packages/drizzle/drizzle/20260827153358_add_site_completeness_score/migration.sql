-- Custom SQL migration file, put your code below! --
DROP VIEW IF EXISTS public.sites_with_counts;--> statement-breakpoint
CREATE VIEW public.sites_with_counts WITH (security_invoker = true) AS (
  SELECT
    s.id,
    s.name,
    s.description,
    coalesce(a.asset_count, 0)::int AS asset_count,
    coalesce(f.open_finding_count, 0)::int AS open_finding_count,
    CASE
      WHEN completeness.applicable_count = 0 THEN 0
      ELSE round(completeness.complete_count * 100.0 / completeness.applicable_count)::int
    END AS completeness_score,
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
    SELECT
      count(*) FILTER (
        WHERE CASE
          WHEN fact.id IS NULL THEN 'unknown'
          ELSE coalesce(fact.applicable, 'applies')
        END != 'not_applicable'
      )::int AS applicable_count,
      count(*) FILTER (
        WHERE CASE
          WHEN fact.id IS NULL THEN 'unknown'
          ELSE coalesce(fact.applicable, 'applies')
        END != 'not_applicable'
          AND fact.value IS NOT NULL
          AND fact.value != 'null'::jsonb
          AND fact.value != '""'::jsonb
          AND fact.value != '[]'::jsonb
      )::int AS complete_count
    FROM public.site_profile_options field
    LEFT JOIN public.site_profile_facts fact
      ON fact.site_id = s.id
      AND fact.key = field.key
    WHERE field.active = true
  ) completeness ON true
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
