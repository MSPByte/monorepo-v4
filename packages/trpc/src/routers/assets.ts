import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  assetsWithSites,
  entitySources,
  findingsWithContext,
  integrationLinks
} from '@mspbyte/drizzle';
import { getPolicyTableShape } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { mockAssets, mockSites } from './domain-fixtures.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const OPEN_STATUSES = ['open', 'acknowledged', 'regressed'] as const;

const mockAssetRows = () =>
  mockAssets.map((asset) => ({
    ...asset,
    assetType: asset.type,
    siteName: mockSites.find((site) => site.id === asset.siteId)?.name ?? 'Unknown site',
    sourceList: asset.sources.join(', ')
  }));

function toProper(value: string): string {
  return value
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function tableLabel(table?: string | null): string {
  if (!table) return 'Source record';
  return getPolicyTableShape(table)?.label ?? toProper(table.split('.').pop() ?? table);
}

export const assetsRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData(ctx.db, assetsWithSites, input, mockAssetRows(), {
      column: 'openFindingCount',
      direction: 'desc'
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        sourceList: Array.isArray(row.sources) ? row.sources.join(', ') : ''
      }))
    };
  }),

  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(assetsWithSites)
      .orderBy(assetsWithSites.displayName)
      .limit(500)
      .catch(() => []);
    if (!rows.length) return mockAssets;

    return rows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      hostname: row.hostname ?? row.displayName,
      displayName: row.displayName,
      type: row.assetType,
      os: row.os ?? 'Unknown',
      status: row.status,
      sources: row.sources,
      openFindingCount: row.openFindingCount,
      relatedPeople: [],
      vendorEvidence: []
    }));
  }),

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(assetsWithSites)
      .where(eq(assetsWithSites.id, input.id))
      .limit(1)
      .catch(() => []);
    if (row) {
      const sources = await ctx.db
        .select()
        .from(entitySources)
        .where(
          and(
            eq(entitySources.canonicalType, 'asset'),
            eq(entitySources.canonicalId, input.id),
            eq(entitySources.status, 'confirmed')
          )
        )
        .catch(() => []);

      const linkIds = [
        ...new Set(sources.map((source) => source.linkId).filter((id): id is string => !!id))
      ];
      const links = linkIds.length
        ? await ctx.db
            .select()
            .from(integrationLinks)
            .where(inArray(integrationLinks.id, linkIds))
            .catch(() => [])
        : [];
      const linkById = new Map(links.map((link) => [link.id, link]));

      const assetFindings = await ctx.db
        .select({
          id: findingsWithContext.id,
          title: findingsWithContext.title,
          severity: findingsWithContext.severity,
          status: findingsWithContext.status,
          siteId: findingsWithContext.siteId,
          siteName: findingsWithContext.siteName,
          linkId: findingsWithContext.linkId,
          linkName: findingsWithContext.linkName,
          resourceType: findingsWithContext.resourceType,
          resourceId: findingsWithContext.resourceId,
          resourceName: findingsWithContext.resourceName,
          policyId: findingsWithContext.policyId,
          policyName: findingsWithContext.policyName,
          evidenceSummary: findingsWithContext.evidenceSummary,
          recommendation: findingsWithContext.recommendation,
          firstSeenAt: findingsWithContext.firstSeenAt,
          lastSeenAt: findingsWithContext.lastSeenAt
        })
        .from(findingsWithContext)
        .where(
          and(
            eq(findingsWithContext.resourceType, 'asset'),
            eq(findingsWithContext.resourceId, input.id),
            inArray(findingsWithContext.status, [...OPEN_STATUSES])
          )
        )
        .orderBy(desc(findingsWithContext.severity), desc(findingsWithContext.lastSeenAt))
        .catch(() => []);

      const vendorEvidence = sources.map((source) => {
        const link = source.linkId ? linkById.get(source.linkId) : undefined;
        return {
          id: source.id,
          label: tableLabel(source.vendorTable),
          table: source.vendorTable,
          provider: source.provider,
          type: source.type,
          externalId: source.externalId,
          vendorRecordId: source.vendorRecordId,
          linkId: source.linkId,
          linkName: link?.name ?? source.linkId ?? null,
          linkStatus: link?.status ?? null,
          integrationId: link?.integrationId ?? null,
          siteId: source.siteId ?? link?.siteId ?? null,
          confidence: source.confidence,
          matchMethod: source.matchMethod,
          matchEvidence: source.matchEvidence,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt
        };
      });

      const sourceLinks = [
        ...new Map(
          vendorEvidence
            .filter((source) => source.linkId)
            .map((source) => [
              source.linkId!,
              {
                id: source.linkId!,
                name: source.linkName ?? source.linkId!,
                status: source.linkStatus,
                integrationId: source.integrationId,
                siteId: source.siteId,
                sourceCount: vendorEvidence.filter((item) => item.linkId === source.linkId).length
              }
            ])
        ).values()
      ];

      return {
        id: row.id,
        siteId: row.siteId,
        siteName: row.siteName,
        hostname: row.hostname ?? row.displayName,
        displayName: row.displayName,
        serialNumber: row.serialNumber,
        type: row.assetType,
        os: row.os ?? 'Unknown',
        status: row.status,
        sourceConfidence: row.sourceConfidence,
        sources: row.sources,
        openFindingCount: row.openFindingCount,
        relatedPeople: [],
        vendorEvidence,
        sourceLinks,
        findings: assetFindings,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };
    }

    const mock = mockAssets.find((asset) => asset.id === input.id);
    if (!mock) throw new TRPCError({ code: 'NOT_FOUND' });
    return mock;
  })
});
