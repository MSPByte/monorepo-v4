import { sql } from 'drizzle-orm';
import { pgView, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const sitesOverview = pgView('sites_overview', {
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  integrations: text('integrations').array().notNull(),
  alertCount: integer('alert_count').notNull(),
  criticalCount: integer('critical_count').notNull(),
  highCount: integer('high_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull()
}).with({ securityInvoker: true }).as(sql`
  select
    s.id,
    s.name,
    s.description,
    coalesce(i.integrations, array[]::text[]) as integrations,
    coalesce(a.alert_count, 0) as alert_count,
    coalesce(a.critical_count, 0) as critical_count,
    coalesce(a.high_count, 0) as high_count,
    s.created_at,
    s.updated_at
  from public.sites s
  left join (
    select
      l.site_id,
      array_agg(distinct l.integration_id order by l.integration_id) as integrations
    from public.integration_links l
    where l.status = 'active'
    group by l.site_id
  ) i on i.site_id = s.id
  left join (
    select
      a.site_id,
      count(*)::int as alert_count,
      count(*) filter (where a.severity >= 3)::int as critical_count,
      count(*) filter (where a.severity = 2)::int as high_count
    from public.alerts a
    where a.status = 'active'
    group by a.site_id
  ) a on a.site_id = s.id
`);
