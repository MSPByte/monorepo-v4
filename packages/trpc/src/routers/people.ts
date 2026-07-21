import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  entitySources,
  findingsWithContext,
  integrationLinks,
  peopleWithSites
} from '@mspbyte/drizzle';
import { getPolicyTableShape } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { mockPeople, mockSites } from './domain-fixtures.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const OPEN_STATUSES = ['open', 'acknowledged', 'regressed'] as const;

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

const mockPersonRows = () =>
  mockPeople.map((person) => ({
    ...person,
    siteName: mockSites.find((site) => site.id === person.siteId)?.name ?? 'Unknown site',
    sourceList: person.sources.join(', '),
    licenseList: person.licenses.join(', ')
  }));

export const peopleRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData(ctx.db, peopleWithSites, input, mockPersonRows(), {
      column: 'openFindingCount',
      direction: 'desc'
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        sourceList: Array.isArray(row.sources) ? row.sources.join(', ') : '',
        licenseList: 'licenses' in row && Array.isArray(row.licenses) ? row.licenses.join(', ') : ''
      }))
    };
  }),

  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(peopleWithSites)
      .orderBy(peopleWithSites.displayName)
      .limit(500)
      .catch(() => []);
    if (!rows.length) return mockPeople;

    return rows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      displayName: row.displayName,
      primaryEmail: row.primaryEmail,
      status: row.status,
      sources: row.sources,
      openFindingCount: row.openFindingCount,
      relatedAssets: [],
      licenses: [],
      vendorEvidence: []
    }));
  }),

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(peopleWithSites)
      .where(eq(peopleWithSites.id, input.id))
      .limit(1)
      .catch(() => []);
    if (row) {
      const sources = await ctx.db
        .select()
        .from(entitySources)
        .where(
          and(
            eq(entitySources.canonicalType, 'person'),
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

      const personFindings = await ctx.db
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
            eq(findingsWithContext.resourceType, 'person'),
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
        displayName: row.displayName,
        primaryEmail: row.primaryEmail,
        status: row.status,
        sourceConfidence: row.sourceConfidence,
        sources: row.sources,
        openFindingCount: row.openFindingCount,
        relatedAssets: [],
        licenses: [],
        vendorEvidence,
        sourceLinks,
        findings: personFindings,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };
    }

    const mock = mockPeople.find((person) => person.id === input.id);
    if (!mock) throw new TRPCError({ code: 'NOT_FOUND' });
    return mock;
  })
});
