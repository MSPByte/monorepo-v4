import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid
} from 'drizzle-orm/pg-core';
import { integrationLinks, users } from './index.js';
import { sites } from './sites.js';

export const siteFactSource = pgEnum('e_site_fact_source', [
  'generated',
  'user_options',
  'user_free',
  'user_flex'
]);

export const siteProfileFields = pgTable(
  'site_profile_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    active: boolean('active').notNull(),
    label: text('label').notNull(),
    displayOrder: integer('display_order').default(0),
    section: text('section', { enum: ['executive', 'context'] }).notNull(),

    type: text('type', { enum: ['string', 'number', 'boolean'] }).notNull(),
    valueMode: text('value_mode', { enum: ['single', 'multiple'] })
      .notNull()
      .default('single'),
    values: jsonb('values'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique('unique_site_profile_options_key').on(t.key)]
);

export const siteProfileFacts = pgTable(
  'site_profile_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id').references(() => siteProfileFields.id, { onDelete: 'set null' }),

    key: text('key').notNull(),
    source: siteFactSource('source').notNull(),
    origin: text('origin').notNull().default('manual'),
    value: jsonb('value'),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }),
    applicable: text('applicable', { enum: ['applies', 'not_applicable', 'unknown'] }),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [unique('unique_site_key').on(t.key, t.siteId)]
);

export const siteProfileNotes = pgTable('site_profile_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),

  active: boolean('active').notNull(),
  type: text('type', { enum: ['special', 'tribal'] }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  severity: integer('severity').notNull(),

  updatedBy: uuid('updated_by')
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
});

export const siteStackCategories = pgTable(
  'site_stack_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description').notNull(),
    required: boolean('required').notNull().default(true),
    displayOrder: integer('display_order').notNull().default(0)
  },
  (t) => [unique('unique_site_stack_categories_key').on(t.key)]
);

export const siteStackEntries = pgTable('site_stack_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => siteStackCategories.id, { onDelete: 'cascade' }),
  canonicalId: uuid('canonical_id'),
  linkId: uuid('link_id').references(() => integrationLinks.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),

  vendor: text('vendor'),
  product: text('product'),
  status: text('status', { enum: ['managed', 'third_party', 'not_used', 'unknown'] }).notNull(),

  source: text('source', { enum: ['generated', 'manual'] }).notNull(),
  origin: text('origin').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
});

export type SiteProfileFields = typeof siteProfileFields.$inferSelect;
export type SiteProfileFacts = typeof siteProfileFacts.$inferSelect;
export type SiteProfileNotes = typeof siteProfileNotes.$inferSelect;
export type SiteProfileCategories = typeof siteStackCategories.$inferSelect;
export type SiteProfileEntries = typeof siteStackEntries.$inferSelect;
