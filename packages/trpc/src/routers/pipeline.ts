import { z } from 'zod';
import { eq, desc, and, isNull, inArray, gte } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  syncRuns,
  syncContext,
  syncRunStages,
  integrationLinks,
  integrations,
  sites
} from '@mspbyte/drizzle';
import {
  enqueueIngestionJob,
  hasActiveIngestionRun,
  reconcileStaleIngestionRuns,
  getOrCreateQueue,
  orgQueueName,
  QUEUES
} from '@mspbyte/pipeline';
import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

// Pipeline endpoints control ingestion — admin-only surface.
const pipelineProcedure = authProcedure.use(({ ctx, next }) => {
  if (!ctx.can('Global.Admin')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Global.Admin permission required'
    });
  }
  return next();
});

const ACTIVE_RUN_STALE_MS = 2 * 60 * 60 * 1000;

function isSupportedFacet(integrationId: string, facet: string): boolean {
  const integration = INTEGRATIONS[integrationId as ProviderId];
  if (!integration) return false;
  return integration.supportedFacets.some((f) => f.facet === facet);
}

export const pipelineRouter = t.router({
  enqueueSync: pipelineProcedure
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

  enqueueIntegrationSync: pipelineProcedure
    .input(
      z.object({
        integrationId: z.string().min(1),
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

      const integration = INTEGRATIONS[input.integrationId as ProviderId];
      if (!integration) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown integration: ${input.integrationId}`
        });
      }

      const rows = await ctx.db
        .select({
          link: integrationLinks,
          integrationConfig: integrations.config
        })
        .from(integrationLinks)
        .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
        .where(
          and(
            eq(integrationLinks.integrationId, input.integrationId),
            eq(integrationLinks.status, 'active'),
            isNull(integrations.deletedAt)
          )
        );

      const facets = integration.supportedFacets.map((f) => f.facet);
      const queued: Array<{ linkId: string; type: string; syncRunId: string }> = [];
      const skipped: Array<{ linkId: string; type: string; reason: string }> = [];

      for (const row of rows) {
        for (const type of facets) {
          if (
            !input.force &&
            (await hasActiveIngestionRun(ctx.db, row.link.id, type, ACTIVE_RUN_STALE_MS))
          ) {
            skipped.push({ linkId: row.link.id, type, reason: 'active-run' });
            continue;
          }

          try {
            const result = await enqueueIngestionJob(ctx.redis, ctx.db, {
              orgId: ctx.orgId,
              link: row.link,
              integrationConfig: row.integrationConfig,
              type,
              mode: input.mode
            });
            queued.push({ linkId: row.link.id, type, syncRunId: result.syncRunId });
          } catch (error) {
            skipped.push({
              linkId: row.link.id,
              type,
              reason: error instanceof Error ? error.message : 'enqueue-failed'
            });
          }
        }
      }

      return {
        integrationId: input.integrationId,
        linkCount: rows.length,
        facetCount: facets.length,
        queued,
        skipped
      };
    }),

  syncableLinks: pipelineProcedure.query(async ({ ctx }) => {
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

  syncStatus: pipelineProcedure
    .input(z.object({ linkId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await reconcileStaleIngestionRuns(ctx.db, ACTIVE_RUN_STALE_MS, { linkId: input.linkId });
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

  recentRuns: pipelineProcedure
    .input(
      z.object({
        linkId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(20)
      })
    )
    .query(async ({ ctx, input }) => {
      await reconcileStaleIngestionRuns(ctx.db, ACTIVE_RUN_STALE_MS, { linkId: input.linkId });
      const conditions = input.linkId ? [eq(syncRuns.linkId, input.linkId)] : [];
      return ctx.db
        .select()
        .from(syncRuns)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(syncRuns.createdAt))
        .limit(input.limit);
    }),

  failedStages: pipelineProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(syncRunStages)
        .where(eq(syncRunStages.status, 'failed'))
        .orderBy(desc(syncRunStages.createdAt))
        .limit(input.limit);
    }),

  // Diagnostic snapshot: live activity, per-integration health, and queue depth
  // in a single round-trip so the dashboard can poll one endpoint on refresh.
  orgActivity: pipelineProcedure.query(async ({ ctx }) => {
    await reconcileStaleIngestionRuns(ctx.db, ACTIVE_RUN_STALE_MS);

    const nowIso = new Date().toISOString();
    const hourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const linkRows = await ctx.db
      .select({
        id: integrationLinks.id,
        integrationId: integrationLinks.integrationId,
        siteId: integrationLinks.siteId,
        linkName: integrationLinks.name,
        siteName: sites.name,
        status: integrationLinks.status
      })
      .from(integrationLinks)
      .leftJoin(sites, eq(integrationLinks.siteId, sites.id))
      .innerJoin(integrations, eq(integrations.id, integrationLinks.integrationId))
      .where(isNull(integrations.deletedAt));

    const linkById = new Map(linkRows.map((row) => [row.id, row]));

    const activeRuns = await ctx.db
      .select()
      .from(syncRuns)
      .where(inArray(syncRuns.status, ['pending', 'queued', 'running']))
      .orderBy(desc(syncRuns.createdAt));

    const recentRuns = await ctx.db
      .select({
        id: syncRuns.id,
        integrationId: syncRuns.integrationId,
        linkId: syncRuns.linkId,
        type: syncRuns.type,
        mode: syncRuns.mode,
        status: syncRuns.status,
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        createdAt: syncRuns.createdAt
      })
      .from(syncRuns)
      .where(gte(syncRuns.createdAt, hourAgoIso));

    // Latest stage per active syncRun — used to show what the run is doing
    // right now (fetch, project, etc) and its records-processed counter.
    const activeRunIds = activeRuns.map((r) => r.id);
    const stageRows = activeRunIds.length
      ? await ctx.db
          .select()
          .from(syncRunStages)
          .where(inArray(syncRunStages.syncRunId, activeRunIds))
          .orderBy(desc(syncRunStages.createdAt))
      : [];

    const latestStageByRun = new Map<string, (typeof stageRows)[number]>();
    for (const stage of stageRows) {
      if (!latestStageByRun.has(stage.syncRunId)) {
        latestStageByRun.set(stage.syncRunId, stage);
      }
    }

    const enrichedActive = activeRuns.map((run) => {
      const link = linkById.get(run.linkId);
      const provider = INTEGRATIONS[run.integrationId as ProviderId];
      const stage = latestStageByRun.get(run.id) ?? null;
      const startedAt = run.startedAt ?? run.createdAt;
      const elapsedMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0;
      return {
        id: run.id,
        linkId: run.linkId,
        integrationId: run.integrationId,
        integrationName: provider?.name ?? run.integrationId,
        siteName: link?.siteName ?? link?.linkName ?? 'unlinked',
        type: run.type,
        mode: run.mode,
        status: run.status,
        startedAt,
        elapsedMs,
        stage: stage
          ? {
              name: stage.stage,
              status: stage.status,
              recordsIn: stage.recordsIn,
              recordsOut: stage.recordsOut,
              createdCt: stage.createdCt,
              updatedCt: stage.updatedCt,
              failedCt: stage.failedCt
            }
          : null
      };
    });

    // Group recent runs by integration to derive throughput + failure counts.
    type IntegrationBucket = {
      integrationId: string;
      integrationName: string;
      linkCount: number;
      activeCount: number;
      succeededLastHour: number;
      failedLastHour: number;
    };
    const integrationBuckets = new Map<string, IntegrationBucket>();
    const integrationOf = (integrationId: string): IntegrationBucket => {
      let bucket = integrationBuckets.get(integrationId);
      if (!bucket) {
        bucket = {
          integrationId,
          integrationName: INTEGRATIONS[integrationId as ProviderId]?.name ?? integrationId,
          linkCount: 0,
          activeCount: 0,
          succeededLastHour: 0,
          failedLastHour: 0
        };
        integrationBuckets.set(integrationId, bucket);
      }
      return bucket;
    };

    // Facet-level buckets — durations vary wildly between facets on the same
    // integration (a users pull is not a devices pull), so latency stats are
    // only meaningful at this granularity.
    type FacetBucket = {
      integrationId: string;
      integrationName: string;
      facet: string;
      activeCount: number;
      succeededLastHour: number;
      failedLastHour: number;
      durationsMs: number[];
    };
    const facetBuckets = new Map<string, FacetBucket>();
    const facetKey = (integrationId: string, facet: string) => `${integrationId}::${facet}`;
    const facetOf = (integrationId: string, facet: string): FacetBucket => {
      const key = facetKey(integrationId, facet);
      let bucket = facetBuckets.get(key);
      if (!bucket) {
        bucket = {
          integrationId,
          integrationName: INTEGRATIONS[integrationId as ProviderId]?.name ?? integrationId,
          facet,
          activeCount: 0,
          succeededLastHour: 0,
          failedLastHour: 0,
          durationsMs: []
        };
        facetBuckets.set(key, bucket);
      }
      return bucket;
    };

    for (const link of linkRows) integrationOf(link.integrationId).linkCount += 1;
    for (const run of activeRuns) {
      integrationOf(run.integrationId).activeCount += 1;
      facetOf(run.integrationId, run.type).activeCount += 1;
    }
    for (const run of recentRuns) {
      const ib = integrationOf(run.integrationId);
      const fb = facetOf(run.integrationId, run.type);
      if (run.status === 'succeeded' || run.status === 'completed') {
        ib.succeededLastHour += 1;
        fb.succeededLastHour += 1;
      }
      if (run.status === 'failed' || run.status === 'enqueue_failed') {
        ib.failedLastHour += 1;
        fb.failedLastHour += 1;
      }
      if (run.startedAt && run.finishedAt) {
        fb.durationsMs.push(
          new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
        );
      }
    }

    const integrationStats = Array.from(integrationBuckets.values())
      .map((bucket) => ({
        integrationId: bucket.integrationId,
        integrationName: bucket.integrationName,
        linkCount: bucket.linkCount,
        activeCount: bucket.activeCount,
        succeededLastHour: bucket.succeededLastHour,
        failedLastHour: bucket.failedLastHour,
        supportedFacets:
          INTEGRATIONS[bucket.integrationId as ProviderId]?.supportedFacets.map((f) => f.facet) ??
          []
      }))
      .sort((a, b) => b.activeCount - a.activeCount || b.linkCount - a.linkCount);

    const facetStats = Array.from(facetBuckets.values())
      .map((bucket) => ({
        integrationId: bucket.integrationId,
        integrationName: bucket.integrationName,
        facet: bucket.facet,
        activeCount: bucket.activeCount,
        succeededLastHour: bucket.succeededLastHour,
        failedLastHour: bucket.failedLastHour,
        completedCount: bucket.durationsMs.length,
        p50DurationMs: percentile(bucket.durationsMs, 0.5),
        p95DurationMs: percentile(bucket.durationsMs, 0.95),
        maxDurationMs: bucket.durationsMs.length
          ? Math.max(...bucket.durationsMs)
          : null
      }))
      // Slowest tail first — this is the "which facets need my attention" list.
      .sort((a, b) => (b.p95DurationMs ?? 0) - (a.p95DurationMs ?? 0));

    const allDurations = recentRuns
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime());

    const succeededLastHour = recentRuns.filter(
      (r) => r.status === 'succeeded' || r.status === 'completed'
    ).length;
    const failedLastHour = recentRuns.filter(
      (r) => r.status === 'failed' || r.status === 'enqueue_failed'
    ).length;

    let queueDepth: { waiting: number; active: number; delayed: number; failed: number } | null =
      null;
    if (ctx.redis) {
      try {
        const queueName = orgQueueName(QUEUES.INGEST, ctx.orgId);
        const queue = getOrCreateQueue(ctx.redis, queueName);
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed'
        );
        queueDepth = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0
        };
      } catch {
        queueDepth = null;
      }
    }

    return {
      generatedAt: nowIso,
      kpis: {
        activeRuns: activeRuns.length,
        queuedRuns: activeRuns.filter((r) => r.status === 'pending' || r.status === 'queued')
          .length,
        runningRuns: activeRuns.filter((r) => r.status === 'running').length,
        succeededLastHour,
        failedLastHour,
        p50DurationMs: percentile(allDurations, 0.5),
        p95DurationMs: percentile(allDurations, 0.95)
      },
      queueDepth,
      activeRuns: enrichedActive,
      integrationStats,
      facetStats
    };
  }),

  runDetail: pipelineProcedure
    .input(z.object({ syncRunId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.id, input.syncRunId))
        .limit(1);

      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync run not found' });
      }

      const [link] = await ctx.db
        .select({
          id: integrationLinks.id,
          linkName: integrationLinks.name,
          siteName: sites.name
        })
        .from(integrationLinks)
        .leftJoin(sites, eq(integrationLinks.siteId, sites.id))
        .where(eq(integrationLinks.id, run.linkId))
        .limit(1);

      const stages = await ctx.db
        .select()
        .from(syncRunStages)
        .where(eq(syncRunStages.syncRunId, input.syncRunId))
        .orderBy(syncRunStages.createdAt);

      const [ctxRow] = await ctx.db
        .select()
        .from(syncContext)
        .where(
          and(
            eq(syncContext.linkId, run.linkId),
            eq(syncContext.type, run.type),
            eq(syncContext.integrationId, run.integrationId)
          )
        )
        .limit(1);

      return {
        run,
        link: link
          ? {
              siteName: link.siteName ?? link.linkName ?? 'unlinked'
            }
          : null,
        integrationName:
          INTEGRATIONS[run.integrationId as ProviderId]?.name ?? run.integrationId,
        stages,
        context: ctxRow ?? null
      };
    })
});

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? null;
}
