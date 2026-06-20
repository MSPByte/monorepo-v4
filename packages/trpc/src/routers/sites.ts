// TODO: Findings Implementation
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { sites, sitesWithCounts } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

type SiteRow = typeof sites.$inferSelect;

export const sitesRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData<typeof sitesWithCounts.$inferSelect>(ctx.db, sitesWithCounts, input, [], {
      column: 'openFindingCount',
      direction: 'desc'
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        frameworkScore: 'frameworkScore' in row ? row.frameworkScore : 100,
        policyHealth: 'policyHealth' in row ? row.policyHealth : 100,
        sourceList: Array.isArray(row.sources) ? row.sources.join(', ') : ''
      }))
    };
  }),

  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(sitesWithCounts).orderBy(sitesWithCounts.name).catch(() => []);
    return rows.map((site) => ({
      ...site,
      openFindingCount: site.openFindingCount,
      assetCount: site.assetCount,
      peopleCount: site.peopleCount,
      frameworkScore: 100,
      policyHealth: 100,
      sources: site.sources,
      recentActivity: []
    }));
  }),

  get: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<SiteRow> => {
      const [site] = await ctx.db
        .select()
        .from(sites)
        .where(eq(sites.id, input.id))
        .limit(1)
        .catch(() => []);
      if (!site) throw new TRPCError({ code: 'NOT_FOUND' });
      return site;
    }),

  byId: authProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [site] = await ctx.db
      .select()
      .from(sitesWithCounts)
      .where(eq(sitesWithCounts.id, input.id))
      .limit(1)
      .catch(() => []);
    if (!site) throw new TRPCError({ code: 'NOT_FOUND' });
    return {
      ...site,
      openFindingCount: site.openFindingCount,
      assetCount: site.assetCount,
      peopleCount: site.peopleCount,
      frameworkScore: 100,
      policyHealth: 100,
      sources: site.sources,
      recentActivity: []
    };
  }),

  create: authProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }): Promise<SiteRow> => {
      const [site] = await ctx.db
        .insert(sites)
        .values({ name: input.name, description: input.description })
        .returning();
      return site!;
    })
});
