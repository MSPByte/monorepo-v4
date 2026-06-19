import { sql } from 'drizzle-orm';
import { uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { vendorsSchema } from '../../schemas.js';

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
