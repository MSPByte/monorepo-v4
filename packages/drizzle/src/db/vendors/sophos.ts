import { uuid, text, boolean, integer, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { vendorsSchema } from '../schemas.js';
import { integrationLinks, sites, users } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const sophosEndpoints = vendorsSchema.table(
  'sophos_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
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
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const sophosTamperProtection = vendorsSchema.table(
  'sophos_tamper_protection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    endpointId: uuid('endpoint_id')
      .references(() => sophosEndpoints.id, { onDelete: 'cascade' })
      .notNull(),
    password: text('password').notNull(),
    previous: text('previous').array().notNull().default([]),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.endpointId), rls]
);

export const sophosFirewalls = vendorsSchema.table(
  'sophos_firewalls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
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
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const sophosLicenses = vendorsSchema.table(
  'sophos_licenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
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
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const sophosFirewallLicenses = vendorsSchema.table(
  'sophos_firewall_licenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    sourceHash: text('source_hash'),
    serialNumber: text('serial_number').notNull(),
    ownerType: text('owner_type').notNull(),
    model: text('model').notNull(),
    modelType: text('model_type', { enum: ['virtual', 'hardware'] }).notNull(),
    licenses: jsonb('licenses').notNull().default([]),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'string' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique().on(t.linkId, t.externalId), rls]
);

export const sophosEndpointMigrations = vendorsSchema.table(
  'sophos_endpoint_migrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sophosMigrationId: text('sophos_migration_id').notNull(),
    fromLinkId: uuid('from_link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    toLinkId: uuid('to_link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    fromSiteId: uuid('from_site_id').references(() => sites.id),
    toSiteId: uuid('to_site_id').references(() => sites.id),
    endpointIds: uuid('endpoint_ids').array().notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed', 'partial']
    })
      .notNull()
      .default('pending'),
    requestedCount: integer('requested_count').notNull(),
    succeededCount: integer('succeeded_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    finalizedCount: integer('finalized_count').notNull().default(0),
    initiatedBy: uuid('initiated_by').references(() => users.id, { onDelete: 'set null' }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('sophos_endpoint_migrations_from_link_idx').on(t.fromLinkId),
    index('sophos_endpoint_migrations_status_idx').on(t.status),
    unique().on(t.sophosMigrationId),
    crudPolicy({ role: authenticatedRole, read: true, modify: false })
  ]
);
