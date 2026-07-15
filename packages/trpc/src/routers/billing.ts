import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import {
  billingPsaItems,
  billingReconciliationRules,
  siteGroupMembers,
  siteGroups,
  sites,
  sophosEndpoints
} from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';

const psaItemMatchSchema = z.object({
  field: z.enum(['itemName', 'externalId']).default('itemName'),
  operator: z.enum(['contains', 'eq']).default('contains'),
  value: z.string().min(1)
});

const vendorFilterSchema = z.object({
  column: z.enum(['type', 'hasMdr', 'online', 'deletedAt']),
  operator: z.enum(['eq', 'neq', 'is_null', 'is_not_null']),
  value: z.union([z.string(), z.boolean()]).optional()
});

const upsertRuleSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  siteId: z.uuid().nullable().optional(),
  psaItemMatch: psaItemMatchSchema,
  vendorProvider: z.literal('sophos-partner').default('sophos-partner'),
  vendorFacet: z.literal('sophos_endpoints').default('sophos_endpoints'),
  vendorFilters: z.array(vendorFilterSchema).default([]),
  countMode: z.literal('count_rows').default('count_rows')
});

type PsaItem = typeof billingPsaItems.$inferSelect;
type Rule = typeof billingReconciliationRules.$inferSelect;
type SophosEndpoint = typeof sophosEndpoints.$inferSelect;
type PsaItemMatch = z.infer<typeof psaItemMatchSchema>;
type VendorFilter = z.infer<typeof vendorFilterSchema>;

type ReconciliationRow = {
  siteId: string | null;
  siteName: string;
  psaItemId: string | null;
  psaItemName: string;
  ruleId: string | null;
  ruleName: string | null;
  billedQuantity: number;
  actualQuantity: number;
  diffQuantity: number;
  unitPrice: number;
  monthlyDelta: number;
  status: 'matched' | 'underbilled' | 'overbilled' | 'missing_rule' | 'missing_psa_line';
  evidence: {
    psaMatch?: PsaItemMatch;
    vendorFilters?: VendorFilter[];
    matchedEndpointIds?: string[];
  };
};

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

function matchesVendorFilter(endpoint: SophosEndpoint, filter: VendorFilter): boolean {
  const actual = endpoint[filter.column as keyof SophosEndpoint];
  switch (filter.operator) {
    case 'eq':
      return String(actual ?? '') === String(filter.value ?? '');
    case 'neq':
      return String(actual ?? '') !== String(filter.value ?? '');
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

async function sophosEndpointEvidence(
  db: any,
  siteId: string | null,
  filters: VendorFilter[]
): Promise<{ actualQuantity: number; matchedEndpointIds: string[] }> {
  if (!siteId) return { actualQuantity: 0, matchedEndpointIds: [] };

  const rows = await db
    .select()
    .from(sophosEndpoints)
    .where(and(eq(sophosEndpoints.siteId, siteId), isNull(sophosEndpoints.deletedAt)));

  const matched = rows.filter((row: SophosEndpoint) =>
    filters.every((filter) => matchesVendorFilter(row, filter))
  );

  return {
    actualQuantity: matched.length,
    matchedEndpointIds: matched.map((row: SophosEndpoint) => row.id)
  };
}

async function buildReport(
  db: any
): Promise<{ rows: ReconciliationRow[]; summary: ReportSummary }> {
  const [items, rules, siteRows] = await Promise.all([
    db.select().from(billingPsaItems).where(isNull(billingPsaItems.deletedAt)),
    db
      .select()
      .from(billingReconciliationRules)
      .where(eq(billingReconciliationRules.enabled, true)),
    db.select().from(sites)
  ]);

  const siteNames = new Map<string, string>(
    siteRows.map((site: typeof sites.$inferSelect) => [site.id, site.name])
  );
  const rows: ReconciliationRow[] = [];
  const matchedPsaItemIds = new Set<string>();

  for (const rule of rules as Rule[]) {
    const match = parsePsaItemMatch(rule.psaItemMatch);
    if (!match) continue;

    const filters = parseVendorFilters(rule.vendorFilters);
    const candidateItems = (items as PsaItem[]).filter((item) => {
      if (rule.siteId && item.siteId !== rule.siteId) return false;
      return matchesPsaItem(item, match);
    });

    if (!candidateItems.length) {
      const siteId = rule.siteId ?? null;
      const evidence = await sophosEndpointEvidence(db, siteId, filters);
      rows.push({
        siteId,
        siteName: siteId ? (siteNames.get(siteId) ?? 'Unknown site') : 'All sites',
        psaItemId: null,
        psaItemName: 'No matching PSA item',
        ruleId: rule.id,
        ruleName: rule.name,
        billedQuantity: 0,
        actualQuantity: evidence.actualQuantity,
        diffQuantity: evidence.actualQuantity,
        unitPrice: 0,
        monthlyDelta: 0,
        status: 'missing_psa_line',
        evidence: {
          psaMatch: match,
          vendorFilters: filters,
          matchedEndpointIds: evidence.matchedEndpointIds
        }
      });
      continue;
    }

    for (const item of candidateItems) {
      matchedPsaItemIds.add(item.id);
      const siteId = item.siteId ?? rule.siteId ?? null;
      const evidence = await sophosEndpointEvidence(db, siteId, filters);
      const billedQuantity = item.quantity;
      const actualQuantity = evidence.actualQuantity;
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
        billedQuantity,
        actualQuantity,
        diffQuantity,
        unitPrice,
        monthlyDelta: diffQuantity * unitPrice,
        status: ruleStatus(billedQuantity, actualQuantity),
        evidence: {
          psaMatch: match,
          vendorFilters: filters,
          matchedEndpointIds: evidence.matchedEndpointIds
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
    const allItems = await ctx.db
      .select()
      .from(billingPsaItems)
      .where(isNull(billingPsaItems.deletedAt));
    const matchedItem =
      (allItems as PsaItem[]).find((psaItem) => {
        if (input.siteId && psaItem.siteId !== input.siteId) return false;
        return matchesPsaItem(psaItem, input.psaItemMatch);
      }) ?? null;

    const evidence = await sophosEndpointEvidence(
      ctx.db,
      matchedItem?.siteId ?? input.siteId ?? null,
      input.vendorFilters
    );
    const billedQuantity = matchedItem?.quantity ?? 0;
    const actualQuantity = evidence.actualQuantity;
    const unitPrice = numberValue(matchedItem?.unitPrice ?? 0);

    return {
      matchedItem,
      billedQuantity,
      actualQuantity,
      diffQuantity: actualQuantity - billedQuantity,
      unitPrice,
      monthlyDelta: (actualQuantity - billedQuantity) * unitPrice,
      matchedEndpointIds: evidence.matchedEndpointIds
    };
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
