// TODO: Findings Implementation
import { z } from 'zod';
import { customerLogs, integrationLinks } from '@mspbyte/drizzle';
import { eq, and, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { ActionLabels, INTEGRATIONS, META_VERSION_KEY, type ProviderId } from '@mspbyte/shared';
import type { Context } from '../context.js';
import { t, authProcedure } from '../trpc.js';

type IntegrationLinkRow = typeof integrationLinks.$inferSelect;

async function auditLinkChange(
  ctx: Context,
  input: {
    linkId: string;
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetLabel: string;
    siteId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: input.siteId ?? null,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: ctx.user.name || ctx.user.email,
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: 'integration_link',
    targetId: input.linkId,
    targetLabel: input.targetLabel,
    result: 'success',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata ?? null
  });
}

const saveSiteLinkSchema = z.object({
  siteId: z.string().uuid(),
  externalId: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  disposition: z.enum(['third_party', 'not_managed']).optional().nullable(),
  note: z.string().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional().nullable()
});

function stampMeta(
  integrationId: string,
  meta: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (meta === null || meta === undefined) return meta ?? null;
  const integration = INTEGRATIONS[integrationId as ProviderId];
  if (!integration) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown integration ${integrationId}`
    });
  }
  const parsed = integration.linkMetaSchema.safeParse(meta);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid meta for ${integrationId}: ${parsed.error.message}`
    });
  }
  const value =
    parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>)
      : {};
  return { ...value, [META_VERSION_KEY]: integration.linkMetaVersion };
}

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
      // Integration links are pivot metadata: readable by anyone who can view
      // integration configuration OR vendor data. A scoped Auditor with only
      // Vendors.Read still needs to resolve the linkId when browsing vendor
      // pages. Effective scope is the union of both permissions' scopes.
      const vendorScope = ctx.scopeFor('Vendors.Read');
      const integrationScope = ctx.scopeFor('Integrations.Read');
      const noVendor = Array.isArray(vendorScope) && vendorScope.length === 0;
      const noIntegration = Array.isArray(integrationScope) && integrationScope.length === 0;
      if (noVendor && noIntegration) return [];

      const scope: 'all' | readonly string[] =
        vendorScope === 'all' || integrationScope === 'all'
          ? 'all'
          : [...new Set([...(vendorScope as string[]), ...(integrationScope as string[])])];

      const conditions = [];
      if (input.integrationId)
        conditions.push(eq(integrationLinks.integrationId, input.integrationId));
      if (input.siteId) conditions.push(eq(integrationLinks.siteId, input.siteId));
      if (input.status) conditions.push(eq(integrationLinks.status, input.status));
      if (scope !== 'all') conditions.push(inArray(integrationLinks.siteId, [...scope]));

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
      const meta = stampMeta(input.integrationId, input.meta ?? null);
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
          meta
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await auditLinkChange(ctx, {
        linkId: row.id,
        action: 'create',
        actionLabel: ActionLabels.IntegrationLinkCreate,
        targetLabel: row.name ?? row.externalId ?? row.id,
        siteId: row.siteId,
        metadata: {
          integrationId: row.integrationId,
          externalId: row.externalId,
          status: row.status,
          disposition: row.disposition
        }
      });

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
      const { id, meta: metaIn, ...rest } = input;
      let metaUpdate: Record<string, unknown> | null | undefined = undefined;
      if (metaIn !== undefined) {
        const [existing] = await ctx.db
          .select({ integrationId: integrationLinks.integrationId })
          .from(integrationLinks)
          .where(eq(integrationLinks.id, id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
        metaUpdate = stampMeta(existing.integrationId, metaIn);
      }
      const [row] = await ctx.db
        .update(integrationLinks)
        .set({
          ...rest,
          ...(metaUpdate === undefined ? {} : { meta: metaUpdate }),
          updatedAt: new Date().toISOString()
        })
        .where(eq(integrationLinks.id, id))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      await auditLinkChange(ctx, {
        linkId: row.id,
        action: 'update',
        actionLabel: ActionLabels.IntegrationLinkUpdate,
        targetLabel: row.name ?? row.externalId ?? row.id,
        siteId: row.siteId,
        metadata: {
          integrationId: row.integrationId,
          changedFields: Object.keys(rest).concat(metaUpdate === undefined ? [] : ['meta'])
        }
      });

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

          const meta = stampMeta(input.integrationId, change.meta ?? null);
          const values = {
            integrationId: input.integrationId,
            siteId: change.siteId,
            externalId: externalId ?? null,
            name: change.name ?? null,
            status: disposition ? ('dispositioned' as const) : ('active' as const),
            disposition,
            note,
            meta,
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
          await ctx.db.insert(integrationLinks).values(toCreate).returning();
        }

        await ctx.db.insert(customerLogs).values({
          siteId: null,
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'update',
          actionLabel: ActionLabels.IntegrationLinkSaveBatch,
          targetType: 'integration',
          targetId: input.integrationId,
          targetLabel: input.integrationId,
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: {
            created: toCreate.length,
            updated: toUpdate.length,
            deleted: toDelete.length
          }
        });

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

      const existing = await ctx.db
        .select({
          id: integrationLinks.id,
          name: integrationLinks.name,
          externalId: integrationLinks.externalId,
          siteId: integrationLinks.siteId,
          integrationId: integrationLinks.integrationId
        })
        .from(integrationLinks)
        .where(inArray(integrationLinks.id, input.ids));

      await ctx.db.delete(integrationLinks).where(inArray(integrationLinks.id, input.ids));

      for (const row of existing) {
        await auditLinkChange(ctx, {
          linkId: row.id,
          action: 'delete',
          actionLabel: ActionLabels.IntegrationLinkDelete,
          targetLabel: row.name ?? row.externalId ?? row.id,
          siteId: row.siteId,
          metadata: { integrationId: row.integrationId, externalId: row.externalId }
        });
      }
    })
});
