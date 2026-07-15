<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import * as Card from '$lib/components/ui/card';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import {
    DataTable,
    type DataTableColumn,
    type FilterOperator,
    type PaginationInput,
    type TableFilter,
    type TableView,
  } from '$lib/components/data-table';

  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Filter from '@lucide/svelte/icons/filter';
  import ArrowDownNarrowWide from '@lucide/svelte/icons/arrow-down-narrow-wide';
  import ArrowUpNarrowWide from '@lucide/svelte/icons/arrow-up-narrow-wide';
  import TrendingDown from '@lucide/svelte/icons/trending-down';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import FileWarning from '@lucide/svelte/icons/file-warning';
  import Sigma from '@lucide/svelte/icons/sigma';

  import RuleEditorSheet from './_components/rule-editor-sheet.svelte';
  import RuleCard from './_components/rule-card.svelte';
  import { formatMoney } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const reportQuery = createQuery(() => ({
    queryKey: ['billing.report'],
    queryFn: () => trpc.billing.report.query(),
  }));

  const rulesQuery = createQuery(() => ({
    queryKey: ['billing.rules'],
    queryFn: () => trpc.billing.rules.query(),
  }));

  const filterOptionsQuery = createQuery(() => ({
    queryKey: ['billing.filterOptions'],
    queryFn: () => trpc.billing.filterOptions.query(),
  }));

  const deleteRule = createMutation(() => ({
    mutationFn: (id: string) => trpc.billing.deleteRule.mutate({ id }),
    onSuccess: () => {
      toast.success('Rule deleted');
      qc.invalidateQueries({ queryKey: ['billing.rules'] });
      qc.invalidateQueries({ queryKey: ['billing.report'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  type ReportRow = NonNullable<typeof reportQuery.data>['rows'][number];
  type EnrichedRow = ReportRow & { id: string };
  type Rule = NonNullable<typeof rulesQuery.data>[number];

  let sheetOpen = $state(false);
  let editingRule = $state<any>(null);
  let activeTab = $state('reconciliation');

  // External (compound) filters not managed by DataTable itself
  let siteFilter = $state<string>('all');
  let siteGroupFilter = $state<string>('all');

  // Rules tab state
  type RuleSortKey = 'name' | 'matched' | 'enabled' | 'delta';
  let ruleSearch = $state('');
  let ruleSortKey = $state<RuleSortKey>('matched');
  let ruleSortDir = $state<'asc' | 'desc'>('desc');
  let ruleEnabledFilter = $state<'all' | 'enabled' | 'disabled'>('all');

  // Totals tracked from DataTable's fetchData
  let filteredRowsState = $state<EnrichedRow[]>([]);
  let refreshKey = $state(0);

  const sites = $derived(filterOptionsQuery.data?.sites ?? []);
  const siteGroups = $derived(filterOptionsQuery.data?.siteGroups ?? []);
  const rules = $derived(rulesQuery.data ?? []);

  const siteNameById = $derived(new Map(sites.map((site) => [site.id, site.name])));
  const groupById = $derived(new Map(siteGroups.map((g) => [g.id, g])));

  const allowedSiteIds = $derived.by<Set<string> | null>(() => {
    if (siteGroupFilter === 'all') return null;
    const group = groupById.get(siteGroupFilter);
    if (!group) return new Set<string>();
    return new Set(group.siteIds);
  });

  const enrichedRows = $derived<EnrichedRow[]>(
    (reportQuery.data?.rows ?? []).map((row, idx) => ({
      ...row,
      id: row.psaItemId ?? `${row.ruleId ?? 'x'}-${row.siteId ?? 'unmapped'}-${idx}`,
    }))
  );

  const matchedRowsByRule = $derived.by(() => {
    const m = new Map<string, number>();
    for (const row of enrichedRows) {
      if (row.ruleId && row.status !== 'missing_rule') {
        m.set(row.ruleId, (m.get(row.ruleId) ?? 0) + 1);
      }
    }
    return m;
  });

  const mrrDeltaByRule = $derived.by(() => {
    const m = new Map<string, number>();
    for (const row of enrichedRows) {
      if (!row.ruleId) continue;
      m.set(row.ruleId, (m.get(row.ruleId) ?? 0) + row.monthlyDelta);
    }
    return m;
  });

  $effect(() => {
    siteFilter;
    siteGroupFilter;
    enrichedRows;
    untrack(() => {
      refreshKey = refreshKey + 1;
    });
  });

  function matchFilter(actual: unknown, op: FilterOperator, expected: unknown): boolean {
    switch (op) {
      case 'eq':
        return actual === expected;
      case 'neq':
        return actual !== expected;
      case 'contains':
        return String(actual ?? '')
          .toLowerCase()
          .includes(String(expected ?? '').toLowerCase());
      case 'lt':
        return Number(actual) < Number(expected);
      case 'lte':
        return Number(actual) <= Number(expected);
      case 'gt':
        return Number(actual) > Number(expected);
      case 'gte':
        return Number(actual) >= Number(expected);
      case 'is_null':
        return actual == null;
      case 'is_not_null':
        return actual != null;
    }
  }

  function applyExternalFilters(row: EnrichedRow): boolean {
    if (siteFilter !== 'all') {
      if (siteFilter === 'unmapped') {
        if (row.siteId) return false;
      } else if (row.siteId !== siteFilter) return false;
    }
    if (allowedSiteIds && (!row.siteId || !allowedSiteIds.has(row.siteId))) return false;
    return true;
  }

  function applyTableFilters(row: EnrichedRow, filters: TableFilter[]): boolean {
    for (const f of filters) {
      const value = (row as unknown as Record<string, unknown>)[f.field];
      if (!matchFilter(value, f.operator, f.value)) return false;
    }
    return true;
  }

  function applyGlobalSearch(row: EnrichedRow, search: string): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const hay =
      `${row.siteName} ${row.psaItemName} ${row.ruleName ?? ''} ${row.status}`.toLowerCase();
    return hay.includes(q);
  }

  async function fetchData(input: PaginationInput) {
    const filtered = enrichedRows.filter(
      (row) =>
        applyExternalFilters(row) &&
        applyGlobalSearch(row, input.globalSearch) &&
        applyTableFilters(row, input.filters)
    );

    if (input.sortField) {
      const dir = input.sortDir === 'desc' ? -1 : 1;
      const key = input.sortField;
      filtered.sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[key];
        const bv = (b as unknown as Record<string, unknown>)[key];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }

    filteredRowsState = filtered;

    const start = input.page * input.pageSize;
    const paged = filtered.slice(start, start + input.pageSize);
    return { rows: paged, total: filtered.length };
  }

  const filteredTotals = $derived.by(() => {
    let billed = 0;
    let actual = 0;
    let diff = 0;
    let mrr = 0;
    let underCount = 0;
    let overCount = 0;
    for (const row of filteredRowsState) {
      billed += row.billedQuantity;
      actual += row.actualQuantity;
      diff += row.diffQuantity;
      mrr += row.monthlyDelta;
      if (row.status === 'underbilled') underCount += 1;
      if (row.status === 'overbilled') overCount += 1;
    }
    return { billed, actual, diff, mrr, underCount, overCount };
  });

  function openNewRule() {
    editingRule = null;
    sheetOpen = true;
  }
  function openEditRule(rule: Rule) {
    editingRule = rule;
    sheetOpen = true;
  }

  function statusClass(status: ReportRow['status']) {
    switch (status) {
      case 'underbilled':
        return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
      case 'overbilled':
        return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30';
      case 'matched':
        return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
      case 'missing_rule':
        return 'bg-muted text-muted-foreground border-border';
      case 'missing_psa_line':
        return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30';
    }
  }

  function statusLabel(status: ReportRow['status']) {
    switch (status) {
      case 'missing_rule':
        return 'no rule';
      case 'missing_psa_line':
        return 'no PSA line';
      default:
        return status;
    }
  }

  const summary = $derived(reportQuery.data?.summary);

  const columns: DataTableColumn<EnrichedRow>[] = [
    {
      key: 'siteName',
      title: 'Site',
      sortable: true,
      searchable: true,
      width: '20%',
      filter: {
        type: 'text',
        operators: ['contains', 'eq'],
        placeholder: 'Filter site…',
      },
      cell: siteCell,
    },
    {
      key: 'psaItemName',
      title: 'PSA item',
      sortable: true,
      searchable: true,
      width: '22%',
      filter: {
        type: 'text',
        operators: ['contains', 'eq'],
        placeholder: 'Filter PSA item…',
      },
    },
    {
      key: 'ruleName',
      title: 'Rule',
      sortable: true,
      searchable: true,
      cell: ruleNameCell,
    },
    {
      key: 'billedQuantity',
      title: 'Billed',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      },
      cell: numberCell,
    },
    {
      key: 'actualQuantity',
      title: 'Actual',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      },
      cell: numberCell,
    },
    {
      key: 'diffQuantity',
      title: 'Δ Qty',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      },
      cell: diffCell,
    },
    {
      key: 'monthlyDelta',
      title: 'Δ MRR',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      },
      cell: mrrCell,
      exportValue: ({ value }) => Number(value) || 0,
    },
    {
      key: 'status',
      title: 'Status',
      sortable: true,
      width: '140px',
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: [
          { label: 'Underbilled', value: 'underbilled' },
          { label: 'Overbilled', value: 'overbilled' },
          { label: 'Matched', value: 'matched' },
          { label: 'Missing rule', value: 'missing_rule' },
          { label: 'Missing PSA line', value: 'missing_psa_line' },
        ],
      },
      cell: statusCell,
    },
  ];

  const views: TableView<EnrichedRow>[] = [
    {
      id: 'actionable',
      label: 'Actionable',
      description: 'Everything except matched rows and PSA lines without a rule',
      isDefault: true,
      filters: [
        { field: 'status', operator: 'neq', value: 'matched' },
        { field: 'status', operator: 'neq', value: 'missing_rule' },
      ],
      sort: { field: 'monthlyDelta', dir: 'desc' },
    },
    {
      id: 'underbilled',
      label: 'Underbilled',
      filters: [{ field: 'status', operator: 'eq', value: 'underbilled' }],
      sort: { field: 'monthlyDelta', dir: 'desc' },
    },
    {
      id: 'overbilled',
      label: 'Overbilled',
      filters: [{ field: 'status', operator: 'eq', value: 'overbilled' }],
      sort: { field: 'monthlyDelta', dir: 'asc' },
    },
    {
      id: 'missing-rule',
      label: 'Missing rule',
      description: 'PSA lines without a matching reconciliation rule',
      filters: [{ field: 'status', operator: 'eq', value: 'missing_rule' }],
      sort: { field: 'billedQuantity', dir: 'desc' },
    },
    {
      id: 'missing-psa',
      label: 'Missing PSA line',
      description: 'Rules with no matching PSA billing row',
      filters: [{ field: 'status', operator: 'eq', value: 'missing_psa_line' }],
      sort: { field: 'actualQuantity', dir: 'desc' },
    },
  ];

  const siteFilterOptions = $derived([
    { value: 'all', label: 'All sites' },
    { value: 'unmapped', label: 'Unmapped' },
    ...sites.map((site) => ({ value: site.id, label: site.name })),
  ]);
  const siteGroupFilterOptions = $derived([
    { value: 'all', label: 'All groups' },
    ...siteGroups.map((group) => ({ value: group.id, label: group.name })),
  ]);

  function onSiteFilterChange(v: string) {
    siteFilter = v || 'all';
  }
  function onSiteGroupFilterChange(v: string) {
    siteGroupFilter = v || 'all';
  }

  const filteredRules = $derived.by(() => {
    const q = ruleSearch.trim().toLowerCase();
    let list = rules.filter((rule) => {
      if (ruleEnabledFilter === 'enabled' && !rule.enabled) return false;
      if (ruleEnabledFilter === 'disabled' && rule.enabled) return false;
      if (q.length) {
        const match = rule.psaItemMatch as { field?: string; value?: string } | null;
        const hay =
          `${rule.name} ${match?.value ?? ''} ${match?.field ?? ''} ${rule.vendorProvider} ${rule.vendorFacet}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = ruleSortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (ruleSortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'matched': {
          const av = matchedRowsByRule.get(a.id) ?? 0;
          const bv = matchedRowsByRule.get(b.id) ?? 0;
          if (av === bv) return a.name.localeCompare(b.name);
          return (av - bv) * dir;
        }
        case 'enabled': {
          const av = a.enabled ? 1 : 0;
          const bv = b.enabled ? 1 : 0;
          if (av === bv) return a.name.localeCompare(b.name);
          return (av - bv) * dir;
        }
        case 'delta': {
          const av = Math.abs(mrrDeltaByRule.get(a.id) ?? 0);
          const bv = Math.abs(mrrDeltaByRule.get(b.id) ?? 0);
          if (av === bv) return a.name.localeCompare(b.name);
          return (av - bv) * dir;
        }
      }
    });
    return list;
  });

  const ruleSortOptions = [
    { value: 'matched', label: 'Matched rows' },
    { value: 'delta', label: 'MRR impact' },
    { value: 'name', label: 'Name' },
    { value: 'enabled', label: 'Enabled state' },
  ];
  const ruleEnabledOptions = [
    { value: 'all', label: 'All rules' },
    { value: 'enabled', label: 'Enabled only' },
    { value: 'disabled', label: 'Disabled only' },
  ];

  function onRuleSortKeyChange(v: string) {
    if (v) ruleSortKey = v as RuleSortKey;
  }
  function onRuleEnabledFilterChange(v: string) {
    ruleEnabledFilter = (v || 'all') as 'all' | 'enabled' | 'disabled';
  }
  function toggleRuleSortDir() {
    ruleSortDir = ruleSortDir === 'asc' ? 'desc' : 'asc';
  }
</script>

{#snippet siteCell({ value }: { row: EnrichedRow; value: string })}
  <span class="font-medium">{value}</span>
{/snippet}

{#snippet ruleNameCell({ value }: { row: EnrichedRow; value: string | null })}
  {#if value}
    <span class="text-sm">{value}</span>
  {:else}
    <span class="text-xs italic text-muted-foreground">No rule</span>
  {/if}
{/snippet}

{#snippet numberCell({ value }: { row: EnrichedRow; value: number })}
  <span class="font-mono tabular-nums">{value}</span>
{/snippet}

{#snippet diffCell({ value }: { row: EnrichedRow; value: number })}
  {#if value > 0}
    <span class="font-mono tabular-nums text-amber-600 dark:text-amber-400">+{value}</span>
  {:else if value < 0}
    <span class="font-mono tabular-nums text-rose-600 dark:text-rose-400">{value}</span>
  {:else}
    <span class="font-mono tabular-nums text-muted-foreground">0</span>
  {/if}
{/snippet}

{#snippet mrrCell({ value }: { row: EnrichedRow; value: number })}
  {#if value > 0}
    <span class="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
      {formatMoney(value)}
    </span>
  {:else if value < 0}
    <span class="font-mono tabular-nums text-rose-600 dark:text-rose-400">
      {formatMoney(value)}
    </span>
  {:else}
    <span class="font-mono tabular-nums text-muted-foreground">{formatMoney(0)}</span>
  {/if}
{/snippet}

{#snippet statusCell({ value }: { row: EnrichedRow; value: ReportRow['status'] })}
  <span
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider {statusClass(
      value
    )}"
  >
    {#if value === 'underbilled'}
      <TrendingUp class="size-3" />
    {:else if value === 'overbilled'}
      <TrendingDown class="size-3" />
    {:else if value === 'matched'}
      <CircleCheck class="size-3" />
    {:else if value === 'missing_rule'}
      <FileWarning class="size-3" />
    {:else}
      <CircleAlert class="size-3" />
    {/if}
    {statusLabel(value)}
  </span>
{/snippet}

<RuleEditorSheet bind:open={sheetOpen} {editingRule} {sites} />

<div class="flex size-full flex-col overflow-hidden">
  <div class="flex flex-col gap-5 border-b p-6 pb-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Billing Reconciliation</h1>
        <p class="text-sm text-muted-foreground">
          Compare PSA billing lines against vendor inventory and surface revenue drift.
        </p>
      </div>
      <Button class="gap-2" onclick={openNewRule}>
        <Plus class="size-4" />
        New rule
      </Button>
    </div>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Underbilled MRR"
        value={formatMoney(summary?.underbilledMrr)}
        detail={`${summary?.underbilledRows ?? 0} rows to fix`}
      />
      <MetricCard
        label="Overbilled MRR"
        value={formatMoney(summary?.overbilledMrr)}
        detail={`${summary?.overbilledRows ?? 0} rows to refund`}
      />
      <MetricCard
        label="Net MRR delta"
        value={formatMoney(summary?.netMrrDelta)}
        detail="Positive = recoverable revenue"
      />
      <MetricCard
        label="PSA lines without rules"
        value={summary?.missingRuleRows ?? '—'}
        detail={`${summary?.totalRows ?? 0} total report rows`}
      />
    </div>
  </div>

  <div class="flex min-h-0 flex-1 flex-col overflow-hidden p-6 pt-4">
    <Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col gap-4">
      <Tabs.List>
        <Tabs.Trigger value="reconciliation">Reconciliation</Tabs.Trigger>
        <Tabs.Trigger value="rules">
          Rules
          <Badge variant="secondary" class="ml-1.5 h-5 px-1.5 text-[10px]">
            {rules.length}
          </Badge>
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="reconciliation" class="mt-0 flex min-h-0 flex-1 flex-col">
        <div class="flex flex-wrap items-center gap-2 border-b p-3">
          <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Scope
          </span>
          <div class="w-48">
            <SingleSelect
              options={siteFilterOptions}
              selected={siteFilter}
              onchange={onSiteFilterChange}
              placeholder="All sites"
              searchPlaceholder="Search sites…"
            />
          </div>
          <div class="w-48">
            <SingleSelect
              options={siteGroupFilterOptions}
              selected={siteGroupFilter}
              onchange={onSiteGroupFilterChange}
              placeholder="All groups"
              searchPlaceholder="Search groups…"
            />
          </div>
          {#if siteFilter !== 'all' || siteGroupFilter !== 'all'}
            <Button
              variant="ghost"
              size="sm"
              class="text-xs"
              onclick={() => {
                siteFilter = 'all';
                siteGroupFilter = 'all';
              }}
            >
              Clear scope
            </Button>
          {/if}
        </div>

        <div class="flex min-h-0 flex-1 flex-col p-3">
          {#if !reportQuery.data}
            <div class="flex h-40 items-center justify-center">
              <Loader />
            </div>
          {:else}
            <DataTable
              {fetchData}
              {columns}
              {views}
              {refreshKey}
              defaultPageSize={50}
              defaultSort={{ field: 'monthlyDelta', dir: 'desc' }}
              globalSearchFields={['siteName', 'psaItemName', 'ruleName']}
            />
          {/if}
        </div>

        <div
          class="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5"
        >
          <div
            class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Sigma class="size-3.5" />
            Totals · {filteredRowsState.length} row{filteredRowsState.length === 1 ? '' : 's'}
            {#if filteredTotals.underCount > 0 || filteredTotals.overCount > 0}
              <span class="ml-1 flex items-center gap-1 normal-case">
                {#if filteredTotals.underCount > 0}
                  <span class="text-amber-600 dark:text-amber-400">
                    {filteredTotals.underCount} under
                  </span>
                {/if}
                {#if filteredTotals.underCount > 0 && filteredTotals.overCount > 0}
                  <span class="text-muted-foreground/60">·</span>
                {/if}
                {#if filteredTotals.overCount > 0}
                  <span class="text-rose-600 dark:text-rose-400">
                    {filteredTotals.overCount} over
                  </span>
                {/if}
              </span>
            {/if}
          </div>
          <div class="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
            <div class="flex items-baseline gap-1.5">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                Billed
              </span>
              <span class="font-semibold">{filteredTotals.billed}</span>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                Actual
              </span>
              <span class="font-semibold">{filteredTotals.actual}</span>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                Δ Qty
              </span>
              {#if filteredTotals.diff > 0}
                <span class="font-semibold text-amber-600 dark:text-amber-400">
                  +{filteredTotals.diff}
                </span>
              {:else if filteredTotals.diff < 0}
                <span class="font-semibold text-rose-600 dark:text-rose-400">
                  {filteredTotals.diff}
                </span>
              {:else}
                <span class="font-semibold text-muted-foreground">0</span>
              {/if}
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                Δ MRR
              </span>
              {#if filteredTotals.mrr > 0}
                <span class="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatMoney(filteredTotals.mrr)}
                </span>
              {:else if filteredTotals.mrr < 0}
                <span class="font-semibold text-rose-600 dark:text-rose-400">
                  {formatMoney(filteredTotals.mrr)}
                </span>
              {:else}
                <span class="font-semibold text-muted-foreground">{formatMoney(0)}</span>
              {/if}
            </div>
          </div>
        </div>
      </Tabs.Content>

      <Tabs.Content value="rules" class="mt-0 flex min-h-0 flex-1 flex-col">
        <Card.Root class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
          <div class="flex flex-wrap items-center gap-2 border-b p-3">
            <div class="relative min-w-[220px] flex-1">
              <Search
                class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                class="pl-8"
                placeholder="Search by name, PSA match value…"
                bind:value={ruleSearch}
              />
            </div>

            <div class="w-44">
              <SingleSelect
                options={ruleEnabledOptions}
                selected={ruleEnabledFilter}
                onchange={onRuleEnabledFilterChange}
                placeholder="All rules"
              />
            </div>

            <div class="flex items-center gap-1">
              <div class="w-44">
                <SingleSelect
                  options={ruleSortOptions}
                  selected={ruleSortKey}
                  onchange={onRuleSortKeyChange}
                  placeholder="Sort by"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                class="size-9 shrink-0"
                onclick={toggleRuleSortDir}
                aria-label={ruleSortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
                title={ruleSortDir === 'asc' ? 'Ascending' : 'Descending'}
              >
                {#if ruleSortDir === 'asc'}
                  <ArrowUpNarrowWide class="size-4" />
                {:else}
                  <ArrowDownNarrowWide class="size-4" />
                {/if}
              </Button>
            </div>

            <div class="ml-auto flex items-center gap-3">
              <span class="text-xs text-muted-foreground">
                {filteredRules.length} of {rules.length} rules
              </span>
              <Button size="sm" class="gap-2" onclick={openNewRule}>
                <Plus class="size-4" />
                New rule
              </Button>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-4">
            {#if rulesQuery.isLoading}
              <div class="flex h-40 items-center justify-center">
                <Loader />
              </div>
            {:else if rules.length === 0}
              <div class="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
                <Plus class="size-8 text-muted-foreground/60" />
                <div>
                  <div class="text-sm font-medium">No rules yet</div>
                  <p class="text-xs text-muted-foreground">
                    Create your first rule to reconcile PSA billing against vendor inventory.
                  </p>
                </div>
                <Button variant="outline" size="sm" class="gap-2" onclick={openNewRule}>
                  <Plus class="size-4" />
                  Create first rule
                </Button>
              </div>
            {:else if filteredRules.length === 0}
              <div class="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
                <Filter class="size-8 text-muted-foreground/60" />
                <div>
                  <div class="text-sm font-medium">No rules match your search</div>
                  <p class="text-xs text-muted-foreground">
                    Adjust the search or enabled filter to see more rules.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => {
                    ruleSearch = '';
                    ruleEnabledFilter = 'all';
                  }}
                >
                  Clear filters
                </Button>
              </div>
            {:else}
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {#each filteredRules as rule (rule.id)}
                  <RuleCard
                    rule={rule as any}
                    siteName={rule.siteId
                      ? (siteNameById.get(rule.siteId) ?? 'Unknown site')
                      : 'Any site matched by PSA row'}
                    matchedRows={matchedRowsByRule.get(rule.id) ?? 0}
                    mrrDelta={mrrDeltaByRule.get(rule.id) ?? 0}
                    onEdit={() => openEditRule(rule)}
                    onDelete={() => deleteRule.mutate(rule.id)}
                    deletePending={deleteRule.isPending}
                  />
                {/each}
              </div>
            {/if}
          </div>
        </Card.Root>
      </Tabs.Content>
    </Tabs.Root>
  </div>
</div>
