import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { FlowProducer } from 'bullmq';
import {
  syncRuns,
  syncContext,
  syncRunStages,
  integrationLinks,
  integrations
} from '@mspbyte/drizzle';
import {
  buildLinkFlow,
  decideFacetSyncMode,
  getProviderFacets,
  ingestionRootJobId,
  INTEGRATIONS,
  resolveFacetPlan,
  ProviderFacet
} from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

const facetSchema = z.nativeEnum(ProviderFacet);

export const pipelineRouter = t.router({
  replay: authProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        mode: z.enum(['full', 'incremental', 'replay']).default('replay'),
        facets: z.array(facetSchema).optional(),
        includeDependencies: z.boolean().default(true),
        force: z.boolean().default(true)
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.redis)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Redis not available' });

      const rows = await ctx.db
        .select({ link: integrationLinks, integrationConfig: integrations.config })
        .from(integrationLinks)
        .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
        .where(eq(integrationLinks.id, input.linkId))
        .limit(1);

      const row = rows[0];
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration link not found' });

      const providerId = row.link.integrationId;
      const providerFacets = getProviderFacets(providerId);
      if (providerFacets.length === 0)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No facets for provider: ${providerId}`
        });

      const ingestRunId = crypto.randomUUID();
      const linkMeta = (row.link.meta as Record<string, unknown> | null) ?? {};
      const config = (row.integrationConfig as Record<string, unknown> | null) ?? {};
      const contexts = await ctx.db
        .select()
        .from(syncContext)
        .where(eq(syncContext.linkId, input.linkId));
      const { facets, skipped } = resolveFacetPlan({
        providerId,
        contexts,
        integrationConfig: config,
        linkMeta,
        requestedFacets: input.facets,
        includeDependencies: input.includeDependencies,
        force: input.force
      });

      if (facets.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No enabled facets selected for provider: ${providerId}`
        });
      }

      const requestedFacets = new Set(input.facets ?? facets);
      const facetModes: Record<string, 'full' | 'incremental'> = {};
      const facetCursors: Record<string, string | undefined> = {};

      if (input.mode === 'incremental') {
        const providerConfig = INTEGRATIONS[providerId as keyof typeof INTEGRATIONS];
        const unsupported = [...requestedFacets].filter((facet) => {
          const facetConfig = providerConfig?.supportedFacets.find((f) => f.facet === facet);
          return !facetConfig?.sync?.supportsIncremental;
        });

        if (unsupported.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Delta sync is not supported for: ${unsupported.join(', ')}`
          });
        }

        const notReady: ProviderFacet[] = [];
        for (const facet of facets) {
          const decision = decideFacetSyncMode({
            providerId,
            facet,
            contexts,
            integrationConfig: config,
            linkMeta
          });

          if (requestedFacets.has(facet)) {
            if (decision.mode !== 'incremental' || !decision.cursor) {
              notReady.push(facet);
              continue;
            }
            facetModes[facet] = 'incremental';
            facetCursors[facet] = decision.cursor;
            continue;
          }

          facetModes[facet] = decision.mode;
          facetCursors[facet] = decision.cursor;
        }

        if (notReady.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Delta sync needs a previous full sync cursor for: ${notReady.join(', ')}`
          });
        }
      }

      const bullmqJobId = ingestionRootJobId(input.linkId, ingestRunId);
      const [syncRunRow] = await ctx.db
        .insert(syncRuns)
        .values({
          linkId: input.linkId,
          integrationId: providerId,
          bullmqJobId,
          type: input.mode === 'replay' ? 'replay' : 'manual',
          status: 'pending',
          mode: input.mode === 'incremental' ? 'incremental' : 'full',
          startedAt: new Date().toISOString()
        })
        .returning();

      if (!syncRunRow)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create sync run'
        });

      const flowJob = buildLinkFlow({
        orgId: ctx.org.id,
        linkId: input.linkId,
        siteId: row.link.siteId ?? undefined,
        provider: providerId,
        externalId: row.link.externalId ?? undefined,
        linkMeta,
        integrationConfig: config,
        facets,
        ingestRunId,
        syncRunId: syncRunRow.id,
        mode: input.mode,
        facetModes,
        facetCursors
      });

      const flow = new FlowProducer({ connection: ctx.redis as never });
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await flow.add(flowJob as any);
        await ctx.db
          .update(syncRuns)
          .set({ status: 'queued' })
          .where(eq(syncRuns.id, syncRunRow.id));
      } catch (err) {
        await ctx.db
          .update(syncRuns)
          .set({ status: 'enqueue_failed', finishedAt: new Date().toISOString() })
          .where(eq(syncRuns.id, syncRunRow.id));
        throw err;
      }

      return { syncRunId: syncRunRow.id, ingestRunId, facets, skipped };
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
