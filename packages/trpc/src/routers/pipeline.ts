import { z } from 'zod';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  syncRuns,
  syncContext,
  syncRunStages,
  integrationLinks,
  integrations,
  sites
} from '@mspbyte/drizzle';
import { enqueueIngestionJob, hasActiveIngestionRun } from '@mspbyte/pipeline';
import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

const ACTIVE_RUN_STALE_MS = 2 * 60 * 60 * 1000;

function isSupportedFacet(integrationId: string, facet: string): boolean {
  const integration = INTEGRATIONS[integrationId as ProviderId];
  if (!integration) return false;
  return integration.supportedFacets.some((f) => f.facet === facet);
}

export const pipelineRouter = t.router({
  enqueueSync: authProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        type: z.string().min(1),
        mode: z.enum(['full', 'incremental']).default('full'),
        force: z.boolean().default(false)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.redis) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Redis is not configured for this tRPC caller'
        });
      }

      const [row] = await ctx.db
        .select({
          link: integrationLinks,
          integrationConfig: integrations.config
        })
        .from(integrationLinks)
        .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
        .where(eq(integrationLinks.id, input.linkId))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration link not found' });
      }

      if (!isSupportedFacet(row.link.integrationId, input.type)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Facet ${input.type} is not supported by provider ${row.link.integrationId}`
        });
      }

      if (
        !input.force &&
        (await hasActiveIngestionRun(ctx.db, input.linkId, input.type, ACTIVE_RUN_STALE_MS))
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An ingestion run is already active for this link and facet'
        });
      }

      const result = await enqueueIngestionJob(ctx.redis, ctx.db, {
        orgId: ctx.orgId,
        link: row.link,
        integrationConfig: row.integrationConfig,
        type: input.type,
        mode: input.mode
      });

      return result;
    }),

  syncableLinks: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: integrationLinks.id,
        integrationId: integrationLinks.integrationId,
        name: integrationLinks.name,
        status: integrationLinks.status,
        siteId: integrationLinks.siteId,
        siteName: sites.name
      })
      .from(integrationLinks)
      .leftJoin(sites, eq(integrationLinks.siteId, sites.id))
      .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
      .where(isNull(integrations.deletedAt));

    return rows
      .map((row) => {
        const integration = INTEGRATIONS[row.integrationId as ProviderId];
        return {
          ...row,
          integrationName: integration?.name ?? row.integrationId,
          facets: integration?.supportedFacets.map((f) => f.facet) ?? []
        };
      })
      .filter((row) => row.facets.length > 0);
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
