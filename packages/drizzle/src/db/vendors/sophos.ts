import { uuid, text, boolean, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { vendorsSchema } from '../schemas.js';
import { integrationLinks, sites } from '../public/index.js';

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
