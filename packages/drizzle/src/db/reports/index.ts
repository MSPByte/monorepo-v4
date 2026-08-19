import { uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { reportsSchema } from '../schemas.js';
import { users } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: true });

export const reports = reportsSchema.table(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    source: text('source').notNull(),
    definition: jsonb('definition').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('reports_source_idx').on(t.source),
    index('reports_created_by_idx').on(t.createdBy),
    rls
  ]
);

export const dashboards = reportsSchema.table(
  'dashboards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    layout: jsonb('layout').notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [index('dashboards_created_by_idx').on(t.createdBy), rls]
);

export const dashboardTiles = reportsSchema.table(
  'dashboard_tiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['kpi', 'table', 'bar', 'line', 'donut'] }).notNull(),
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
    inlineDef: jsonb('inline_def'),
    viz: jsonb('viz').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('dashboard_tiles_dashboard_idx').on(t.dashboardId),
    index('dashboard_tiles_report_idx').on(t.reportId),
    rls
  ]
);

export const userReportPrefs = reportsSchema.table(
  'user_report_prefs',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    landingDashboardId: uuid('landing_dashboard_id').references(() => dashboards.id, {
      onDelete: 'set null'
    }),
    scopeKind: text('scope_kind', { enum: ['all', 'sites', 'groups', 'links'] })
      .notNull()
      .default('all'),
    scopeIds: uuid('scope_ids').array().notNull().default([]),
    favoriteReportIds: uuid('favorite_report_ids').array().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  () => [rls]
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;
export type DashboardTile = typeof dashboardTiles.$inferSelect;
export type NewDashboardTile = typeof dashboardTiles.$inferInsert;
export type UserReportPrefs = typeof userReportPrefs.$inferSelect;
export type NewUserReportPrefs = typeof userReportPrefs.$inferInsert;
