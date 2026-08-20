import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  dashboards,
  dashboardTiles,
  reports,
  userReportPrefs,
  type NewDashboardTile
} from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';

// Dashboards live in the reports domain and inherit its permission model.
// Any user with Reports.Read can view; Write to create/edit; Delete to remove.

function requireReportsRead(ctx: Context) {
  if (!ctx.can('Reports.Read')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Reports.Read permission required' });
  }
}

function requireReportsWrite(ctx: Context) {
  if (!ctx.can('Reports.Write')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Reports.Write permission required' });
  }
}

function requireReportsDelete(ctx: Context) {
  if (!ctx.can('Reports.Delete')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Reports.Delete permission required' });
  }
}

// -- tile viz schema --------------------------------------------------------

const kpiVizSchema = z.object({
  aggregation: z.enum(['count']).default('count'),
  // Reserved for future sum/avg/distinct; ignored today.
  field: z.string().optional(),
  format: z.enum(['number', 'percent']).default('number'),
  // Cosmetic hint for the tile.
  tone: z.enum(['neutral', 'primary', 'warning', 'danger', 'success']).default('neutral'),
  // Optional short caption under the value.
  caption: z.string().optional()
});

const chartVizSchema = z.object({
  // Placeholder — chart kinds land in a later PR.
  labelField: z.string().optional(),
  valueField: z.string().optional()
});

const tileVizSchema = z.union([kpiVizSchema, chartVizSchema]);

const tileInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  kind: z.enum(['kpi', 'table', 'bar', 'line', 'donut']),
  reportId: z.string().uuid().optional().nullable(),
  inlineDef: z.record(z.string(), z.unknown()).optional().nullable(),
  viz: tileVizSchema
});

const layoutEntrySchema = z.object({
  tileId: z.string().uuid(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).default(3),
  h: z.number().int().min(1).default(2)
});

const saveDashboardSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  layout: z.array(layoutEntrySchema).default([]),
  tiles: z.array(tileInputSchema).default([])
});

// -- KPI computation --------------------------------------------------------

/**
 * v1 KPI: computes total row count of the tile's underlying report. Row
 * fetching is skipped by passing pageSize=1 and reading `total`. Sum/avg/
 * distinct aggregations land in a follow-up — they need row-level access
 * (or a SQL rewrite of queryTableData) and shouldn't gate the first cut.
 */
async function computeKpi(
  ctx: Context,
  reportId: string,
  reportsRouterRun: (opts: {
    reportId: string;
    table: { page: number; pageSize: number; filters: [] };
  }) => Promise<{ total: number }>
): Promise<number> {
  const result = await reportsRouterRun({
    reportId,
    table: { page: 1, pageSize: 1, filters: [] }
  });
  return result.total;
}

// -- router -----------------------------------------------------------------

export const dashboardsRouter = t.router({
  list: authProcedure.query(async ({ ctx }) => {
    requireReportsRead(ctx);
    const rows = await ctx.db
      .select({
        id: dashboards.id,
        name: dashboards.name,
        description: dashboards.description,
        createdBy: dashboards.createdBy,
        createdAt: dashboards.createdAt,
        updatedAt: dashboards.updatedAt,
        tileCount: sql<number>`(
          select count(*)::int from reports.dashboard_tiles
          where dashboard_id = ${dashboards.id}
        )`.as('tile_count')
      })
      .from(dashboards)
      .orderBy(dashboards.name);
    const [prefs] = await ctx.db
      .select({ landing: userReportPrefs.landingDashboardId })
      .from(userReportPrefs)
      .where(eq(userReportPrefs.userId, ctx.user.id))
      .limit(1);
    const pinnedId = prefs?.landing ?? null;
    return rows.map((row) => ({ ...row, pinned: row.id === pinnedId }));
  }),

  byId: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireReportsRead(ctx);
      const [dashboard] = await ctx.db
        .select()
        .from(dashboards)
        .where(eq(dashboards.id, input.id))
        .limit(1);
      if (!dashboard) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
      const tiles = await ctx.db
        .select()
        .from(dashboardTiles)
        .where(eq(dashboardTiles.dashboardId, input.id));
      return { ...dashboard, tiles };
    }),

  save: authProcedure.input(saveDashboardSchema).mutation(async ({ ctx, input }) => {
    requireReportsWrite(ctx);

    // Guard: every tile that references a report must reference one that
    // exists — silent orphans on a dashboard are worse than a save error.
    const referencedReportIds = input.tiles
      .map((t) => t.reportId)
      .filter((id): id is string => !!id);
    if (referencedReportIds.length) {
      const existing = await ctx.db
        .select({ id: reports.id })
        .from(reports)
        .where(inArray(reports.id, referencedReportIds));
      const found = new Set(existing.map((row) => row.id));
      const missing = referencedReportIds.filter((id) => !found.has(id));
      if (missing.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Tile references unknown report(s): ${missing.join(', ')}`
        });
      }
    }

    const now = new Date().toISOString();
    let dashboardId = input.id;

    if (dashboardId) {
      const [updated] = await ctx.db
        .update(dashboards)
        .set({
          name: input.name,
          description: input.description ?? null,
          layout: input.layout,
          updatedAt: now
        })
        .where(eq(dashboards.id, dashboardId))
        .returning({ id: dashboards.id });
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
      }
      // Replace tiles wholesale. Simpler than diffing IDs and safe because
      // dashboards are cheap objects; the layout array carries positions.
      await ctx.db.delete(dashboardTiles).where(eq(dashboardTiles.dashboardId, dashboardId));
    } else {
      const [created] = await ctx.db
        .insert(dashboards)
        .values({
          name: input.name,
          description: input.description ?? null,
          layout: input.layout,
          createdBy: ctx.user.id,
          createdAt: now,
          updatedAt: now
        })
        .returning({ id: dashboards.id });
      dashboardId = created!.id;
    }

    if (input.tiles.length) {
      const values: NewDashboardTile[] = input.tiles.map((tile) => ({
        dashboardId: dashboardId!,
        title: tile.title,
        kind: tile.kind,
        reportId: tile.reportId ?? null,
        inlineDef: tile.inlineDef ?? null,
        viz: tile.viz
      }));
      await ctx.db.insert(dashboardTiles).values(values);
    }

    // Return the freshly persisted state so the client can rehydrate tile
    // IDs (previously-unsaved tiles get real UUIDs on save).
    const [dashboard] = await ctx.db
      .select()
      .from(dashboards)
      .where(eq(dashboards.id, dashboardId!))
      .limit(1);
    const tiles = await ctx.db
      .select()
      .from(dashboardTiles)
      .where(eq(dashboardTiles.dashboardId, dashboardId!));
    return { ...dashboard!, tiles };
  }),

  delete: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireReportsDelete(ctx);
      const [deleted] = await ctx.db
        .delete(dashboards)
        .where(eq(dashboards.id, input.id))
        .returning({ id: dashboards.id });
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
      // If this dashboard was someone's landing page, clear it.
      await ctx.db
        .update(userReportPrefs)
        .set({ landingDashboardId: null })
        .where(eq(userReportPrefs.landingDashboardId, input.id));
      return { id: deleted.id };
    }),

  runTile: authProcedure
    .input(
      z.object({
        tileId: z.string().uuid().optional(),
        reportId: z.string().uuid().optional(),
        viz: kpiVizSchema.optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireReportsRead(ctx);
      // Import the reports router lazily to avoid a circular module dep at
      // load time. This is fine — tile execution is a runtime path, not
      // something that runs during router construction.
      const { reportsRouter } = await import('./reports.js');
      const caller = reportsRouter.createCaller(ctx);

      let reportId = input.reportId ?? null;
      let viz = input.viz;

      if (input.tileId) {
        const [tile] = await ctx.db
          .select()
          .from(dashboardTiles)
          .where(eq(dashboardTiles.id, input.tileId))
          .limit(1);
        if (!tile) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tile not found' });
        reportId = tile.reportId;
        viz = kpiVizSchema.parse(tile.viz);
      }

      if (!reportId) {
        // Inline tile definitions (a tile that embeds a full ReportDefinition
        // rather than referencing a saved report) land in a follow-up.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tile has no report to run'
        });
      }

      const value = await computeKpi(ctx, reportId, (opts) =>
        caller.run(opts).then((r) => ({ total: r.total }))
      );
      return { value, viz };
    })
});

void and;
