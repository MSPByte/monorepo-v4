// TODO: Findings Implementation
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { syncRuns, syncContext, syncRunStages } from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';

export const pipelineRouter = t.router({
  replay: authProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        mode: z.enum(['full', 'incremental', 'replay']).default('replay'),
        facets: z.array(z.string()).optional(),
        includeDependencies: z.boolean().default(true),
        force: z.boolean().default(true)
      })
    )
    .mutation(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Pipeline replay pending findings rework'
      });
    }),

  syncStatus: authProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [contexts, runs] = await Promise.all([
        ctx.db.select().from(syncContext).where(eq(syncContext.linkId, input.linkId)),
        ctx.db
          .select()
          .from(syncRuns)
          .where(eq(syncRuns.linkId, input.linkId))
          .orderBy(desc(syncRuns.createdAt))
          .limit(5)
      ]);
      return { contexts, recentRuns: runs };
    }),

  recentRuns: authProcedure
    .input(
      z.object({
        linkId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(20)
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = input.linkId ? [eq(syncRuns.linkId, input.linkId)] : [];
      return ctx.db
        .select()
        .from(syncRuns)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(syncRuns.createdAt))
        .limit(input.limit);
    }),

  failedStages: authProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(syncRunStages)
        .where(eq(syncRunStages.status, 'failed'))
        .orderBy(desc(syncRunStages.createdAt))
        .limit(input.limit);
    })
});
