import { uuid, text, integer, numeric, timestamp, unique } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { vendorsSchema } from '../schemas.js';
import { integrationLinks, sites } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

export const haloPsaRecurringItems = vendorsSchema.table(
  'halopsa_recurring_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => integrationLinks.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id),
    externalId: text('external_id').notNull(),
    externalClientId: text('external_client_id'),
    externalSiteId: text('external_site_id'),
    externalContractId: text('external_contract_id'),
    externalInvoiceId: text('external_invoice_id'),
    externalItemId: text('external_item_id'),
    itemName: text('item_name').notNull(),
    description: text('description'),
    quantity: integer('quantity').notNull().default(0),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
    cost: numeric('cost', { precision: 12, scale: 2 }),
    recurringPeriod: text('recurring_period'),
    sourceHash: text('source_hash'),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
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

export type HaloPsaRecurringItem = typeof haloPsaRecurringItems.$inferSelect;
