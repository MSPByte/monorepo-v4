import { sql } from 'drizzle-orm';
import { uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { vendorsSchema } from '../../schemas.js';

export const sophosSiteOverview = vendorsSchema
  .view('sophos_site_overview', {
    linkId: uuid('link_id').notNull(),
    siteId: uuid('site_id'),
    siteName: text('site_name').notNull(),
    linkName: text('link_name'),
    externalId: text('external_id'),
    disposition: text('disposition', { enum: ['managed', 'third_party', 'not_managed'] }),
    dispositioned: boolean('dispositioned').notNull(),
    note: text('note'),
    serverTier: text('server_tier'),
    endpointTier: text('endpoint_tier'),
    alertCount: integer('alert_count').notNull(),
    highestSeverity: integer('highest_severity'),
    criticalCount: integer('critical_count').notNull(),
    highCount: integer('high_count').notNull()
  })
  .with({ securityInvoker: true }).as(sql`
    with license_tiers as (
      select
        link_id,
        min(
          case
            when code = 'SVRCIXAMTR-STD-MSP' then 1
            when code = 'SVRCIXAXDR' then 2
            when code = 'SVRCLOUDADV-MSP' then 3
          end
        ) as server_rank,
        min(
          case
            when code = 'CIXAMTR-STD-MSP' then 1
            when code = 'CIXAXDR' then 2
            when code = 'CIXA-MSP' then 3
          end
        ) as endpoint_rank
      from vendors.sophos_licenses
      where ends_at is null or ends_at > now()
      group by link_id
    ),
    alert_summary as (
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
      case lt.server_rank
        when 1 then 'MDR'
        when 2 then 'XDR'
        when 3 then 'Endpoint'
      end as server_tier,
      case lt.endpoint_rank
        when 1 then 'MDR'
        when 2 then 'XDR'
        when 3 then 'Endpoint'
      end as endpoint_tier,
      coalesce(a.alert_count, 0) as alert_count,
      a.highest_severity,
      coalesce(a.critical_count, 0) as critical_count,
      coalesce(a.high_count, 0) as high_count
    from public.integration_links l
    left join public.sites s on s.id = l.site_id
    left join license_tiers lt on lt.link_id = l.id
    left join alert_summary a on a.link_id = l.id
    where l.integration_id = 'sophos-partner'
      and l.status = 'active'
  `);

export const sophosEndpointsWithSite = vendorsSchema
  .view('sophos_endpoints_with_site', {
    id: uuid('id').notNull(),
    linkId: uuid('link_id').notNull(),
    siteId: uuid('site_id'),
    siteName: text('site_name').notNull(),
    externalId: text('external_id').notNull(),
    hostname: text('hostname').notNull(),
    type: text('type', { enum: ['computer', 'server'] }).notNull(),
    platform: text('platform').notNull(),
    osName: text('os_name').notNull(),
    health: text('health', { enum: ['good', 'suspicious', 'bad', 'unknown'] }).notNull(),
    online: boolean('online').notNull(),
    needsUpgrade: boolean('needs_upgrade').notNull(),
    hasMdr: boolean('has_mdr').notNull(),
    tamperProtectionEnabled: boolean('tamper_protection_enabled').notNull(),
    lockdown: text('lockdown').notNull(),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true, mode: 'string' }),
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
      e.hostname,
      e.type,
      e.platform,
      e.os_name,
      e.health,
      e.online,
      e.needs_upgrade,
      e.has_mdr,
      e.tamper_protection_enabled,
      e.lockdown,
      e.last_heartbeat_at,
      e.last_seen_at,
      e.created_at,
      e.updated_at
    from vendors.sophos_endpoints e
    inner join public.integration_links l on l.id = e.link_id
    left join public.sites s on s.id = coalesce(e.site_id, l.site_id)
  `);

export const sophosFirewallsWithSite = vendorsSchema
  .view('sophos_firewalls_with_site', {
    id: uuid('id').notNull(),
    linkId: uuid('link_id').notNull(),
    siteId: uuid('site_id'),
    siteName: text('site_name').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    hostname: text('hostname').notNull(),
    model: text('model').notNull(),
    serialNumber: text('serial_number').notNull(),
    firmwareVersion: text('firmware_version').notNull(),
    externalIp: text('external_ip').notNull(),
    connected: boolean('connected').notNull(),
    suspended: boolean('suspended').notNull(),
    managing: text('managing').notNull(),
    reporting: text('reporting').notNull(),
    upgradeToVersion: text('upgrade_to_version'),
    lastChangeAt: timestamp('last_change_at', { withTimezone: true, mode: 'string' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull()
  })
  .with({ securityInvoker: true }).as(sql`
    select
      f.id,
      f.link_id,
      f.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      f.external_id,
      f.name,
      f.hostname,
      f.model,
      f.serial_number,
      f.firmware_version,
      f.external_ip,
      f.connected,
      f.suspended,
      f.managing,
      f.reporting,
      f.upgrade_to_version,
      f.last_change_at,
      f.last_seen_at,
      f.created_at,
      f.updated_at
    from vendors.sophos_firewalls f
    inner join public.integration_links l on l.id = f.link_id
    left join public.sites s on s.id = coalesce(f.site_id, l.site_id)
  `);

export const sophosLicensesWithSite = vendorsSchema
  .view('sophos_licenses_with_site', {
    id: uuid('id').notNull(),
    linkId: uuid('link_id').notNull(),
    siteId: uuid('site_id'),
    siteName: text('site_name').notNull(),
    externalId: text('external_id').notNull(),
    licenseId: text('license_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    perpetual: boolean('perpetual').notNull(),
    unlimited: boolean('unlimited').notNull(),
    quantity: integer('quantity'),
    usageCount: integer('usage_count'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull()
  })
  .with({ securityInvoker: true }).as(sql`
    select
      li.id,
      li.link_id,
      li.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      li.external_id,
      li.license_id,
      li.code,
      li.name,
      li.type,
      li.perpetual,
      li.unlimited,
      li.quantity,
      li.usage_count,
      li.started_at,
      li.ends_at,
      li.last_seen_at,
      li.created_at,
      li.updated_at
    from vendors.sophos_licenses li
    inner join public.integration_links l on l.id = li.link_id
    left join public.sites s on s.id = coalesce(li.site_id, l.site_id)
  `);
