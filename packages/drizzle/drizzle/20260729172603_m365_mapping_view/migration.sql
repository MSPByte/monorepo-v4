DROP VIEW "sites_with_counts";--> statement-breakpoint
CREATE VIEW "sites_with_counts" WITH (security_invoker = true) AS (
    select
      s.id,
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
      select array_agg(distinct il.integration_id order by il.integration_id) as sources
      from public.integration_links il
      where il.site_id = s.id
        and il.status in ('active', 'mapping')
    ) src on true
  );