import { sql } from 'drizzle-orm';
import { uuid, text, integer, bigint, timestamp, boolean } from 'drizzle-orm/pg-core';
import { vendorsSchema } from '../../schemas.js';

export const coveSiteOverview = vendorsSchema
  .view('cove_site_overview', {
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
    highCount: integer('high_count').notNull()
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
    )
    select
      l.id as link_id,
      l.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      l.name as link_name,
      l.external_id,
      l.disposition,
      (l.disposition is not null) as dispositioned,
      l.note,
      coalesce(a.alert_count, 0) as alert_count,
      a.highest_severity,
      coalesce(a.critical_count, 0) as critical_count,
      coalesce(a.high_count, 0) as high_count
    from public.integration_links l
    left join public.sites s on s.id = l.site_id
    left join alert_summary a on a.link_id = l.id
    where l.integration_id = 'cove'
      and l.status = 'active'
  `);

export const coveEndpointsWithSite = vendorsSchema
  .view('cove_endpoints_with_site', {
    id: uuid('id').notNull(),
    linkId: uuid('link_id').notNull(),
    siteId: uuid('site_id'),
    siteName: text('site_name').notNull(),
    externalId: text('external_id').notNull(),
    endpointName: text('endpoint_name').notNull(),
    hostname: text('hostname').notNull(),
    type: text('type', { enum: ['workstation', 'server'] }).notNull(),
    profile: text('profile').notNull(),
    retentionPolicy: text('retention_policy').notNull(),
    status: text('status', { enum: ['active', 'inactive', 'error'] }).notNull(),
    lsvStatus: text('lsv_status'),
    errors: integer('errors').notNull(),
    selectedSize: bigint('selected_size', { mode: 'number' }).notNull(),
    usedStorage: bigint('used_storage', { mode: 'number' }).notNull(),
    last28Days: text('last_28_days').notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'string' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull()
  })
  .with({ securityInvoker: true }).as(sql`
    select
      e.id,
      e.link_id,
      e.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      e.external_id,
      e.endpoint_name,
      e.hostname,
      e.type,
      e.profile,
      e.retention_policy,
      e.status,
      e.lsv_status,
      e.errors,
      e.selected_size,
      e.used_storage,
      e.last_28_days,
      e.last_success_at,
      e.last_seen_at,
      e.created_at,
      e.updated_at
    from vendors.cove_endpoints e
    inner join public.integration_links l on l.id = e.link_id
    left join public.sites s on s.id = coalesce(e.site_id, l.site_id)
  `);
