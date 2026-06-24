import { sql } from 'drizzle-orm';
import { integer, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sitesWithCounts = pgView('sites_with_counts', {
  id: uuid('id').notNull(),
  parentSiteId: uuid('parent_site_id'),
  name: text('name').notNull(),
  description: text('description'),
  assetCount: integer('asset_count').notNull(),
  peopleCount: integer('people_count').notNull(),
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
      s.parent_site_id,
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
      select array_agg(distinct es.provider order by es.provider) as sources
      from canonical.entity_sources es
      where es.site_id = s.id
        and es.status = 'confirmed'
    ) src on true
  `);

export type SiteWithCounts = typeof sitesWithCounts.$inferSelect;
