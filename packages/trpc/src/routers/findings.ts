import { z } from 'zod';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { findings, findingsWithContext, entitySources } from '@mspbyte/drizzle';
import { PolicyTableShapes } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const OPEN_STATUSES = ['open', 'acknowledged', 'regressed'] as const;

const listInput = z
  .object({
    severity: z.number().optional(),
    status: z.string().optional(),
    siteId: z.string().optional(),
    policyId: z.string().optional(),
    resourceType: z.string().optional()
  })
  .optional();

// Friendly labels for vendor / canonical tables, keyed by both camelCase and
// snake_case so we can resolve whatever shape the finding/entity-source stores.
const TABLE_LABELS: Record<string, string> = {};
for (const shape of PolicyTableShapes) {
  const snake = shape.table.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  TABLE_LABELS[shape.table.toLowerCase()] = shape.label;
  TABLE_LABELS[snake] = shape.label;
}

function toProper(value: string): string {
  return value
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function tableLabel(table?: string | null): string | null {
  if (!table) return null;
  // tables can arrive schema-qualified ("canonical.people") or snake/camel cased.
  const base = (table.includes('.') ? table.split('.').pop()! : table).toLowerCase();
  return TABLE_LABELS[base] ?? TABLE_LABELS[base.replace(/_/g, '')] ?? toProper(base);
}

function canonicalHref(resourceType: string, resourceId: string): string | null {
  if (resourceType === 'person') return `/people/${resourceId}`;
  if (resourceType === 'asset') return `/assets/${resourceId}`;
  return null;
}

export const findingsRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    return queryTableData<typeof findingsWithContext.$inferSelect>(ctx.db, findingsWithContext, input, [], {
      column: 'severity',
      direction: 'desc'
    });
  }),

  list: authProcedure.input(listInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(findingsWithContext)
      .orderBy(desc(findingsWithContext.lastSeenAt))
      .limit(200)
      .catch(() => []);
    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        siteId: row.siteId,
        siteName: row.siteName,
        linkName: row.linkName,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        resourceName: row.resourceName,
        policyId: row.policyId,
        policyName: row.policyName,
        evidenceSummary: row.evidenceSummary,
        recommendation: row.recommendation ?? 'Review the evidence and remediate or suppress.',
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt
      }))
      .filter((finding) => {
        if (input?.severity && finding.severity !== input.severity) return false;
        if (input?.status && finding.status !== input.status) return false;
        if (input?.siteId && finding.siteId !== input.siteId) return false;
        if (input?.policyId && finding.policyId !== input.policyId) return false;
        if (input?.resourceType && finding.resourceType !== input.resourceType) return false;
        return true;
      });
  }),

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(findingsWithContext)
      .where(eq(findingsWithContext.id, input.id))
      .limit(1)
      .catch(() => []);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

    // Raw evidence payload lives on the base table, not the view.
    const [base] = await ctx.db
      .select({ evidence: findings.evidence })
      .from(findings)
      .where(eq(findings.id, input.id))
      .limit(1)
      .catch(() => []);

    const evidence = (base?.evidence ?? {}) as Record<string, unknown>;

    // Data sources: the canonical entity (linkable) plus the underlying vendor
    // records it was reconciled from (e.g. the M365 identity behind a person).
    const dataSources: {
      kind: 'canonical' | 'vendor';
      label: string;
      name: string;
      href: string | null;
      externalId: string | null;
      provider: string | null;
    }[] = [];

    const canonicalLabel = tableLabel(row.resourceTable) ?? toProper(row.resourceType);
    dataSources.push({
      kind: 'canonical',
      label: canonicalLabel,
      name: row.resourceName,
      href: canonicalHref(row.resourceType, row.resourceId),
      externalId: row.resourceExternalId ?? null,
      provider: null
    });

    if (row.resourceType === 'person' || row.resourceType === 'asset') {
      const sources = await ctx.db
        .select()
        .from(entitySources)
        .where(
          and(
            eq(entitySources.canonicalType, row.resourceType),
            eq(entitySources.canonicalId, row.resourceId),
            eq(entitySources.status, 'confirmed')
          )
        )
        .catch(() => []);
      const seen = new Set<string>();
      for (const source of sources) {
        const key = `${source.vendorTable}:${source.externalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dataSources.push({
          kind: 'vendor',
          label: tableLabel(source.vendorTable) ?? toProper(source.vendorTable),
          name: source.externalId,
          href: null,
          externalId: source.externalId,
          provider: source.provider
        });
      }
    }

    // Friendly source badges for the header (deduped labels).
    const sourceLabels = [...new Set(dataSources.map((s) => s.label))];

    // "Living" context: other open findings that share this site or policy.
    const relatedColumns = {
      id: findingsWithContext.id,
      title: findingsWithContext.title,
      severity: findingsWithContext.severity,
      status: findingsWithContext.status,
      resourceName: findingsWithContext.resourceName,
      siteName: findingsWithContext.siteName,
      policyName: findingsWithContext.policyName,
      lastSeenAt: findingsWithContext.lastSeenAt
    };

    const relatedBySite = row.siteId
      ? await ctx.db
          .select(relatedColumns)
          .from(findingsWithContext)
          .where(
            and(
              eq(findingsWithContext.siteId, row.siteId),
              ne(findingsWithContext.id, row.id),
              inArray(findingsWithContext.status, [...OPEN_STATUSES])
            )
          )
          .orderBy(desc(findingsWithContext.severity), desc(findingsWithContext.lastSeenAt))
          .limit(8)
          .catch(() => [])
      : [];

    const relatedByPolicy = await ctx.db
      .select(relatedColumns)
      .from(findingsWithContext)
      .where(
        and(
          eq(findingsWithContext.policyId, row.policyId),
          ne(findingsWithContext.id, row.id),
          inArray(findingsWithContext.status, [...OPEN_STATUSES])
        )
      )
      .orderBy(desc(findingsWithContext.severity), desc(findingsWithContext.lastSeenAt))
      .limit(8)
      .catch(() => []);

    return {
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      siteId: row.siteId,
      siteName: row.siteName,
      linkId: row.linkId,
      linkName: row.linkName,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      policyId: row.policyId,
      policyName: row.policyName,
      evidenceSummary: row.evidenceSummary,
      evidence,
      recommendation: row.recommendation ?? 'Review the evidence and remediate or suppress.',
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      sources: sourceLabels,
      dataSources,
      relatedBySite,
      relatedByPolicy
    };
  })
});
