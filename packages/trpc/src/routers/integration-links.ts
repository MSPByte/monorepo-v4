import { z } from 'zod';
import { integrationLinks, integrations, syncRuns } from '@mspbyte/drizzle';
import { eq, and, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { FlowProducer } from 'bullmq';
import {
  buildLinkFlow,
  getProviderFacets,
  ingestionRootJobId,
  resolveFacetPlan
} from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import type { Redis } from 'ioredis';
import type { TenantServiceDb } from '@mspbyte/drizzle-catalog';

type IntegrationLinkRow = typeof integrationLinks.$inferSelect;

const saveSiteLinkSchema = z.object({
  siteId: z.string().uuid(),
  externalId: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  disposition: z.enum(['third_party', 'not_managed']).optional().nullable(),
  note: z.string().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional().nullable()
});

export const integrationLinksRouter = t.router({
  list: authProcedure
    .input(
      z.object({
        integrationId: z.string().optional(),
        siteId: z.string().uuid().optional(),
        status: z.enum(['active', 'error', 'disabled']).optional()
      })
    )
    .query(async ({ ctx, input }): Promise<IntegrationLinkRow[]> => {
      const conditions = [];
      if (input.integrationId)
        conditions.push(eq(integrationLinks.integrationId, input.integrationId));
      if (input.siteId) conditions.push(eq(integrationLinks.siteId, input.siteId));
      if (input.status) conditions.push(eq(integrationLinks.status, input.status));
      return ctx.db
        .select()
        .from(integrationLinks)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(integrationLinks.name);
    }),

  create: authProcedure
    .input(
      z.object({
        integrationId: z.string(),
        siteId: z.string().uuid().optional(),
        externalId: z.string().optional(),
        name: z.string().optional(),
        status: z.enum(['active', 'error', 'disabled']).default('active'),
        disposition: z.enum(['managed', 'third_party', 'not_managed']).optional(),
        note: z.string().optional(),
        meta: z.record(z.string(), z.unknown()).optional()
      })
    )
    .mutation(async ({ ctx, input }): Promise<IntegrationLinkRow> => {
      const [row] = await ctx.db
        .insert(integrationLinks)
        .values({
          integrationId: input.integrationId,
          siteId: input.siteId,
          externalId: input.externalId,
          name: input.name,
          status: input.status,
          disposition: input.disposition,
          note: input.note,
          meta: input.meta
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Event-driven scheduling: immediately enqueue a full sync for new active links
      if (row.status === 'active' && ctx.redis) {
        const redis = ctx.redis;
        void triggerLinkSync(
          { db: ctx.db, orgId: ctx.orgId, redis },
          row.id,
          row.integrationId,
          row.siteId ?? undefined,
          row.externalId ?? undefined,
          row.meta as Record<string, unknown> | null
        );
      }

      return row;
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.uuid(),
        externalId: z.string().optional().nullable(),
        name: z.string().optional().nullable(),
        siteId: z.uuid().optional().nullable(),
        status: z.enum(['active', 'error', 'disabled']).optional(),
        disposition: z.enum(['managed', 'third_party', 'not_managed']).optional().nullable(),
        note: z.string().optional().nullable(),
        meta: z.record(z.string(), z.unknown()).optional().nullable()
      })
    )
    .mutation(async ({ ctx, input }): Promise<IntegrationLinkRow> => {
      const { id, ...rest } = input;
      const [row] = await ctx.db
        .update(integrationLinks)
        .set({ ...rest, updatedAt: new Date().toISOString() })
        .where(eq(integrationLinks.id, id))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  saveSiteLinks: authProcedure
    .input(
      z.object({
        integrationId: z.string(),
        changes: z.array(saveSiteLinkSchema)
      })
    )
    .mutation(
      async ({ ctx, input }): Promise<{ created: number; updated: number; deleted: number }> => {
        if (input.changes.length === 0) return { created: 0, updated: 0, deleted: 0 };

        const externalIds = input.changes
          .map((change) => change.externalId)
          .filter((externalId): externalId is string => !!externalId);
        if (new Set(externalIds).size !== externalIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Each external item can only be linked to one site'
          });
        }

        const siteIds = [...new Set(input.changes.map((change) => change.siteId))];
        const existingRows = await ctx.db
          .select()
          .from(integrationLinks)
          .where(
            and(
              eq(integrationLinks.integrationId, input.integrationId),
              inArray(integrationLinks.siteId, siteIds)
            )
          );
        const existingBySiteId = new Map<string, IntegrationLinkRow>();
        for (const row of existingRows) {
          if (row.siteId && !existingBySiteId.has(row.siteId)) {
            existingBySiteId.set(row.siteId, row);
          }
        }

        const toDelete: string[] = [];
        const toCreate: Array<typeof integrationLinks.$inferInsert> = [];
        const toUpdate: Array<{
          id: string;
          values: Partial<typeof integrationLinks.$inferInsert>;
          existingExternalId: string | null;
        }> = [];
        const now = new Date().toISOString();

        for (const change of input.changes) {
          const externalId = change.externalId || undefined;
          const disposition = externalId ? null : (change.disposition ?? null);
          const note = change.note || null;
          const hasContent = !!externalId || !!disposition || !!note;
          const existing = existingBySiteId.get(change.siteId);

          if (!hasContent) {
            if (existing) toDelete.push(existing.id);
            continue;
          }

          const values = {
            integrationId: input.integrationId,
            siteId: change.siteId,
            externalId: externalId ?? null,
            name: change.name ?? null,
            status: disposition ? ('dispositioned' as const) : ('active' as const),
            disposition,
            note,
            meta: change.meta ?? null,
            updatedAt: now
          };

          if (existing) {
            toUpdate.push({ id: existing.id, values, existingExternalId: existing.externalId });
          } else {
            toCreate.push(values);
          }
        }

        if (toDelete.length > 0) {
          await ctx.db.delete(integrationLinks).where(inArray(integrationLinks.id, toDelete));
        }

        const externalIdUpdates = toUpdate.filter(
          (item) =>
            item.values.externalId &&
            item.existingExternalId &&
            item.values.externalId !== item.existingExternalId
        );
        if (externalIdUpdates.length > 0) {
          await Promise.all(
            externalIdUpdates.map((item) =>
              ctx.db
                .update(integrationLinks)
                .set({ externalId: null, updatedAt: now })
                .where(eq(integrationLinks.id, item.id))
            )
          );
        }

        if (toUpdate.length > 0) {
          await Promise.all(
            toUpdate.map((item) =>
              ctx.db
                .update(integrationLinks)
                .set(item.values)
                .where(eq(integrationLinks.id, item.id))
            )
          );
        }

        if (toCreate.length > 0) {
          const createdRows = await ctx.db.insert(integrationLinks).values(toCreate).returning();
          if (ctx.redis) {
            const redis = ctx.redis;
            for (const row of createdRows) {
              void triggerLinkSync(
                { db: ctx.db, orgId: ctx.orgId, redis },
                row.id,
                row.integrationId,
                row.siteId ?? undefined,
                row.externalId ?? undefined,
                row.meta as Record<string, unknown> | null
              );
            }
          }
        }

        return {
          created: toCreate.length,
          updated: toUpdate.length,
          deleted: toDelete.length
        };
      }
    ),

  delete: authProcedure
    .input(z.object({ ids: z.array(z.uuid()) }))
    .mutation(async ({ ctx, input }): Promise<void> => {
      if (input.ids.length === 0) return;
      await ctx.db.delete(integrationLinks).where(inArray(integrationLinks.id, input.ids));
    })
});

async function triggerLinkSync(
  ctx: { db: TenantServiceDb; orgId: string; redis: Redis },
  linkId: string,
  integrationId: string,
  siteId: string | undefined,
  externalId: string | undefined,
  meta: Record<string, unknown> | null
): Promise<void> {
  let syncRunId: string | undefined;
  try {
    const providerFacets = getProviderFacets(integrationId);
    if (providerFacets.length === 0) return;

    const [integrationRow] = await ctx.db
      .select({ config: integrations.config })
      .from(integrations)
      .where(eq(integrations.id, integrationId))
      .limit(1);

    const integrationConfig = (integrationRow?.config as Record<string, unknown> | null) ?? {};
    const { facets } = resolveFacetPlan({
      providerId: integrationId,
      integrationConfig,
      linkMeta: meta ?? {},
      force: true
    });
    if (facets.length === 0) return;

    const ingestRunId = crypto.randomUUID();

    const bullmqJobId = ingestionRootJobId(linkId, ingestRunId);
    const [syncRunRow] = await ctx.db
      .insert(syncRuns)
      .values({
        linkId,
        integrationId,
        bullmqJobId,
        type: 'manual',
        status: 'pending',
        mode: 'full',
        startedAt: new Date().toISOString()
      })
      .returning();

    if (!syncRunRow) return;
    syncRunId = syncRunRow.id;

    const flowJob = buildLinkFlow({
      orgId: ctx.orgId,
      linkId,
      siteId,
      provider: integrationId,
      externalId,
      linkMeta: { ...(meta ?? {}), externalId },
      integrationConfig,
      facets,
      ingestRunId,
      syncRunId: syncRunRow.id,
      mode: 'full'
    });

    const flow = new FlowProducer({ connection: ctx.redis as never });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await flow.add(flowJob as any);
    await ctx.db.update(syncRuns).set({ status: 'queued' }).where(eq(syncRuns.id, syncRunRow.id));
  } catch (err) {
    if (syncRunId) {
      await ctx.db
        .update(syncRuns)
        .set({ status: 'enqueue_failed', finishedAt: new Date().toISOString() })
        .where(eq(syncRuns.id, syncRunId))
        .catch(() => null);
    }
    // Fire-and-forget — the cron scheduler will catch it on next run
    void err;
  }
}
