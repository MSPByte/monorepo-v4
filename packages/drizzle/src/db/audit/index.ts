import { uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { auditSchema } from '../schemas.js';
import { sites } from '../public/index.js';

export const auditActorEnum = auditSchema.enum('e_audit_actor', ['user', 'system']);
export const auditActionsEnum = auditSchema.enum('e_audit_actions', ['create', 'update', 'delete']);
export const auditResultEnum = auditSchema.enum('e_audit_result', [
  'success',
  'failure',
  'partial'
]);

export const customerLogs = auditSchema.table(
  'customer_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').references(() => sites.id),
    actorType: auditActorEnum('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    actorLabel: text('actor_label').notNull(),
    action: auditActionsEnum('action').notNull(),
    actionLabel: text('action_label'),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    targetLabel: text('target_label').notNull(),
    result: auditResultEnum('result').notNull(),
    errorMessage: text('error_message'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [crudPolicy({ role: authenticatedRole, read: true, modify: false })]
);

export type CustomerLog = typeof customerLogs.$inferSelect;
export type NewCustomerLog = typeof customerLogs.$inferInsert;
