import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, count, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import {
  billingPsaItems,
  billingReconciliationRuleScopes,
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
import {
  BILLING_FACETS,
  getBillingFacetLabel,
  getBillingFilterColumns,
  listBillingFacets,
  ProviderFacet
} from '@mspbyte/shared';
import type { BillingFilterColumn } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import { tableDataInputSchema } from './table-data.js';

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

const scopeInputSchema = z
  .object({
    mode: z.enum(['include', 'exclude']),
    targetType: z.enum(['site', 'site_group', 'all']),
    siteId: z.uuid().nullable().optional(),
    siteGroupId: z.uuid().nullable().optional()
  })
  .refine(
    (s) =>
      (s.targetType === 'site' && !!s.siteId) ||
      (s.targetType === 'site_group' && !!s.siteGroupId) ||
      s.targetType === 'all',
    { message: 'Scope target id must match target type' }
  );

const upsertRuleSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  scopes: z.array(scopeInputSchema).default([]),
  psaItemMatch: psaItemMatchSchema,
  vendorProvider: z.enum(supportedProviders),
  vendorFacet: z.enum(supportedFacets),
  vendorFilters: z.array(vendorFilterSchema).default([]),
  countMode: z.literal('count_rows').default('count_rows')
});

const reportInputSchema = tableDataInputSchema.extend({
  scopeSiteId: z.string().optional(),
  scopeSiteGroupId: z.string().optional()
});

type PsaItem = typeof billingPsaItems.$inferSelect;
type Rule = typeof billingReconciliationRules.$inferSelect;
type RuleScope = typeof billingReconciliationRuleScopes.$inferSelect;
type PsaItemMatch = z.infer<typeof psaItemMatchSchema>;
type VendorFilter = z.infer<typeof vendorFilterSchema>;
type ScopeInput = z.infer<typeof scopeInputSchema>;
type ReportInput = z.infer<typeof reportInputSchema>;

type RuleWithScopes = Rule & { scopes: RuleScope[] };

/**
 * Resolve a rule's include/exclude scope rows to a concrete Set of site ids.
 * `null` means "unscoped — matches every site" (used when a rule has no
 * scope rows at all as a safety net).
 */
function resolveEffectiveSites(
  scopes: Array<{
    mode: 'include' | 'exclude';
    targetType: 'site' | 'site_group' | 'all';
    siteId?: string | null;
    siteGroupId?: string | null;
  }>,
  allSiteIds: Set<string>,
  siteIdsByGroup: Map<string, string[]>
): Set<string> | null {
  if (!scopes.length) return null;

  const included = new Set<string>();
  const excluded = new Set<string>();
  let sawAnyInclude = false;

  for (const scope of scopes) {
    const target =
      scope.mode === 'include' ? included : excluded;
    if (scope.mode === 'include') sawAnyInclude = true;
    if (scope.targetType === 'all') {
      for (const id of allSiteIds) target.add(id);
    } else if (scope.targetType === 'site' && scope.siteId) {
      target.add(scope.siteId);
    } else if (scope.targetType === 'site_group' && scope.siteGroupId) {
      const members = siteIdsByGroup.get(scope.siteGroupId) ?? [];
      for (const id of members) target.add(id);
    }
  }

  if (!sawAnyInclude) return new Set();

  for (const id of excluded) included.delete(id);
  return included;
}

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

function ruleStatus(billedQuantity: number, actualQuantity: number): ReconciliationRow['status'] {
  if (actualQuantity > billedQuantity) return 'underbilled';
  if (actualQuantity < billedQuantity) return 'overbilled';
  return 'matched';
}

function coerceFilterValue(kind: BillingFilterColumn['kind'], value: string | boolean | undefined) {
  if (value === undefined || value === null) return null;
  if (kind === 'boolean') return value === true || value === 'true';
  if (kind === 'number') return Number(value);
  return typeof value === 'boolean' ? String(value) : value;
}

function buildVendorWhereClause(
  table: Record<string, unknown>,
  filters: VendorFilter[],
  filterColumns: BillingFilterColumn[]
) {
  const kindByColumn = new Map(filterColumns.map((c) => [c.column, c.kind] as const));
  const clauses = filters
    .map((filter) => {
      const kind = kindByColumn.get(filter.column);
      if (!kind) return null;
      const col = table[filter.column] as never;
      if (!col) return null;
      switch (filter.operator) {
        case 'eq':
          return eq(col, coerceFilterValue(kind, filter.value));
        case 'neq':
          return ne(col, coerceFilterValue(kind, filter.value));
        case 'is_null':
          return isNull(col);
        case 'is_not_null':
          return isNotNull(col);
      }
    })
    .filter((c): c is NonNullable<typeof c> => c != null);
  return clauses.length ? and(...clauses) : undefined;
}

/**
 * Aggregate one row per effective site (COALESCE(vendor.siteId, link.siteId))
 * for a rule's filter set. Returns O(sites) rows instead of hydrating the
 * full vendor table.
 */
async function loadFacetCountsBySite(
  db: any,
  facet: FacetKey,
  filters: VendorFilter[]
): Promise<Map<string, number>> {
  const table = FACET_TABLES[facet] as unknown as Record<string, unknown>;
  const filterColumns = getBillingFilterColumns(facet);
  const whereClause = buildVendorWhereClause(table, filters, filterColumns);
  const siteCol = table.siteId as never;
  const linkCol = table.linkId as never;
  const effectiveSite = sql<string | null>`coalesce(${siteCol}, ${integrationLinks.siteId})`;

  const query = db
    .select({ siteId: effectiveSite, count: count() })
    .from(FACET_TABLES[facet])
    .leftJoin(integrationLinks, eq(linkCol, integrationLinks.id));

  const rows: { siteId: string | null; count: number | string }[] = whereClause
    ? await query.where(whereClause).groupBy(effectiveSite)
    : await query.groupBy(effectiveSite);

  const map = new Map<string, number>();
  for (const row of rows) map.set(row.siteId ?? '', Number(row.count));
  return map;
}

async function buildReport(db: any, input: ReportInput): Promise<BillingReportOutput> {
  const [items, rules, ruleScopes, siteRows, allGroupMemberRows, groupMemberRows] =
    await Promise.all([
      db.select().from(billingPsaItems).where(isNull(billingPsaItems.deletedAt)),
      db
        .select()
        .from(billingReconciliationRules)
        .where(eq(billingReconciliationRules.enabled, true)),
      db.select().from(billingReconciliationRuleScopes),
      db.select().from(sites),
      db.select().from(siteGroupMembers),
      input.scopeSiteGroupId
        ? db
            .select({ siteId: siteGroupMembers.siteId })
            .from(siteGroupMembers)
            .where(eq(siteGroupMembers.siteGroupId, input.scopeSiteGroupId))
        : Promise.resolve([] as { siteId: string }[])
    ]);

  const siteNames = new Map<string, string>(
    (siteRows as (typeof sites.$inferSelect)[]).map((site) => [site.id, site.name])
  );
  const allSiteIds = new Set<string>(siteNames.keys());
  const siteIdsByGroup = new Map<string, string[]>();
  for (const row of allGroupMemberRows as { siteGroupId: string; siteId: string }[]) {
    const list = siteIdsByGroup.get(row.siteGroupId) ?? [];
    list.push(row.siteId);
    siteIdsByGroup.set(row.siteGroupId, list);
  }

  const scopesByRule = new Map<string, RuleScope[]>();
  for (const scope of ruleScopes as RuleScope[]) {
    const list = scopesByRule.get(scope.ruleId) ?? [];
    list.push(scope);
    scopesByRule.set(scope.ruleId, list);
  }

  const ruleList = rules as Rule[];
  const psaItems = items as PsaItem[];

  // One SQL count-per-site query per enabled rule (fixes the vendor-table
  // hydration). Batched via Promise.all.
  const ruleCounts = new Map<string, Map<string, number>>();
  await Promise.all(
    ruleList.map(async (rule) => {
      if (!isSupportedFacet(rule.vendorFacet)) return;
      const filters = parseVendorFilters(rule.vendorFilters);
      ruleCounts.set(rule.id, await loadFacetCountsBySite(db, rule.vendorFacet, filters));
    })
  );

  const rows: ReconciliationRow[] = [];
  const matchedPsaItemIds = new Set<string>();

  for (const rule of ruleList) {
    const match = parsePsaItemMatch(rule.psaItemMatch);
    if (!match) continue;
    if (!isSupportedFacet(rule.vendorFacet)) continue;

    const facetLabel = getBillingFacetLabel(rule.vendorFacet);
    const filters = parseVendorFilters(rule.vendorFilters);
    const countsBySite = ruleCounts.get(rule.id) ?? new Map<string, number>();
    const effective = resolveEffectiveSites(
      scopesByRule.get(rule.id) ?? [],
      allSiteIds,
      siteIdsByGroup
    );

    // Every site currently in scope for this rule — we emit one row per
    // effective site, even when no PSA line matches (that becomes missing_psa_line).
    const scopedSiteIds = effective ?? allSiteIds;
    const inScope = (siteId: string | null) =>
      effective === null ? true : siteId != null && effective.has(siteId);

    // Group PSA line matches by their site to attribute to each in-scope site.
    const itemsBySite = new Map<string | null, PsaItem[]>();
    for (const item of psaItems) {
      if (!matchesPsaItem(item, match)) continue;
      if (!inScope(item.siteId)) continue;
      const key = item.siteId ?? null;
      const list = itemsBySite.get(key) ?? [];
      list.push(item);
      itemsBySite.set(key, list);
    }

    // Unmapped PSA rows (siteId null) — only surface when scope allows global.
    const unmappedItems = effective === null ? (itemsBySite.get(null) ?? []) : [];
    for (const item of unmappedItems) {
      matchedPsaItemIds.add(item.id);
      const actualQuantity = countsBySite.get('') ?? 0;
      const billedQuantity = item.quantity;
      const diffQuantity = actualQuantity - billedQuantity;
      const unitPrice = numberValue(item.unitPrice);
      rows.push({
        siteId: null,
        siteName: item.customerName ?? 'Unmapped',
        psaItemId: item.id,
        psaItemName: item.itemName,
        ruleId: rule.id,
        ruleName: rule.name,
        vendorProvider: rule.vendorProvider,
        vendorFacet: rule.vendorFacet,
        vendorFacetLabel: facetLabel,
        billedQuantity,
        actualQuantity,
        diffQuantity,
        unitPrice,
        monthlyDelta: diffQuantity * unitPrice,
        status: ruleStatus(billedQuantity, actualQuantity),
        evidence: { psaMatch: match, vendorFilters: filters }
      });
    }

    for (const siteId of scopedSiteIds) {
      const siteItems = itemsBySite.get(siteId) ?? [];
      const actualQuantity = countsBySite.get(siteId) ?? 0;

      if (!siteItems.length) {
        // Only emit missing_psa_line rows for sites that actually have vendor
        // activity — a rule scoped to 40 sites where only 12 have Sophos
        // installed shouldn't produce 28 noise rows.
        if (actualQuantity === 0) continue;
        rows.push({
          siteId,
          siteName: siteNames.get(siteId) ?? 'Unknown site',
          psaItemId: null,
          psaItemName: 'No matching PSA item',
          ruleId: rule.id,
          ruleName: rule.name,
          vendorProvider: rule.vendorProvider,
          vendorFacet: rule.vendorFacet,
          vendorFacetLabel: facetLabel,
          billedQuantity: 0,
          actualQuantity,
          diffQuantity: actualQuantity,
          unitPrice: 0,
          monthlyDelta: 0,
          status: 'missing_psa_line',
          evidence: { psaMatch: match, vendorFilters: filters }
        });
        continue;
      }

      for (const item of siteItems) {
        matchedPsaItemIds.add(item.id);
        const billedQuantity = item.quantity;
        const diffQuantity = actualQuantity - billedQuantity;
        const unitPrice = numberValue(item.unitPrice);

        rows.push({
          siteId,
          siteName: siteNames.get(siteId) ?? item.customerName ?? 'Unknown site',
          psaItemId: item.id,
          psaItemName: item.itemName,
          ruleId: rule.id,
          ruleName: rule.name,
          vendorProvider: rule.vendorProvider,
          vendorFacet: rule.vendorFacet,
          vendorFacetLabel: facetLabel,
          billedQuantity,
          actualQuantity,
          diffQuantity,
          unitPrice,
          monthlyDelta: diffQuantity * unitPrice,
          status: ruleStatus(billedQuantity, actualQuantity),
          evidence: { psaMatch: match, vendorFilters: filters }
        });
      }
    }
  }

  for (const item of psaItems) {
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

  // MetricCards + Rules tab show unfiltered, tenant-wide numbers — freeze
  // them here before scope/user filters narrow the set.
  const summary = summarizeRows(rows);
  const ruleAggregates: Record<string, RuleAggregate> = {};
  for (const row of rows) {
    if (!row.ruleId) continue;
    const agg = (ruleAggregates[row.ruleId] ??= { matchedRows: 0, mrrDelta: 0 });
    if (row.status !== 'missing_rule') agg.matchedRows += 1;
    agg.mrrDelta += row.monthlyDelta;
  }

  const allowedSiteIds = input.scopeSiteGroupId
    ? new Set((groupMemberRows as { siteId: string }[]).map((r) => r.siteId))
    : null;

  const scoped = rows.filter((row) => {
    if (input.scopeSiteId === 'unmapped') {
      if (row.siteId) return false;
    } else if (input.scopeSiteId) {
      if (row.siteId !== input.scopeSiteId) return false;
    }
    if (allowedSiteIds && (!row.siteId || !allowedSiteIds.has(row.siteId))) return false;
    return true;
  });

  const searched = applyGlobalSearch(scoped, input.globalSearch, input.globalSearchColumns);
  const filtered = applyFilters(searched, input.filters ?? []);
  const filteredSummary = summarizeFiltered(filtered);
  const sorted = applySort(filtered, input.sortColumn, input.sortDirection);
  const total = sorted.length;
  const start = (input.page - 1) * input.pageSize;
  const paged = sorted.slice(start, start + input.pageSize);

  return {
    rows: paged,
    total,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.ceil(total / input.pageSize),
    summary,
    filteredSummary,
    ruleAggregates
  };
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

type FilteredSummary = {
  billed: number;
  actual: number;
  diff: number;
  mrr: number;
  underCount: number;
  overCount: number;
};

type RuleAggregate = { matchedRows: number; mrrDelta: number };

type BillingReportOutput = {
  rows: ReconciliationRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: ReportSummary;
  filteredSummary: FilteredSummary;
  ruleAggregates: Record<string, RuleAggregate>;
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

function summarizeFiltered(rows: ReconciliationRow[]): FilteredSummary {
  const acc: FilteredSummary = {
    billed: 0,
    actual: 0,
    diff: 0,
    mrr: 0,
    underCount: 0,
    overCount: 0
  };
  for (const row of rows) {
    // Skip PSA lines with no matching rule — their diff/MRR is always
    // negative-by-construction (billed vs zero actual) and drowns out the
    // signal from rows that actually reconcile.
    if (row.status === 'missing_rule') continue;
    acc.billed += row.billedQuantity;
    acc.actual += row.actualQuantity;
    acc.diff += row.diffQuantity;
    acc.mrr += row.monthlyDelta;
    if (row.status === 'underbilled') acc.underCount += 1;
    if (row.status === 'overbilled') acc.overCount += 1;
  }
  return acc;
}

function readRowField(row: ReconciliationRow, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

function applyGlobalSearch(
  rows: ReconciliationRow[],
  search: string | undefined,
  columns: string[] | undefined
): ReconciliationRow[] {
  const q = (search ?? '').trim().toLowerCase();
  if (!q || !columns?.length) return rows;
  return rows.filter((row) =>
    columns.some((col) => String(readRowField(row, col) ?? '').toLowerCase().includes(q))
  );
}

function applyFilters(
  rows: ReconciliationRow[],
  filters: { column: string; operator: string; value?: string | number | boolean }[]
): ReconciliationRow[] {
  if (!filters.length) return rows;
  return rows.filter((row) =>
    filters.every((filter) => {
      const actual = readRowField(row, filter.column);
      const expected = filter.value;
      switch (filter.operator) {
        case 'eq':
          return String(actual ?? '') === String(expected ?? '');
        case 'neq':
          return String(actual ?? '') !== String(expected ?? '');
        case 'contains':
          return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
        case 'gt':
          return Number(actual) > Number(expected);
        case 'gte':
          return Number(actual) >= Number(expected);
        case 'lt':
          return Number(actual) < Number(expected);
        case 'lte':
          return Number(actual) <= Number(expected);
        case 'is_null':
          return actual == null || actual === '';
        case 'is_not_null':
          return actual != null && actual !== '';
        default:
          return true;
      }
    })
  );
}

function applySort(
  rows: ReconciliationRow[],
  sortColumn: string | undefined,
  sortDirection: 'asc' | 'desc' | undefined
): ReconciliationRow[] {
  if (!sortColumn) return rows;
  const dir = sortDirection === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = readRowField(a, sortColumn);
    const bv = readRowField(b, sortColumn);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * dir;
  });
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
  facetLabel: string | null;
  effectiveSiteCount: number | null;
  matchedItemCount: number;
}> {
  const facetLabel = isSupportedFacet(input.vendorFacet)
    ? getBillingFacetLabel(input.vendorFacet)
    : null;

  const [allItems, siteRows, memberRows] = await Promise.all([
    db.select().from(billingPsaItems).where(isNull(billingPsaItems.deletedAt)),
    db.select({ id: sites.id }).from(sites),
    db.select().from(siteGroupMembers)
  ]);

  const allSiteIds = new Set<string>((siteRows as { id: string }[]).map((r) => r.id));
  const siteIdsByGroup = new Map<string, string[]>();
  for (const row of memberRows as { siteGroupId: string; siteId: string }[]) {
    const list = siteIdsByGroup.get(row.siteGroupId) ?? [];
    list.push(row.siteId);
    siteIdsByGroup.set(row.siteGroupId, list);
  }
  const effective = resolveEffectiveSites(input.scopes, allSiteIds, siteIdsByGroup);
  const inScope = (siteId: string | null) =>
    effective === null ? true : siteId != null && effective.has(siteId);

  const candidateItems = (allItems as PsaItem[]).filter((psaItem) => {
    if (!matchesPsaItem(psaItem, input.psaItemMatch)) return false;
    return inScope(psaItem.siteId);
  });
  const matchedItem = candidateItems[0] ?? null;

  if (!isSupportedFacet(input.vendorFacet)) {
    return {
      matchedItem,
      billedQuantity: matchedItem?.quantity ?? 0,
      actualQuantity: 0,
      diffQuantity: -(matchedItem?.quantity ?? 0),
      unitPrice: numberValue(matchedItem?.unitPrice ?? 0),
      monthlyDelta: 0,
      facetLabel,
      effectiveSiteCount: effective === null ? null : effective.size,
      matchedItemCount: candidateItems.length
    };
  }

  const siteId = matchedItem?.siteId ?? null;
  const countsBySite = await loadFacetCountsBySite(db, input.vendorFacet, input.vendorFilters);
  const actualQuantity = countsBySite.get(siteId ?? '') ?? 0;

  const billedQuantity = matchedItem?.quantity ?? 0;
  const unitPrice = numberValue(matchedItem?.unitPrice ?? 0);

  return {
    matchedItem,
    billedQuantity,
    actualQuantity,
    diffQuantity: actualQuantity - billedQuantity,
    unitPrice,
    monthlyDelta: (actualQuantity - billedQuantity) * unitPrice,
    facetLabel,
    effectiveSiteCount: effective === null ? null : effective.size,
    matchedItemCount: candidateItems.length
  };
}

void inArray;

export const billingRouter = t.router({
  psaItems: authProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(billingPsaItems).where(isNull(billingPsaItems.deletedAt));
  }),

  rules: authProcedure.query(async ({ ctx }) => {
    const [ruleRows, scopeRows] = await Promise.all([
      ctx.db
        .select()
        .from(billingReconciliationRules)
        .orderBy(billingReconciliationRules.name),
      ctx.db.select().from(billingReconciliationRuleScopes)
    ]);
    const scopesByRule = new Map<string, RuleScope[]>();
    for (const scope of scopeRows as RuleScope[]) {
      const list = scopesByRule.get(scope.ruleId) ?? [];
      list.push(scope);
      scopesByRule.set(scope.ruleId, list);
    }
    return (ruleRows as Rule[]).map<RuleWithScopes>((rule) => ({
      ...rule,
      scopes: scopesByRule.get(rule.id) ?? []
    }));
  }),

  facets: authProcedure.query(async () => {
    return listBillingFacets().map((facet) => ({
      facet: facet.facet,
      providerId: facet.providerId,
      label: getBillingFacetLabel(facet.facet),
      filterColumns: getBillingFilterColumns(facet.facet),
      defaultFilters: facet.defaultFilters ?? []
    }));
  }),

  upsertRule: authProcedure.input(upsertRuleSchema).mutation(async ({ ctx, input }) => {
    const values = {
      name: input.name,
      enabled: input.enabled,
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

    if (input.id) {
      await ctx.db
        .delete(billingReconciliationRuleScopes)
        .where(eq(billingReconciliationRuleScopes.ruleId, input.id));
    }
    if (input.scopes.length) {
      await ctx.db.insert(billingReconciliationRuleScopes).values(
        input.scopes.map((scope: ScopeInput) => ({
          ruleId: row.id,
          mode: scope.mode,
          targetType: scope.targetType,
          siteId: scope.targetType === 'site' ? (scope.siteId ?? null) : null,
          siteGroupId:
            scope.targetType === 'site_group' ? (scope.siteGroupId ?? null) : null
        }))
      );
    }

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

  report: authProcedure.input(reportInputSchema).query(async ({ ctx, input }) => {
    return buildReport(ctx.db, input);
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
