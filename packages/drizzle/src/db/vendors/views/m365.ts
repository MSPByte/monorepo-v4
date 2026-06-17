import { sql } from 'drizzle-orm';
import { uuid, text, integer, boolean } from 'drizzle-orm/pg-core';
import { vendorsSchema } from '../../schemas.js';

export const m365TenantOverview = vendorsSchema
  .view('m365_tenant_overview', {
    linkId: uuid('link_id').notNull(),
    siteId: uuid('site_id'),
    siteName: text('site_name').notNull(),
    linkName: text('link_name'),
    externalId: text('external_id'),
    disposition: text('disposition', { enum: ['managed', 'third_party', 'not_managed'] }),
    dispositioned: boolean('dispositioned').notNull(),
    note: text('note'),
    alertCount: integer('alert_count').notNull(),
    highestSeverity: integer('highest_severity'),
    criticalCount: integer('critical_count').notNull(),
    highCount: integer('high_count').notNull(),
    complianceFailures: integer('compliance_failures').notNull()
  })
  .with({ securityInvoker: true }).as(sql`
    with alert_summary as (
      select
        link_id,
        count(*)::int as alert_count,
        max(severity)::int as highest_severity,
        count(*) filter (where severity >= 3)::int as critical_count,
        count(*) filter (where severity = 2)::int as high_count
      from public.alerts
      where status = 'active'
      group by link_id
    ),
    compliance_summary as (
      select
        link_id,
        count(*)::int as compliance_failures
      from (
        select distinct on (framework_check_id, link_id)
          framework_check_id,
          link_id,
          status
        from compliance.results
        where link_id is not null
        order by framework_check_id, link_id, evaluated_at desc
      ) latest_results
      where status = 'fail'
      group by link_id
    )
    select
      l.id as link_id,
      l.site_id,
      coalesce(l.name, l.external_id, l.id::text) as site_name,
      l.name as link_name,
      l.external_id,
      l.disposition,
      (l.disposition is not null) as dispositioned,
      l.note,
      coalesce(a.alert_count, 0) as alert_count,
      a.highest_severity,
      coalesce(a.critical_count, 0) as critical_count,
      coalesce(a.high_count, 0) as high_count,
      coalesce(c.compliance_failures, 0) as compliance_failures
    from public.integration_links l
    left join alert_summary a on a.link_id = l.id
    left join compliance_summary c on c.link_id = l.id
    where l.integration_id = 'microsoft-365'
      and l.status = 'active'
  `);
