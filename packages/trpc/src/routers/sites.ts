// TODO: Findings Implementation
import { z } from 'zod';
import { and, count, eq, inArray } from 'drizzle-orm';
import {
  assets,
  entitySources,
  findings,
  integrationLinks,
  people,
  siteProfileFacts,
  siteProfileFields,
  siteProfileNotes,
  siteStackCategories,
  siteStackEntries,
  sites,
  sitesWithCounts,
  sophosFirewallsWithSite
} from '@mspbyte/drizzle';
import {
  BUILT_IN_PROFILE_FIELDS,
  BUILT_IN_STACK_CATEGORIES,
  hasPermission,
  type Permission
} from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';
import { ensureCatalogDefaults } from './site-profile.js';
import type { Context } from '../context.js';

type SiteRow = typeof sites.$inferSelect;

function requireSitePermission(ctx: Context, permission: Permission) {
  const attrs = (ctx.role.attributes as Record<string, boolean> | null) ?? null;
  if (!hasPermission(attrs, permission)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${permission} permission required` });
  }
}

const SUPPORTED_METRIC_KEYS = [
  'totalAssets',
  'people',
  'workstations',
  'servers',
  'networkAssets',
  'mobileDevices',
  'openFindings',
  'connectedIntegrations'
] as const;

type MetricKey = (typeof SUPPORTED_METRIC_KEYS)[number];

const METRIC_LABELS: Record<MetricKey, string> = {
  totalAssets: 'Total Assets',
  people: 'People',
  workstations: 'Workstations',
  servers: 'Servers',
  networkAssets: 'Network Assets',
  mobileDevices: 'Mobile Devices',
  openFindings: 'Open Findings',
  connectedIntegrations: 'Connected Integrations'
};

const METRIC_ORIGINS: Record<MetricKey, string> = {
  totalAssets: 'canonical.assets',
  people: 'canonical.people',
  workstations: 'canonical.assets',
  servers: 'canonical.assets',
  networkAssets: 'canonical.assets',
  mobileDevices: 'canonical.assets',
  openFindings: 'policy.findings',
  connectedIntegrations: 'integration_links'
};

export const sitesRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData<typeof sitesWithCounts.$inferSelect>(
      ctx.db,
      sitesWithCounts,
      input,
      [],
      {
        column: 'openFindingCount',
        direction: 'desc'
      }
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
    const rows = await ctx.db
      .select()
      .from(sitesWithCounts)
      .orderBy(sitesWithCounts.name)
      .catch(() => []);
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

  profileById: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const siteId = input.id;
      await ensureCatalogDefaults(ctx.db);

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
        peopleCountRow,
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
        ctx.db
          .select()
          .from(integrationLinks)
          .where(eq(integrationLinks.siteId, siteId))
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
          .from(people)
          .where(eq(people.siteId, siteId))
          .catch(() => [{ count: 0 }]),
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
      };
      const fieldByKey = new Map<string, MergedField>();
      for (const f of BUILT_IN_PROFILE_FIELDS) {
        fieldByKey.set(f.key, {
          key: f.key,
          label: f.label,
          section: f.section,
          displayOrder: f.displayOrder,
          valueMode: f.valueMode
        });
      }
      for (const f of fieldRows) {
        if (!f.active) continue;
        fieldByKey.set(f.key, {
          key: f.key,
          label: f.label,
          section: f.section as 'executive' | 'context',
          displayOrder: f.displayOrder ?? 0,
          valueMode: (f.valueMode ?? 'single') as 'single' | 'multiple'
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

      const connectedIntegrations = linkRows.filter((l) => l.status === 'active').length;

      const metricValues: Record<MetricKey, number> = {
        totalAssets,
        people: Number(peopleCountRow[0]?.count ?? 0),
        workstations: assetTypeCounts.get('workstation') ?? 0,
        servers: assetTypeCounts.get('server') ?? 0,
        networkAssets: assetTypeCounts.get('network') ?? 0,
        mobileDevices: assetTypeCounts.get('mobile') ?? 0,
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
      for (const c of BUILT_IN_STACK_CATEGORIES) {
        categoryByKey.set(c.key, {
          key: c.key,
          label: c.label,
          required: c.required,
          displayOrder: c.displayOrder,
          metadataFields: c.metadataFields ?? []
        });
      }
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
        disposition: link.disposition
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
          parentSiteId: site.parentSiteId,
          createdAt: site.createdAt,
          updatedAt: site.updatedAt
        },
        facts,
        metrics,
        stack,
        notes,
        contacts: [] as Array<{
          role: string;
          name: string;
          email: string | null;
          phone: string | null;
          source: 'generated' | 'user_options' | 'user_free' | 'user_flex';
          origin: string | null;
        }>,
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
      return site!;
    })
});
