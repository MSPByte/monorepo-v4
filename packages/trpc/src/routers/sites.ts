// TODO: Findings Implementation
import { z } from 'zod';
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  assets,
  coveEndpoints,
  customerLogs,
  dattoEndpoints,
  entitySources,
  findings,
  haloPsaRecurringItems,
  integrationLinks,
  integrationLinkSiteAssignments,
  m365Identities,
  siteProfileFacts,
  siteProfileFields,
  siteProfileNotes,
  siteStackCategories,
  siteStackEntries,
  sites,
  sitesWithCounts,
  sophosEndpointMigrations,
  sophosEndpoints,
  sophosFirewalls,
  sophosFirewallsWithSite,
  sophosLicenses,
  sophosTamperProtection
} from '@mspbyte/drizzle';
import {
  ActionLabels,
  type Permission
} from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';
import type { Context } from '../context.js';

type SiteRow = typeof sites.$inferSelect;

function requireSitePermission(ctx: Context, permission: Permission) {
  if (!ctx.can(permission)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${permission} permission required` });
  }
}

async function auditSiteChange(
  ctx: Context,
  input: {
    siteId: string;
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetLabel: string;
    metadata?: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: input.siteId,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: ctx.user.name || ctx.user.email,
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: 'site',
    targetId: input.siteId,
    targetLabel: input.targetLabel,
    result: 'success',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata ?? null
  });
}

const SUPPORTED_METRIC_KEYS = [
  'totalAssets',
  'workstations',
  'servers',
  'networkAssets',
  'openFindings',
  'connectedIntegrations'
] as const;

type MetricKey = (typeof SUPPORTED_METRIC_KEYS)[number];

const METRIC_LABELS: Record<MetricKey, string> = {
  totalAssets: 'Total Assets',
  workstations: 'Workstations',
  servers: 'Servers',
  networkAssets: 'Network Assets',
  openFindings: 'Open Findings',
  connectedIntegrations: 'Connected Integrations'
};

const METRIC_ORIGINS: Record<MetricKey, string> = {
  totalAssets: 'canonical.assets',
  workstations: 'canonical.assets',
  servers: 'canonical.assets',
  networkAssets: 'canonical.assets',
  openFindings: 'policy.findings',
  connectedIntegrations: 'integration_links'
};

const OPEN_STATUSES = ['open', 'acknowledged', 'regressed'] as const;

export const sitesRouter = t.router({
  overview: authProcedure.query(async ({ ctx }) => {
    const scope = ctx.scopeFor('Sites.Read');
    if (scope !== 'all' && scope.length === 0) {
      return {
        totalSites: 0,
        connectedSites: 0,
        sitesWithFindings: 0,
        totalAssets: 0,
        severity: { critical: 0, high: 0, medium: 0, low: 0 },
        hotspot: null as null | { id: string; name: string; openFindingCount: number }
      };
    }
    const scopeWhere = scope === 'all' ? undefined : inArray(sitesWithCounts.id, [...scope]);

    const [totalsRow, severityRows, hotspotRow] = await Promise.all([
      ctx.db
        .select({
          totalSites: sql<number>`count(*)::int`,
          connectedSites: sql<number>`count(*) filter (where coalesce(array_length(${sitesWithCounts.sources}, 1), 0) > 0)::int`,
          sitesWithFindings: sql<number>`count(*) filter (where ${sitesWithCounts.openFindingCount} > 0)::int`,
          totalAssets: sql<number>`coalesce(sum(${sitesWithCounts.assetCount}), 0)::int`,
        })
        .from(sitesWithCounts)
        .where(scopeWhere)
        .catch(() => [
          {
            totalSites: 0,
            connectedSites: 0,
            sitesWithFindings: 0,
            totalAssets: 0,
          }
        ]),
      ctx.db
        .select({
          severity: findings.severity,
          count: sql<number>`count(*)::int`
        })
        .from(findings)
        .where(
          and(
            inArray(findings.status, [...OPEN_STATUSES]),
            // Only count findings that map to a site — the portfolio strip
            // shouldn't include unattached findings.
            scope === 'all' ? isNotNull(findings.siteId) : inArray(findings.siteId, [...scope])
          ) as never
        )
        .groupBy(findings.severity)
        .catch(() => [] as { severity: number; count: number }[]),
      ctx.db
        .select({
          id: sitesWithCounts.id,
          name: sitesWithCounts.name,
          openFindingCount: sitesWithCounts.openFindingCount
        })
        .from(sitesWithCounts)
        .where(scopeWhere)
        .orderBy(desc(sitesWithCounts.openFindingCount))
        .limit(1)
        .catch(() => [] as { id: string; name: string; openFindingCount: number }[])
    ]);

    const severity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const row of severityRows) {
      if (row.severity === 4) severity.critical += row.count;
      else if (row.severity === 3) severity.high += row.count;
      else if (row.severity === 2) severity.medium += row.count;
      else severity.low += row.count;
    }

    const totals = totalsRow[0] ?? {
      totalSites: 0,
      connectedSites: 0,
      sitesWithFindings: 0,
      totalAssets: 0,
    };

    const hotspot = hotspotRow[0] && hotspotRow[0].openFindingCount > 0 ? hotspotRow[0] : null;

    return { ...totals, severity, hotspot };
  }),

  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const scope = ctx.scopeFor('Sites.Read');
    if (scope !== 'all' && scope.length === 0) {
      return { rows: [], total: 0, page: input.page, pageSize: input.pageSize, pageCount: 0 };
    }
    const scopeWhere = scope === 'all' ? undefined : inArray(sitesWithCounts.id, [...scope]);
    const result = await queryTableData<typeof sitesWithCounts.$inferSelect>(
      ctx.db,
      sitesWithCounts,
      input,
      [],
      {
        column: 'openFindingCount',
        direction: 'desc'
      },
      undefined,
      scopeWhere
    );
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
    const scope = ctx.scopeFor('Sites.Read');
    if (scope !== 'all' && scope.length === 0) return [];
    const rows = await ctx.db
      .select()
      .from(sitesWithCounts)
      .where(scope === 'all' ? undefined : inArray(sitesWithCounts.id, [...scope]))
      .orderBy(sitesWithCounts.name)
      .catch(() => []);
    return rows.map((site) => ({
      ...site,
      openFindingCount: site.openFindingCount,
      assetCount: site.assetCount,
      frameworkScore: 100,
      policyHealth: 100,
      sources: site.sources,
      recentActivity: []
    }));
  }),

  get: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<SiteRow> => {
      const scope = ctx.scopeFor('Sites.Read');
      if (scope !== 'all' && !scope.includes(input.id)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
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
    const scope = ctx.scopeFor('Sites.Read');
    if (scope !== 'all' && !scope.includes(input.id)) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
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
      frameworkScore: 100,
      policyHealth: 100,
      sources: site.sources,
      recentActivity: []
    };
  }),

  profileById: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const siteId = input.id;
      const scope = ctx.scopeFor('Sites.Read');
      if (scope !== 'all' && !scope.includes(siteId)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const [site] = await ctx.db
        .select()
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1)
        .catch(() => []);
      if (!site) throw new TRPCError({ code: 'NOT_FOUND' });

      const [
        factRows,
        fieldRows,
        noteRows,
        stackCategoryRows,
        stackEntryRows,
        linkRows,
        assetRows,
        openFindingsRow,
        networkAssetRows,
        firewallRows
      ] = await Promise.all([
        ctx.db
          .select()
          .from(siteProfileFacts)
          .where(eq(siteProfileFacts.siteId, siteId))
          .catch(() => []),
        ctx.db
          .select()
          .from(siteProfileFields)
          .where(eq(siteProfileFields.active, true))
          .catch(() => []),
        ctx.db
          .select()
          .from(siteProfileNotes)
          .where(and(eq(siteProfileNotes.siteId, siteId), eq(siteProfileNotes.active, true)))
          .catch(() => []),
        ctx.db
          .select()
          .from(siteStackCategories)
          .catch(() => []),
        ctx.db
          .select()
          .from(siteStackEntries)
          .where(eq(siteStackEntries.siteId, siteId))
          .catch(() => []),
        Promise.all([
          ctx.db
            .select()
            .from(integrationLinks)
            .where(
              and(
                eq(integrationLinks.siteId, siteId),
                inArray(integrationLinks.status, ['active', 'mapping'])
              )
            ),
          ctx.db
            .select({ link: integrationLinks })
            .from(integrationLinkSiteAssignments)
            .innerJoin(integrationLinks, eq(integrationLinks.id, integrationLinkSiteAssignments.linkId))
            .where(
              and(
                eq(integrationLinkSiteAssignments.siteId, siteId),
                eq(integrationLinks.status, 'active')
              )
            )
        ])
          .then(([direct, assigned]) => [
            ...new Map([...direct, ...assigned.map((row) => row.link)].map((link) => [link.id, link])).values()
          ])
          .catch(() => []),
        ctx.db
          .select({
            assetType: assets.assetType,
            count: count()
          })
          .from(assets)
          .where(eq(assets.siteId, siteId))
          .groupBy(assets.assetType)
          .catch(() => []),
        ctx.db
          .select({ count: count() })
          .from(findings)
          .where(
            and(
              eq(findings.siteId, siteId),
              inArray(findings.status, ['open', 'acknowledged', 'regressed'])
            )
          )
          .catch(() => [{ count: 0 }]),
        ctx.db
          .select({
            id: assets.id,
            displayName: assets.displayName,
            hostname: assets.hostname,
            assetType: assets.assetType,
            status: assets.status
          })
          .from(assets)
          .where(and(eq(assets.siteId, siteId), eq(assets.assetType, 'network')))
          .catch(() => []),
        ctx.db
          .select()
          .from(sophosFirewallsWithSite)
          .where(eq(sophosFirewallsWithSite.siteId, siteId))
          .catch(() => [])
      ]);

      const networkAssetIds = networkAssetRows.map((row) => row.id);
      const networkSourceRows = networkAssetIds.length
        ? await ctx.db
            .select({
              canonicalId: entitySources.canonicalId,
              provider: entitySources.provider
            })
            .from(entitySources)
            .where(
              and(
                eq(entitySources.canonicalType, 'asset'),
                inArray(entitySources.canonicalId, networkAssetIds),
                eq(entitySources.status, 'confirmed')
              )
            )
            .catch(() => [])
        : [];

      const networkSourcesByAsset = new Map<string, string[]>();
      for (const row of networkSourceRows) {
        const arr = networkSourcesByAsset.get(row.canonicalId) ?? [];
        if (!arr.includes(row.provider)) arr.push(row.provider);
        networkSourcesByAsset.set(row.canonicalId, arr);
      }

      type MergedField = {
        key: string;
        label: string;
        section: 'executive' | 'context';
        displayOrder: number;
        valueMode: 'single' | 'multiple';
        valueType: string | null;
      };
      const fieldByKey = new Map<string, MergedField>();
      for (const f of fieldRows) {
        if (!f.active) continue;
        fieldByKey.set(f.key, {
          key: f.key,
          label: f.label,
          section: f.section as 'executive' | 'context',
          displayOrder: f.displayOrder ?? 0,
          valueMode: (f.valueMode ?? 'single') as 'single' | 'multiple',
          valueType: f.valueType ?? null
        });
      }

      const factByKey = new Map(factRows.map((row) => [row.key, row]));
      const facts = [...fieldByKey.values()]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((field) => {
          const row = factByKey.get(field.key);
          return {
            key: field.key,
            label: field.label,
            category: field.section,
            value: (row?.value ?? null) as string | number | boolean | string[] | null,
            valueMode: field.valueMode,
            valueType: field.valueType,
            source: (row?.source ?? 'user_free') as
              | 'generated'
              | 'user_options'
              | 'user_free'
              | 'user_flex',
            origin: row?.origin ?? null,
            confidence: row?.confidence ?? null,
            applicable: (row?.applicable ?? (row ? 'applies' : 'unknown')) as
              | 'applies'
              | 'not_applicable'
              | 'unknown',
            updatedAt: row?.updatedAt ?? null
          };
        });

      const assetTypeCounts = new Map<string, number>();
      let totalAssets = 0;
      for (const row of assetRows) {
        const c = Number(row.count) || 0;
        assetTypeCounts.set(row.assetType, c);
        totalAssets += c;
      }

      const connectedIntegrations = linkRows.filter(
        (l) => l.status === 'active' || l.status === 'mapping'
      ).length;

      const metricValues: Record<MetricKey, number> = {
        totalAssets,
        workstations: assetTypeCounts.get('workstation') ?? 0,
        servers: assetTypeCounts.get('server') ?? 0,
        networkAssets: assetTypeCounts.get('network') ?? 0,
        openFindings: Number(openFindingsRow[0]?.count ?? 0),
        connectedIntegrations
      };

      const metrics = SUPPORTED_METRIC_KEYS.map((key) => ({
        key,
        label: METRIC_LABELS[key],
        value: metricValues[key],
        source: 'generated' as const,
        origin: METRIC_ORIGINS[key],
        supported: true
      }));

      type MergedCategory = {
        key: string;
        label: string;
        required: boolean;
        displayOrder: number;
        metadataFields: Array<{
          key: string;
          label: string;
          type: 'string' | 'number' | 'boolean' | 'url' | 'ip' | 'secret_ref';
          required?: boolean;
          helpText?: string | null;
        }>;
      };
      const categoryByKey = new Map<string, MergedCategory>();
      for (const c of stackCategoryRows) {
        categoryByKey.set(c.key, {
          key: c.key,
          label: c.label,
          required: c.required,
          displayOrder: c.displayOrder,
          metadataFields: (c.metadataFields ?? []) as MergedCategory['metadataFields']
        });
      }

      const normalizeStackStatus = (status: string | null | undefined) => {
        if (status === 'managed') return 'msp_managed';
        if (status === 'third_party') return 'vendor_managed';
        return status ?? 'unknown';
      };
      const stackEntryByKey = new Map(stackEntryRows.map((e) => [e.key, e]));
      const stack = [...categoryByKey.values()]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((cat) => {
          const entry = stackEntryByKey.get(cat.key);
          return {
            categoryKey: cat.key,
            categoryLabel: cat.label,
            required: cat.required,
            metadataFields: cat.metadataFields,
            vendor: entry?.vendor ?? null,
            product: entry?.product ?? null,
            status: normalizeStackStatus(entry?.status) as
              | 'msp_managed'
              | 'client_managed'
              | 'vendor_managed'
              | 'not_used'
              | 'planned'
              | 'unknown',
            notes: entry?.notes ?? null,
            metadata: (entry?.metadata ?? null) as Record<string, string> | null,
            source: (entry?.source ?? 'manual') as 'generated' | 'manual',
            origin: entry?.origin ?? null
          };
        });

      const notes = noteRows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        severity: row.severity,
        active: row.active,
        updatedAt: row.updatedAt
      }));

      const integrationsResponse = linkRows.map((link) => ({
        id: link.id,
        integrationId: link.integrationId,
        name: link.name,
        status: link.status,
        disposition: link.disposition,
        meta: link.meta as Record<string, unknown> | null
      }));

      const networkAssets = networkAssetRows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        hostname: row.hostname,
        assetType: row.assetType,
        status: row.status,
        sources: networkSourcesByAsset.get(row.id) ?? []
      }));

      const firewalls = firewallRows.map((row) => ({
        id: row.id,
        name: row.name,
        hostname: row.hostname,
        model: row.model,
        serialNumber: row.serialNumber,
        firmwareVersion: row.firmwareVersion,
        externalIp: row.externalIp,
        connected: row.connected,
        suspended: row.suspended,
        managing: row.managing,
        reporting: row.reporting,
        upgradeToVersion: row.upgradeToVersion,
        lastSeenAt: row.lastSeenAt,
        origin: 'sophos-partner' as const
      }));

      const applicableFacts = facts.filter((f) => f.applicable !== 'not_applicable');
      const completeFacts = applicableFacts.filter(
        (f) =>
          f.value !== null &&
          f.value !== undefined &&
          f.value !== '' &&
          (!Array.isArray(f.value) || f.value.length > 0)
      );
      const applicableCount = applicableFacts.length;
      const completeCount = completeFacts.length;
      const completeness = {
        value: applicableCount === 0 ? 0 : Math.round((completeCount / applicableCount) * 100),
        applicableCount,
        completeCount
      };

      return {
        site: {
          id: site.id,
          name: site.name,
          description: site.description,
          createdAt: site.createdAt,
          updatedAt: site.updatedAt
        },
        facts,
        metrics,
        stack,
        notes,
        integrations: integrationsResponse,
        network: {
          assets: networkAssets,
          firewalls
        },
        completeness
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
      requireSitePermission(ctx, 'Sites.Write');
      const [site] = await ctx.db
        .insert(sites)
        .values({ name: input.name, description: input.description })
        .returning();
      if (!site) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await auditSiteChange(ctx, {
        siteId: site.id,
        action: 'create',
        actionLabel: ActionLabels.SiteCreate,
        targetLabel: site.name,
        metadata: { name: site.name, description: site.description }
      });

      return site;
    }),

  rename: authProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1, 'Name is required').max(200)
      })
    )
    .mutation(async ({ ctx, input }): Promise<SiteRow> => {
      requireSitePermission(ctx, 'Sites.Write');
      const [existing] = await ctx.db.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      if (existing.name === input.name) return existing;

      const [row] = await ctx.db
        .update(sites)
        .set({ name: input.name })
        .where(eq(sites.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await auditSiteChange(ctx, {
        siteId: row.id,
        action: 'update',
        actionLabel: ActionLabels.SiteRename,
        targetLabel: row.name,
        metadata: { previousName: existing.name, newName: row.name }
      });

      return row;
    }),

  delete: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete');
      const [existing] = await ctx.db.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      try {
        await ctx.db.transaction(async (tx) => {
          await tx
            .update(customerLogs)
            .set({ siteId: null })
            .where(eq(customerLogs.siteId, input.id));
          await tx
            .update(entitySources)
            .set({ siteId: null })
            .where(eq(entitySources.siteId, input.id));

          await tx
            .update(haloPsaRecurringItems)
            .set({ siteId: null })
            .where(eq(haloPsaRecurringItems.siteId, input.id));
          await tx
            .update(m365Identities)
            .set({ siteId: null })
            .where(eq(m365Identities.siteId, input.id));
          await tx
            .update(dattoEndpoints)
            .set({ siteId: null })
            .where(eq(dattoEndpoints.siteId, input.id));
          await tx
            .update(coveEndpoints)
            .set({ siteId: null })
            .where(eq(coveEndpoints.siteId, input.id));
          await tx
            .update(sophosEndpoints)
            .set({ siteId: null })
            .where(eq(sophosEndpoints.siteId, input.id));
          await tx
            .update(sophosTamperProtection)
            .set({ siteId: null })
            .where(eq(sophosTamperProtection.siteId, input.id));
          await tx
            .update(sophosFirewalls)
            .set({ siteId: null })
            .where(eq(sophosFirewalls.siteId, input.id));
          await tx
            .update(sophosLicenses)
            .set({ siteId: null })
            .where(eq(sophosLicenses.siteId, input.id));
          await tx
            .update(sophosEndpointMigrations)
            .set({ fromSiteId: null })
            .where(eq(sophosEndpointMigrations.fromSiteId, input.id));
          await tx
            .update(sophosEndpointMigrations)
            .set({ toSiteId: null })
            .where(eq(sophosEndpointMigrations.toSiteId, input.id));

          await tx.delete(integrationLinks).where(eq(integrationLinks.siteId, input.id));
          await tx.delete(sites).where(eq(sites.id, input.id));
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.db.insert(customerLogs).values({
          siteId: existing.id,
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'delete',
          actionLabel: ActionLabels.SiteDelete,
          targetType: 'site',
          targetId: existing.id,
          targetLabel: existing.name,
          result: 'failure',
          errorMessage: message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: { name: existing.name }
        });
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'Site deletion failed while cleaning up related records. Some references may still need explicit handling.'
        });
      }

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'delete',
        actionLabel: ActionLabels.SiteDelete,
        targetType: 'site',
        targetId: existing.id,
        targetLabel: existing.name,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          name: existing.name,
          description: existing.description
        }
      });

      return { ok: true };
    })
});
