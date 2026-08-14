import { uuid, text, boolean, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { policySchema } from '../schemas.js';
import { integrations } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: true });

export const factRules = policySchema.table(
  'fact_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    providerId: text('provider_id').references(() => integrations.id, { onDelete: 'set null' }),
    factKey: text('fact_key').notNull(),
    priority: integer('priority').notNull().default(0),
    definition: jsonb('definition').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('fact_rules_enabled_idx').on(t.enabled),
    index('fact_rules_provider_idx').on(t.providerId),
    rls
  ]
);

export type FactRule = typeof factRules.$inferSelect;
export type NewFactRule = typeof factRules.$inferInsert;
