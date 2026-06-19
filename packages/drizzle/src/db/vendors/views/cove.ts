import { sql } from 'drizzle-orm';
import { uuid, text, integer, bigint, timestamp, boolean } from 'drizzle-orm/pg-core';
import { vendorsSchema } from '../../schemas.js';

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
