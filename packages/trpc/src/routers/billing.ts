import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  billingPsaItems,
  billingReconciliationRules,
  integrationLinks,
  siteGroupMembers,
  siteGroups,
  sites,
  sophosEndpoints,
  sophosFirewalls,
  sophosLicenses,
  dattoEndpoints,
  coveEndpoints,
  m365Identities,
  m365Licenses,
  m365Devices
} from '@mspbyte/drizzle';
import { BILLING_FACETS, getBillingFacet, listBillingFacets, ProviderFacet } from '@mspbyte/shared';
import type { BillingFacetConfig } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

const psaItemMatchSchema = z.object({
  field: z.enum(['itemName', 'externalId']).default('itemName'),
  operator: z.enum(['contains', 'eq']).default('contains'),
  value: z.string().min(1)
});

const vendorFilterSchema = z.object({
  column: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'is_null', 'is_not_null']),
  value: z.union([z.string(), z.boolean()]).optional()
});

const supportedFacets = Object.keys(BILLING_FACETS) as [string, ...string[]];
const supportedProviders = Array.from(new Set(listBillingFacets().map((f) => f.providerId))) as [
  string,
  ...string[]
];

const upsertRuleSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  siteId: z.uuid().nullable().optional(),
  psaItemMatch: psaItemMatchSchema,
  vendorProvider: z.enum(supportedProviders),
  vendorFacet: z.enum(supportedFacets),
  vendorFilters: z.array(vendorFilterSchema).default([]),
  countMode: z.literal('count_rows').default('count_rows')
});

type PsaItem = typeof billingPsaItems.$inferSelect;
type Rule = typeof billingReconciliationRules.$inferSelect;
type PsaItemMatch = z.infer<typeof psaItemMatchSchema>;
type VendorFilter = z.infer<typeof vendorFilterSchema>;

type ReconciliationRow = {
  siteId: string | null;
  siteName: string;
  psaItemId: string | null;
  psaItemName: string;
  ruleId: string | null;
  ruleName: string | null;
  vendorProvider: string | null;
  vendorFacet: string | null;
  vendorFacetLabel: string | null;
  billedQuantity: number;
  actualQuantity: number;
  diffQuantity: number;
  unitPrice: number;
  monthlyDelta: number;
  status: 'matched' | 'underbilled' | 'overbilled' | 'missing_rule' | 'missing_psa_line';
  evidence: {
    psaMatch?: PsaItemMatch;
    vendorFilters?: VendorFilter[];
    matchedRowIds?: string[];
  };
};

const FACET_TABLES = {
  [ProviderFacet.SophosEndpoints]: sophosEndpoints,
  [ProviderFacet.SophosFirewalls]: sophosFirewalls,
  [ProviderFacet.SophosLicenses]: sophosLicenses,
  [ProviderFacet.DattoEndpoints]: dattoEndpoints,
  [ProviderFacet.CoveEndpoints]: coveEndpoints,
  [ProviderFacet.M365Identities]: m365Identities,
  [ProviderFacet.M365Licenses]: m365Licenses,
  [ProviderFacet.M365Devices]: m365Devices
} as const;

type FacetKey = keyof typeof FACET_TABLES;

function isSupportedFacet(facet: string): facet is FacetKey {
  return facet in FACET_TABLES;
}

function parsePsaItemMatch(value: unknown): PsaItemMatch | null {
  const parsed = psaItemMatchSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseVendorFilters(value: unknown): VendorFilter[] {
  const parsed = z.array(vendorFilterSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function numberValue(value: string | number | null): number {
  return Number(value ?? 0) || 0;
}

function matchesPsaItem(item: PsaItem, match: PsaItemMatch): boolean {
  const actual = match.field === 'externalId' ? item.externalId : item.itemName;
  if (match.operator === 'eq') return actual === match.value;
  return actual.toLowerCase().includes(match.value.toLowerCase());
}

function normalizeFilterValue(raw: string | boolean | undefined): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return raw;
}

function matchesVendorFilter(row: Record<string, unknown>, filter: VendorFilter): boolean {
  const actual = row[filter.column];
  switch (filter.operator) {
    case 'eq':
      return String(actual ?? '') === normalizeFilterValue(filter.value);
    case 'neq':
      return String(actual ?? '') !== normalizeFilterValue(filter.value);
    case 'is_null':
      return actual == null;
    case 'is_not_null':
      return actual != null;
  }
}

function ruleStatus(billedQuantity: number, actualQuantity: number): ReconciliationRow['status'] {
  if (actualQuantity > billedQuantity) return 'underbilled';
  if (actualQuantity < billedQuantity) return 'overbilled';
  return 'matched';
}

type FacetIndex = Map<string, Record<string, unknown>[]>; // siteId → rows (siteId '' means unmapped)

async function loadFacetIndex(
  db: any,
  facet: FacetKey,
  linkSiteMap: Map<string, string | null>
): Promise<FacetIndex> {
  const table = FACET_TABLES[facet];
  const rows: Record<string, unknown>[] = await db.select().from(table);
  const index: FacetIndex = new Map();
  for (const row of rows) {
    const direct = (row as { siteId?: string | null }).siteId ?? null;
    const linkId = (row as { linkId?: string | null }).linkId ?? null;
    const siteId = direct ?? (linkId ? (linkSiteMap.get(linkId) ?? null) : null);
    const key = siteId ?? '';
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

function countMatches(
  index: FacetIndex,
  siteId: string | null,
  filters: VendorFilter[]
): { count: number; matchedIds: string[] } {
  const rows = index.get(siteId ?? '') ?? [];
  const matched = rows.filter((row) => filters.every((filter) => matchesVendorFilter(row, filter)));
  return {
    count: matched.length,
    matchedIds: matched.map((row) => String((row as { id?: string }).id ?? ''))
  };
}

async function buildReport(
  db: any
): Promise<{ rows: ReconciliationRow[]; summary: ReportSummary }> {
  const [items, rules, siteRows, linkRows] = await Promise.all([
    db.select().from(billingPsaItems),
    db
      .select()
      .from(billingReconciliationRules)
      .where(eq(billingReconciliationRules.enabled, true)),
    db.select().from(sites),
    db.select({ id: integrationLinks.id, siteId: integrationLinks.siteId }).from(integrationLinks)
  ]);

  const siteNames = new Map<string, string>(
    siteRows.map((site: typeof sites.$inferSelect) => [site.id, site.name])
  );
  const linkSiteMap = new Map<string, string | null>(
    linkRows.map((row: { id: string; siteId: string | null }) => [row.id, row.siteId])
  );

  // Batch-load each facet that's referenced by an enabled rule (fixes the N+1)
  const facetsUsed = new Set<FacetKey>();
  for (const rule of rules as Rule[]) {
    if (isSupportedFacet(rule.vendorFacet)) facetsUsed.add(rule.vendorFacet);
  }
  const facetIndexes = new Map<FacetKey, FacetIndex>();
  await Promise.all(
    Array.from(facetsUsed).map(async (facet) => {
      facetIndexes.set(facet, await loadFacetIndex(db, facet, linkSiteMap));
    })
  );

  const rows: ReconciliationRow[] = [];
  const matchedPsaItemIds = new Set<string>();

  for (const rule of rules as Rule[]) {
    const match = parsePsaItemMatch(rule.psaItemMatch);
    if (!match) continue;
    if (!isSupportedFacet(rule.vendorFacet)) continue;

    const facetConfig = getBillingFacet(rule.vendorFacet);
    const filters = parseVendorFilters(rule.vendorFilters);
    const facetIndex = facetIndexes.get(rule.vendorFacet)!;

    const candidateItems = (items as PsaItem[]).filter((item) => {
      if (rule.siteId && item.siteId !== rule.siteId) return false;
      return matchesPsaItem(item, match);
    });

    if (!candidateItems.length) {
      const siteId = rule.siteId ?? null;
      const evidence = countMatches(facetIndex, siteId, filters);
      rows.push({
        siteId,
        siteName: siteId ? (siteNames.get(siteId) ?? 'Unknown site') : 'All sites',
        psaItemId: null,
        psaItemName: 'No matching PSA item',
        ruleId: rule.id,
        ruleName: rule.name,
        vendorProvider: rule.vendorProvider,
        vendorFacet: rule.vendorFacet,
        vendorFacetLabel: facetConfig?.label ?? rule.vendorFacet,
        billedQuantity: 0,
        actualQuantity: evidence.count,
        diffQuantity: evidence.count,
        unitPrice: 0,
        monthlyDelta: 0,
        status: 'missing_psa_line',
        evidence: {
          psaMatch: match,
          vendorFilters: filters,
          matchedRowIds: evidence.matchedIds
        }
      });
      continue;
    }

    for (const item of candidateItems) {
      matchedPsaItemIds.add(item.id);
      const siteId = item.siteId ?? rule.siteId ?? null;
      const evidence = countMatches(facetIndex, siteId, filters);
      const billedQuantity = item.quantity;
      const actualQuantity = evidence.count;
      const diffQuantity = actualQuantity - billedQuantity;
      const unitPrice = numberValue(item.unitPrice);

      rows.push({
        siteId,
        siteName: siteId
          ? (siteNames.get(siteId) ?? item.customerName ?? 'Unknown site')
          : 'Unmapped',
        psaItemId: item.id,
        psaItemName: item.itemName,
        ruleId: rule.id,
        ruleName: rule.name,
        vendorProvider: rule.vendorProvider,
        vendorFacet: rule.vendorFacet,
        vendorFacetLabel: facetConfig?.label ?? rule.vendorFacet,
        billedQuantity,
        actualQuantity,
        diffQuantity,
        unitPrice,
        monthlyDelta: diffQuantity * unitPrice,
        status: ruleStatus(billedQuantity, actualQuantity),
        evidence: {
          psaMatch: match,
          vendorFilters: filters,
          matchedRowIds: evidence.matchedIds
        }
      });
    }
  }

  for (const item of items as PsaItem[]) {
    if (matchedPsaItemIds.has(item.id)) continue;
    rows.push({
      siteId: item.siteId,
      siteName: item.siteId
        ? (siteNames.get(item.siteId) ?? item.customerName ?? 'Unknown site')
        : 'Unmapped',
      psaItemId: item.id,
      psaItemName: item.itemName,
      ruleId: null,
      ruleName: null,
      vendorProvider: null,
      vendorFacet: null,
      vendorFacetLabel: null,
      billedQuantity: item.quantity,
      actualQuantity: 0,
      diffQuantity: -item.quantity,
      unitPrice: numberValue(item.unitPrice),
      monthlyDelta: 0,
      status: 'missing_rule',
      evidence: {}
    });
  }

  return { rows, summary: summarizeRows(rows) };
}

type ReportSummary = {
  totalRows: number;
  underbilledRows: number;
  overbilledRows: number;
  missingRuleRows: number;
  underbilledMrr: number;
  overbilledMrr: number;
  netMrrDelta: number;
};

function summarizeRows(rows: ReconciliationRow[]): ReportSummary {
  return rows.reduce<ReportSummary>(
    (summary, row) => {
      summary.totalRows += 1;
      if (row.status === 'underbilled') {
        summary.underbilledRows += 1;
        summary.underbilledMrr += Math.max(row.monthlyDelta, 0);
      }
      if (row.status === 'overbilled') {
        summary.overbilledRows += 1;
        summary.overbilledMrr += Math.abs(Math.min(row.monthlyDelta, 0));
      }
      if (row.status === 'missing_rule') summary.missingRuleRows += 1;
      summary.netMrrDelta += row.monthlyDelta;
      return summary;
    },
    {
      totalRows: 0,
      underbilledRows: 0,
      overbilledRows: 0,
      missingRuleRows: 0,
      underbilledMrr: 0,
      overbilledMrr: 0,
      netMrrDelta: 0
    }
  );
}

async function previewRule(
  db: any,
  input: z.infer<typeof upsertRuleSchema>
): Promise<{
  matchedItem: PsaItem | null;
  billedQuantity: number;
  actualQuantity: number;
  diffQuantity: number;
  unitPrice: number;
  monthlyDelta: number;
  matchedRowIds: string[];
  facetLabel: string | null;
}> {
  const facetConfig = getBillingFacet(input.vendorFacet) as BillingFacetConfig | null;
  const allItems = await db.select().from(billingPsaItems);
  const matchedItem =
    (allItems as PsaItem[]).find((psaItem) => {
      if (input.siteId && psaItem.siteId !== input.siteId) return false;
      return matchesPsaItem(psaItem, input.psaItemMatch);
    }) ?? null;

  if (!isSupportedFacet(input.vendorFacet)) {
    return {
      matchedItem,
      billedQuantity: matchedItem?.quantity ?? 0,
      actualQuantity: 0,
      diffQuantity: -(matchedItem?.quantity ?? 0),
      unitPrice: numberValue(matchedItem?.unitPrice ?? 0),
      monthlyDelta: 0,
      matchedRowIds: [],
      facetLabel: facetConfig?.label ?? null
    };
  }

  const siteId = matchedItem?.siteId ?? input.siteId ?? null;
  const linkRows = await db
    .select({ id: integrationLinks.id, siteId: integrationLinks.siteId })
    .from(integrationLinks);
  const linkSiteMap = new Map<string, string | null>(
    linkRows.map((row: { id: string; siteId: string | null }) => [row.id, row.siteId])
  );
  const index = await loadFacetIndex(db, input.vendorFacet, linkSiteMap);
  const evidence = countMatches(index, siteId, input.vendorFilters);

  const billedQuantity = matchedItem?.quantity ?? 0;
  const actualQuantity = evidence.count;
  const unitPrice = numberValue(matchedItem?.unitPrice ?? 0);

  return {
    matchedItem,
    billedQuantity,
    actualQuantity,
    diffQuantity: actualQuantity - billedQuantity,
    unitPrice,
    monthlyDelta: (actualQuantity - billedQuantity) * unitPrice,
    matchedRowIds: evidence.matchedIds,
    facetLabel: facetConfig?.label ?? null
  };
}

// Unused inArray import guard for future filter batching
void inArray;
void and;

export const billingRouter = t.router({
  psaItems: authProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(billingPsaItems).where(isNull(billingPsaItems.deletedAt));
  }),

  rules: authProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(billingReconciliationRules)
      .orderBy(billingReconciliationRules.name);
  }),

  facets: authProcedure.query(async () => {
    return listBillingFacets().map((facet) => ({
      facet: facet.facet,
      providerId: facet.providerId,
      label: facet.label,
      filterColumns: facet.filterColumns,
      defaultFilters: facet.defaultFilters ?? []
    }));
  }),

  upsertRule: authProcedure.input(upsertRuleSchema).mutation(async ({ ctx, input }) => {
    const values = {
      name: input.name,
      enabled: input.enabled,
      siteId: input.siteId ?? null,
      psaItemMatch: input.psaItemMatch,
      vendorProvider: input.vendorProvider,
      vendorFacet: input.vendorFacet,
      vendorFilters: input.vendorFilters,
      countMode: input.countMode,
      updatedAt: new Date().toISOString()
    };

    const [row] = input.id
      ? await ctx.db
          .update(billingReconciliationRules)
          .set(values)
          .where(eq(billingReconciliationRules.id, input.id))
          .returning()
      : await ctx.db.insert(billingReconciliationRules).values(values).returning();

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return row;
  }),

  deleteRule: authProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .delete(billingReconciliationRules)
      .where(eq(billingReconciliationRules.id, input.id))
      .returning();
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return row;
  }),

  previewRule: authProcedure.input(upsertRuleSchema).query(async ({ ctx, input }) => {
    return previewRule(ctx.db, input);
  }),

  report: authProcedure.query(async ({ ctx }) => {
    return buildReport(ctx.db);
  }),

  filterOptions: authProcedure.query(async ({ ctx }) => {
    const [siteRows, groupRows, memberRows] = await Promise.all([
      ctx.db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .orderBy(sites.name)
        .catch(() => [] as { id: string; name: string }[]),
      ctx.db
        .select({ id: siteGroups.id, name: siteGroups.name })
        .from(siteGroups)
        .orderBy(siteGroups.name)
        .catch(() => [] as { id: string; name: string }[]),
      ctx.db
        .select({ siteGroupId: siteGroupMembers.siteGroupId, siteId: siteGroupMembers.siteId })
        .from(siteGroupMembers)
        .catch(() => [] as { siteGroupId: string; siteId: string }[])
    ]);

    const siteIdsByGroup = new Map<string, string[]>();
    for (const row of memberRows) {
      const list = siteIdsByGroup.get(row.siteGroupId) ?? [];
      list.push(row.siteId);
      siteIdsByGroup.set(row.siteGroupId, list);
    }

    return {
      sites: siteRows,
      siteGroups: groupRows.map((group) => ({
        ...group,
        siteIds: siteIdsByGroup.get(group.id) ?? []
      }))
    };
  })
});
