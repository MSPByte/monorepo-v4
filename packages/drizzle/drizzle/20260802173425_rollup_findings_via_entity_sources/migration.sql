DROP VIEW "canonical"."assets_with_sites";--> statement-breakpoint
CREATE VIEW "canonical"."assets_with_sites" WITH (security_invoker = true) AS (
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
      where pf.status in ('open', 'acknowledged', 'regressed')
        and (
          (pf.resource_type = 'asset' and pf.resource_id = a.id::text)
          or pf.resource_id in (
            select es.vendor_record_id::text
            from canonical.entity_sources es
            where es.canonical_type = 'asset'
              and es.canonical_id = a.id
              and es.status = 'confirmed'
          )
        )
    ) f on true
  );--> statement-breakpoint
DROP VIEW "canonical"."people_with_sites";--> statement-breakpoint
CREATE VIEW "canonical"."people_with_sites" WITH (security_invoker = true) AS (
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
      where pf.status in ('open', 'acknowledged', 'regressed')
        and (
          (pf.resource_type = 'person' and pf.resource_id = p.id::text)
          or pf.resource_id in (
            select es.vendor_record_id::text
            from canonical.entity_sources es
            where es.canonical_type = 'person'
              and es.canonical_id = p.id
              and es.status = 'confirmed'
          )
        )
    ) f on true
  );
