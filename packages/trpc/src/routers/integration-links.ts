import { z } from 'zod';
import { customerLogs, integrationLinks, integrationLinkSiteAssignments, m365DomainSiteMappings, m365Identities, sites } from '@mspbyte/drizzle';
import { eq, and, inArray, ne, or, isNull, exists, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { ActionLabels, INTEGRATIONS, META_VERSION_KEY, type ProviderId } from '@mspbyte/shared';
import type { Context } from '../context.js';
import { t, authProcedure } from '../trpc.js';
import { loadGroupTargets } from './group-targets.js';

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
        groupId: z.string().uuid().optional(),
        status: z.enum(['active', 'error', 'disabled', 'mapping']).optional()
      })
    )
    .query(async ({ ctx, input }): Promise<IntegrationLinkRow[]> => {
      // Integration links are pivot metadata: readable by anyone who can view
      // integration configuration OR vendor data. A scoped Auditor with only
      // Vendors.Read still needs to resolve the linkId when browsing vendor
      // pages. Effective scope is the union of both permissions' scopes.
      const vendorSiteScope = ctx.scopeFor('Vendors.Read');
      const vendorLinkScope = ctx.linkScopeFor('Vendors.Read');
      const integrationSiteScope = ctx.scopeFor('Integrations.Read');
      const integrationLinkScope = ctx.linkScopeFor('Integrations.Read');
      const noVendor =
        Array.isArray(vendorSiteScope) &&
        vendorSiteScope.length === 0 &&
        Array.isArray(vendorLinkScope) &&
        vendorLinkScope.length === 0;
      const noIntegration =
        Array.isArray(integrationSiteScope) &&
        integrationSiteScope.length === 0 &&
        Array.isArray(integrationLinkScope) &&
        integrationLinkScope.length === 0;
      if (noVendor && noIntegration) return [];

      const siteScope: 'all' | readonly string[] =
        vendorSiteScope === 'all' || integrationSiteScope === 'all'
          ? 'all'
          : [
              ...new Set([...(vendorSiteScope as string[]), ...(integrationSiteScope as string[])])
            ];
      const linkScope: 'all' | readonly string[] =
        vendorLinkScope === 'all' || integrationLinkScope === 'all'
          ? 'all'
          : [
              ...new Set([...(vendorLinkScope as string[]), ...(integrationLinkScope as string[])])
            ];

      const conditions = [];
      if (input.integrationId)
        conditions.push(eq(integrationLinks.integrationId, input.integrationId));
      const assignedToSites = (siteIds: readonly string[]) =>
        exists(
          ctx.db
            .select({ linkId: integrationLinkSiteAssignments.linkId })
            .from(integrationLinkSiteAssignments)
            .where(
              and(
                eq(integrationLinkSiteAssignments.linkId, integrationLinks.id),
                inArray(integrationLinkSiteAssignments.siteId, [...siteIds])
              )
            )
        );
      if (input.siteId) {
        conditions.push(or(eq(integrationLinks.siteId, input.siteId), assignedToSites([input.siteId])));
      }
      if (input.status) conditions.push(eq(integrationLinks.status, input.status));

      if (input.groupId) {
        const targets = await loadGroupTargets(ctx.db, input.groupId);
        if (targets.siteIds.length === 0 && targets.linkIds.length === 0) return [];
        if (targets.siteIds.length > 0 && targets.linkIds.length > 0) {
          conditions.push(or(inArray(integrationLinks.id, targets.linkIds), inArray(integrationLinks.siteId, targets.siteIds), assignedToSites(targets.siteIds)));
        } else if (targets.linkIds.length > 0) {
          conditions.push(inArray(integrationLinks.id, targets.linkIds));
        } else {
          conditions.push(or(inArray(integrationLinks.siteId, targets.siteIds), assignedToSites(targets.siteIds)));
        }
      }

      if (siteScope !== 'all' || linkScope !== 'all') {
        const scopeConditions = [];
        if (siteScope === 'all') {
          scopeConditions.push(ne(integrationLinks.id, '00000000-0000-0000-0000-000000000000'));
        } else if (siteScope.length > 0) {
          scopeConditions.push(or(inArray(integrationLinks.siteId, [...siteScope]), assignedToSites(siteScope)));
        }
        if (linkScope === 'all') {
          scopeConditions.push(ne(integrationLinks.id, '00000000-0000-0000-0000-000000000000'));
        } else if (linkScope.length > 0) {
          scopeConditions.push(inArray(integrationLinks.id, [...linkScope]));
        }
        if (scopeConditions.length === 0) return [];
        conditions.push(scopeConditions.length === 1 ? scopeConditions[0]! : or(...scopeConditions));
      }

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
        status: z.enum(['active', 'error', 'disabled', 'mapping']).optional(),
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

  m365SiteMappings: authProcedure
    .input(z.object({ linkId: z.string().uuid().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Integrations.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Integrations.Read permission required' });
      }
      const siteScope = ctx.scopeFor('Integrations.Read');
      const linkScope = ctx.linkScopeFor('Integrations.Read');
      const noSiteScope = Array.isArray(siteScope) && siteScope.length === 0;
      const noLinkScope = Array.isArray(linkScope) && linkScope.length === 0;
      if (noSiteScope && noLinkScope) return { assignments: [], domainMappings: [] };
      const visibleBySite = Array.isArray(siteScope) && siteScope.length
        ? exists(
            ctx.db
              .select({ linkId: integrationLinkSiteAssignments.linkId })
              .from(integrationLinkSiteAssignments)
              .where(
                and(
                  eq(integrationLinkSiteAssignments.linkId, integrationLinks.id),
                  inArray(integrationLinkSiteAssignments.siteId, siteScope)
                )
              )
          )
        : undefined;
      const visibleByLink = Array.isArray(linkScope) && linkScope.length
        ? inArray(integrationLinks.id, linkScope)
        : undefined;
      const visibility = siteScope === 'all' || linkScope === 'all'
        ? ne(integrationLinks.id, '00000000-0000-0000-0000-000000000000')
        : or(visibleBySite, visibleByLink);
      const links = await ctx.db
        .select({ id: integrationLinks.id })
        .from(integrationLinks)
        .where(and(
          eq(integrationLinks.integrationId, 'microsoft-365'),
          isNull(integrationLinks.siteId),
          visibility,
          input.linkId ? eq(integrationLinks.id, input.linkId) : undefined
        ));
      if (input.linkId && links.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const linkIds = links.map((link) => link.id);
      if (linkIds.length === 0) return { assignments: [], domainMappings: [] };

      const [assignments, domainMappings] = await Promise.all([
        ctx.db
          .select({ linkId: integrationLinkSiteAssignments.linkId, siteId: integrationLinkSiteAssignments.siteId })
          .from(integrationLinkSiteAssignments)
          .where(inArray(integrationLinkSiteAssignments.linkId, linkIds)),
        ctx.db
          .select({ linkId: m365DomainSiteMappings.linkId, domain: m365DomainSiteMappings.domain, siteId: m365DomainSiteMappings.siteId })
          .from(m365DomainSiteMappings)
          .where(inArray(m365DomainSiteMappings.linkId, linkIds))
      ]);
      return { assignments, domainMappings };
    }),

  syncM365SiteMappings: authProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        siteIds: z.array(z.string().uuid()),
        domainMappings: z.array(z.object({ domain: z.string().min(1), siteId: z.string().uuid() }))
      })
    )
    .mutation(
      async ({
        ctx,
        input
      }): Promise<{
        link: IntegrationLinkRow;
        assignments: number;
        domainMappings: number;
      }> => {
        if (!ctx.can('Integrations.Write') || !ctx.can('Sites.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Integrations.Write and Sites.Write permissions required' });
        }
        const [parent] = await ctx.db
          .select()
          .from(integrationLinks)
          .where(eq(integrationLinks.id, input.linkId))
          .limit(1);
        if (!parent) throw new TRPCError({ code: 'NOT_FOUND' });
        if (parent.integrationId !== 'microsoft-365' || parent.siteId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'M365 site mappings require a tenant-scoped Microsoft 365 link'
          });
        }
        const siteIds = [...new Set(input.siteIds)];
        const permittedSites = ctx.scopeFor('Sites.Write');
        if (permittedSites !== 'all' && siteIds.some((siteId) => !permittedSites.includes(siteId))) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        const domainMappings = new Map<string, string>();
        const knownDomains = new Set(
          (((parent.meta as Record<string, unknown> | null)?.domains as string[] | undefined) ?? [])
            .map((domain) => domain.trim().toLowerCase())
        );
        for (const mapping of input.domainMappings) {
          const domain = mapping.domain.trim().toLowerCase();
          if (!domain) continue;
          if (!knownDomains.has(domain)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Domain ${domain} is not available on this Microsoft 365 tenant` });
          }
          if (!siteIds.includes(mapping.siteId)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'A domain can only be attributed to an assigned site' });
          }
          if (domainMappings.has(domain)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Domain ${domain} is mapped more than once` });
          }
          domainMappings.set(domain, mapping.siteId);
        }
        if (siteIds.length) {
          const existingSites = await ctx.db.select({ id: sites.id }).from(sites).where(inArray(sites.id, siteIds));
          if (existingSites.length !== siteIds.length) throw new TRPCError({ code: 'NOT_FOUND' });
          const conflicts = await ctx.db
            .select({ siteId: integrationLinkSiteAssignments.siteId })
            .from(integrationLinkSiteAssignments)
            .innerJoin(integrationLinks, eq(integrationLinks.id, integrationLinkSiteAssignments.linkId))
            .where(
              and(
                inArray(integrationLinkSiteAssignments.siteId, siteIds),
                eq(integrationLinks.integrationId, 'microsoft-365'),
                ne(integrationLinkSiteAssignments.linkId, parent.id)
              )
            );
          if (conflicts.length) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'A site can only be assigned to one Microsoft 365 tenant'
            });
          }
        }

        await ctx.db.transaction(async (tx) => {
          await tx.delete(m365DomainSiteMappings).where(eq(m365DomainSiteMappings.linkId, parent.id));
          await tx.delete(integrationLinkSiteAssignments).where(eq(integrationLinkSiteAssignments.linkId, parent.id));
          if (siteIds.length) {
            await tx.insert(integrationLinkSiteAssignments).values(siteIds.map((siteId) => ({ linkId: parent.id, siteId })));
          }
          if (domainMappings.size) {
            await tx.insert(m365DomainSiteMappings).values([...domainMappings].map(([domain, siteId]) => ({ linkId: parent.id, domain, siteId })));
          }
          // Keep domain-attributed identities consistent immediately. This is
          // a local projection update; it does not schedule another M365 API
          // request or ingestion job.
          await tx.update(m365Identities).set({ siteId: null }).where(eq(m365Identities.linkId, parent.id));
          for (const [domain, siteId] of domainMappings) {
            await tx
              .update(m365Identities)
              .set({ siteId })
              .where(and(
                eq(m365Identities.linkId, parent.id),
                sql`lower(split_part(${m365Identities.email}, '@', 2)) = ${domain}`
              ));
          }
        });

        await auditLinkChange(ctx, {
          linkId: parent.id,
          action: 'update',
          actionLabel: ActionLabels.IntegrationLinkUpdate,
          targetLabel: parent.name ?? parent.externalId ?? parent.id,
          siteId: null,
          metadata: {
            integrationId: parent.integrationId,
            changedFields: ['siteAssignments', 'domainMappings'],
            assignments: siteIds.length,
            domainMappings: domainMappings.size
          }
        });

        return {
          link: parent,
          assignments: siteIds.length,
          domainMappings: domainMappings.size
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
