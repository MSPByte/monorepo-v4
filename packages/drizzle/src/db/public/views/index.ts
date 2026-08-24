import { sql } from 'drizzle-orm';
import { integer, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sitesWithCounts = pgView('sites_with_counts', {
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  assetCount: integer('asset_count').notNull(),
  openFindingCount: integer('open_finding_count').notNull(),
  frameworkScore: integer('framework_score').notNull(),
  policyHealth: integer('policy_health').notNull(),
  sources: text('sources').array().notNull(),
  sourceList: text('source_list').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull()
}).with({ securityInvoker: true }).as(sql`
    select
      s.id,
      s.name,
      s.description,
      coalesce(a.asset_count, 0)::int as asset_count,
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
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.site_id = s.id
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
    left join lateral (
      select array_agg(distinct source.integration_id order by source.integration_id) as sources
      from (
        select il.integration_id
        from public.integration_links il
        where il.site_id = s.id
          and il.status in ('active', 'mapping')
        union
        select il.integration_id
        from public.integration_link_site_assignments ils
        join public.integration_links il on il.id = ils.link_id
        where ils.site_id = s.id
          and il.status = 'active'
      ) source
    ) src on true
  `);

export type SiteWithCounts = typeof sitesWithCounts.$inferSelect;
