import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { sites, sitesOverview } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';

type SiteRow = typeof sites.$inferSelect;

export const sitesRouter = t.router({
  list: authProcedure.query(async ({ ctx }): Promise<SiteRow[]> => {
    return ctx.db.select().from(sites).orderBy(sites.name);
  }),

  overview: authProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(sitesOverview).orderBy(asc(sitesOverview.name));
  }),

  get: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<SiteRow> => {
      const [site] = await ctx.db.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!site) throw new TRPCError({ code: 'NOT_FOUND' });
      return site;
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
