<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import { STALE } from '$lib/query';
  import ScopeBar from '../reports/_components/scope-bar.svelte';
  import * as Card from '$lib/components/ui/card';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
    type SignalStripApi,
    type TableView,
  } from '$lib/components/data-table';
  import Loader from '$lib/components/transition/loader.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import './workspace.css';

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

  import RuleEditorSheet from './_components/rule-editor-sheet.svelte';
  import RuleCard from './_components/rule-card.svelte';
  import { formatMoney } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const rulesQuery = createQuery(() => ({
    queryKey: ['billing.rules'],
    queryFn: () => trpc.billing.rules.query(),
  }));

  const filterOptionsQuery = createQuery(() => ({
    queryKey: ['billing.filterOptions'],
    queryFn: () => trpc.billing.filterOptions.query(),
  }));

  const facetsQuery = createQuery(() => ({
    queryKey: ['billing.facets'],
    queryFn: () => trpc.billing.facets.query(),
    staleTime: STALE.PAGE,
  }));

  const deleteRule = createMutation(() => ({
    mutationFn: (id: string) => trpc.billing.deleteRule.mutate({ id }),
    onSuccess: () => {
      toast.success('Rule deleted');
      ruleToDelete = null;
      refreshReport();
      qc.invalidateQueries({ queryKey: ['billing.rules'] });
      qc.invalidateQueries({ queryKey: ['billing.report'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  type ReportResponse = Awaited<ReturnType<typeof trpc.billing.report.query>>;
  type ReportRow = ReportResponse['rows'][number];
  type EnrichedRow = ReportRow & { id: string };
  type Rule = NonNullable<typeof rulesQuery.data>[number];
  type RuleCreationSeed = {
    psaItemId: string;
    psaItemName: string;
    siteId: string | null;
    siteName: string;
    billedQuantity: number;
    unitPrice: number;
  };

  let ruleToDelete = $state<Rule | null>(null);
  let reportRevision = $state(0);
  let reportLoading = $state(true);
  let reportError = $state(false);
  let requestId = 0;

  function refreshReport() {
    detailRow = null;
    reportSnapshot = null;
    reportRevision += 1;
  }

  let reportSnapshot = $state<ReportResponse | null>(null);
  let detailRow = $state<ReportRow | null>(null);
  const detailIndex = $derived(
    reportSnapshot?.rows.findIndex(
      (row) =>
        row.psaItemId === detailRow?.psaItemId &&
        row.ruleId === detailRow?.ruleId &&
        row.siteId === detailRow?.siteId
    ) ?? -1
  );
  function moveDetail(offset: number) {
    detailRow = reportSnapshot?.rows[detailIndex + offset] ?? detailRow;
  }
  let sheetOpen = $state(false);
  let editingRule = $state<any>(null);
  let creationSeed = $state<RuleCreationSeed | null>(null);
  let activeTab = $state('reconciliation');

  const prefsQuery = createQuery(() => ({
    queryKey: ['reports.getMyPrefs'],
    queryFn: () => trpc.reports.getMyPrefs.query(),
    staleTime: STALE.PAGE,
  }));

  // Rules tab state
  type RuleSortKey = 'name' | 'matched' | 'enabled' | 'delta';
  let ruleSearch = $state('');
  let ruleSortKey = $state<RuleSortKey>('matched');
  let ruleSortDir = $state<'asc' | 'desc'>('desc');
  let ruleEnabledFilter = $state<'all' | 'enabled' | 'disabled'>('all');
  let ruleFacetFilter = $state<string>('all');

  const refreshKey = $derived(
    hashScope(
      `${prefsQuery.data?.scopeKind}|${prefsQuery.data?.scopeIds?.join(',')}|${reportRevision}`
    )
  );

  function hashScope(scope: string): number {
    let h = 0;
    for (let i = 0; i < scope.length; i++) h = (h * 31 + scope.charCodeAt(i)) | 0;
    return h;
  }

  const sites = $derived(filterOptionsQuery.data?.sites ?? []);
  const siteGroups = $derived(filterOptionsQuery.data?.siteGroups ?? []);
  const rules = $derived(rulesQuery.data ?? []);
  const facets = $derived(facetsQuery.data ?? []);
  const facetLabelById = $derived(
    new Map<string, string>(facets.map((f) => [f.facet as string, f.label]))
  );

  const siteNameById = $derived(new Map(sites.map((site) => [site.id, site.name])));
  const siteGroupNameById = $derived(new Map(siteGroups.map((group) => [group.id, group.name])));

  type RuleScope = {
    mode: 'include' | 'exclude';
    targetType: 'site' | 'site_group' | 'all';
    siteId?: string | null;
    siteGroupId?: string | null;
  };

  function summarizeScopes(scopes: RuleScope[]): string {
    if (!scopes.length) return 'Unscoped';
    const includes = scopes.filter((s) => s.mode === 'include');
    const excludes = scopes.filter((s) => s.mode === 'exclude');
    const parts: string[] = [];
    if (includes.some((s) => s.targetType === 'all')) {
      parts.push('All sites');
    } else {
      const sitesIncluded = includes.filter((s) => s.targetType === 'site');
      const groupsIncluded = includes.filter((s) => s.targetType === 'site_group');
      if (sitesIncluded.length === 1 && sitesIncluded[0].siteId) {
        parts.push(siteNameById.get(sitesIncluded[0].siteId) ?? '1 site');
      } else if (sitesIncluded.length) {
        parts.push(`${sitesIncluded.length} sites`);
      }
      if (groupsIncluded.length === 1 && groupsIncluded[0].siteGroupId) {
        parts.push(`group: ${siteGroupNameById.get(groupsIncluded[0].siteGroupId) ?? '?'}`);
      } else if (groupsIncluded.length) {
        parts.push(`${groupsIncluded.length} groups`);
      }
    }
    if (excludes.length) {
      parts.push(`−${excludes.length} excluded`);
    }
    return parts.join(' · ') || 'No scope';
  }

  async function fetchData(input: PaginationInput) {
    const currentRequest = ++requestId;
    reportLoading = true;
    reportError = false;
    try {
      const base = toServerTableInput(input, ['siteName', 'psaItemName', 'ruleName']);
      const response = await trpc.billing.report.query({
        ...base,
      });
      if (currentRequest === requestId) reportSnapshot = response;
      const rows: EnrichedRow[] = response.rows.map((row, idx) => ({
        ...row,
        id: row.psaItemId ?? `${row.ruleId ?? 'x'}-${row.siteId ?? 'unmapped'}-${idx}`,
        vendorFacetLabel: row.vendorFacetLabel ?? 'No rule',
      }));
      return { rows, total: response.total };
    } catch (error) {
      if (currentRequest === requestId) {
        reportSnapshot = null;
        reportError = true;
      }
      throw error;
    } finally {
      if (currentRequest === requestId) reportLoading = false;
    }
  }

  const matchedRowsByRule = $derived.by(() => {
    const m = new Map<string, number>();
    const agg = reportSnapshot?.ruleAggregates ?? {};
    for (const [ruleId, entry] of Object.entries(agg)) m.set(ruleId, entry.matchedRows);
    return m;
  });
  const mrrDeltaByRule = $derived.by(() => {
    const m = new Map<string, number>();
    const agg = reportSnapshot?.ruleAggregates ?? {};
    for (const [ruleId, entry] of Object.entries(agg)) m.set(ruleId, entry.mrrDelta);
    return m;
  });

  const filteredTotals = $derived(
    reportSnapshot?.filteredSummary ?? {
      billed: 0,
      actual: 0,
      diff: 0,
      mrr: 0,
      underCount: 0,
      overCount: 0,
    }
  );

  function openNewRule() {
    editingRule = null;
    creationSeed = null;
    sheetOpen = true;
  }
  function openEditRule(rule: Rule) {
    editingRule = rule;
    creationSeed = null;
    sheetOpen = true;
  }
  function openRuleFromLine(row: ReportRow) {
    if (!row.psaItemId || row.status !== 'missing_rule') return;
    editingRule = null;
    creationSeed = {
      psaItemId: row.psaItemId,
      psaItemName: row.psaItemName,
      siteId: row.siteId,
      siteName: row.siteName,
      billedQuantity: row.billedQuantity,
      unitPrice: row.unitPrice,
    };
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
        return 'Missing rule';
      case 'missing_psa_line':
        return 'Missing PSA line';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  const facetSelectOptions = $derived([
    { label: 'No rule', value: 'No rule' },
    ...facets.map((f) => ({ label: f.label, value: f.label })),
  ]);

  const columns = $derived<DataTableColumn<EnrichedRow>[]>([
    {
      key: 'siteName',
      title: 'Site',
      sortable: true,
      searchable: true,
      width: '18%',
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
      width: '32%',
      cell: itemCell,
      filter: {
        type: 'text',
        operators: ['contains', 'eq'],
        placeholder: 'Filter PSA item…',
      },
    },
    {
      key: 'vendorFacetLabel',
      title: 'Category',
      defaultHidden: true,
      sortable: true,
      searchable: true,
      width: '150px',
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: facetSelectOptions,
      },
      cell: categoryCell,
    },
    {
      key: 'ruleName',
      title: 'Rule',
      defaultHidden: true,
      sortable: true,
      searchable: true,
      cell: ruleNameCell,
    },
    {
      key: 'billedQuantity',
      title: 'Billed',
      width: '76px',
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
      width: '76px',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      },
      cell: actualCell,
      exportValue: ({ row, value }) => (row.status === 'missing_rule' ? null : Number(value)),
    },
    {
      key: 'diffQuantity',
      title: 'Quantity gap',
      width: '110px',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      },
      cell: diffCell,
      exportValue: ({ row, value }) => (row.status === 'missing_rule' ? null : Number(value)),
    },
    {
      key: 'monthlyDelta',
      title: 'Monthly impact',
      width: '135px',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      },
      cell: mrrCell,
      exportValue: ({ row, value }) => (row.status === 'missing_rule' ? null : Number(value) || 0),
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
  ]);

  const views: TableView<EnrichedRow>[] = [
    { id: 'all', label: 'All lines', filters: [] },
    {
      id: 'matched',
      label: 'Matched',
      filters: [{ field: 'status', operator: 'eq', value: 'matched' }],
    },
    {
      id: 'actionable',
      label: 'Differences',
      description: 'Review quantity differences before updating billing in your PSA',
      isDefault: true,
      filters: [
        { field: 'status', operator: 'neq', value: 'matched' },
        { field: 'status', operator: 'neq', value: 'missing_rule' },
        { field: 'status', operator: 'neq', value: 'missing_psa_line' },
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

  const filteredRules = $derived.by(() => {
    const q = ruleSearch.trim().toLowerCase();
    let list = rules.filter((rule) => {
      if (ruleEnabledFilter === 'enabled' && !rule.enabled) return false;
      if (ruleEnabledFilter === 'disabled' && rule.enabled) return false;
      if (ruleFacetFilter !== 'all' && rule.vendorFacet !== ruleFacetFilter) return false;
      if (q.length) {
        const match = rule.psaItemMatch as { field?: string; value?: string } | null;
        const facetLabel = facetLabelById.get(rule.vendorFacet) ?? '';
        const hay =
          `${rule.name} ${match?.value ?? ''} ${match?.field ?? ''} ${rule.vendorProvider} ${rule.vendorFacet} ${facetLabel}`.toLowerCase();
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
    { value: 'matched', label: 'Report lines' },
    { value: 'delta', label: 'MRR impact' },
    { value: 'name', label: 'Name' },
    { value: 'enabled', label: 'Enabled state' },
  ];
  const ruleEnabledOptions = [
    { value: 'all', label: 'All rules' },
    { value: 'enabled', label: 'Enabled only' },
    { value: 'disabled', label: 'Disabled only' },
  ];
  const ruleFacetOptions = $derived([
    { value: 'all', label: 'All categories' },
    ...facets.map((f) => ({ value: f.facet, label: f.label })),
  ]);

  function onRuleSortKeyChange(v: string) {
    if (v) ruleSortKey = v as RuleSortKey;
  }
  function onRuleEnabledFilterChange(v: string) {
    ruleEnabledFilter = (v || 'all') as 'all' | 'enabled' | 'disabled';
  }
  function onRuleFacetFilterChange(v: string) {
    ruleFacetFilter = v || 'all';
  }
  function toggleRuleSortDir() {
    ruleSortDir = ruleSortDir === 'asc' ? 'desc' : 'asc';
  }
</script>

{#snippet siteCell({ value }: { row: EnrichedRow; value: string })}
  <span class="bw-site-name" title={value}>{value}</span>
{/snippet}

{#snippet itemCell({ row, value }: { row: EnrichedRow; value: string })}
  <button
    class="bw-item-name"
    title={value}
    onclick={(event) => {
      event.stopPropagation();
      detailRow = row;
    }}>{value}</button
  >
{/snippet}

{#snippet categoryCell({ row, value }: { row: EnrichedRow; value: string | null })}
  {#if row.vendorFacet}
    <Badge variant="secondary" class="font-mono text-[10px]">{value}</Badge>
  {:else}
    <span class="text-xs italic text-muted-foreground">{value}</span>
  {/if}
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

{#snippet actualCell({ row, value }: { row: EnrichedRow; value: number })}
  {#if row.status === 'missing_rule'}
    <span class="text-muted-foreground" title="No inventory rule configured">—</span>
  {:else}
    <span class="font-mono tabular-nums">{value}</span>
  {/if}
{/snippet}

{#snippet diffCell({ row, value }: { row: EnrichedRow; value: number })}
  {#if row.status === 'missing_rule'}
    <span class="text-muted-foreground" title="Create a rule to calculate this comparison">—</span>
  {:else if value > 0}
    <span class="font-mono tabular-nums text-amber-600 dark:text-amber-400">+{value}</span>
  {:else if value < 0}
    <span class="font-mono tabular-nums text-rose-600 dark:text-rose-400">{value}</span>
  {:else}
    <span class="font-mono tabular-nums text-muted-foreground">0</span>
  {/if}
{/snippet}

{#snippet mrrCell({ row, value }: { row: EnrichedRow; value: number })}
  {#if row.status === 'missing_rule'}
    <span class="text-muted-foreground" title="Create a rule to calculate this comparison">—</span>
  {:else if value > 0}
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

{#snippet reconciliationStrip(api: SignalStripApi)}
  <div class="bw-review-bar" aria-label="Billing review views">
    {#each views as view}
      <button
        class:active={api.activeViewId === view.id}
        aria-pressed={api.activeViewId === view.id}
        onclick={() => api.setView(view.id)}>{view.label}</button
      >
    {/each}
    {#if reportSnapshot}
      <span
        class="bw-impact"
        title="Monthly impact of lines with rules in the current filtered view"
        >Monthly impact <strong>{formatMoney(filteredTotals.mrr)}</strong></span
      >
    {/if}
  </div>
  {#if rulesQuery.isSuccess && rules.length === 0}
    <div class="bw-start">
      <span>Create a rule to compare PSA items with inventory.</span><Button
        variant="ghost"
        size="sm"
        onclick={openNewRule}>Create first rule</Button
      >
    </div>
  {/if}
{/snippet}

{#snippet statusCell({ row, value }: { row: EnrichedRow; value: ReportRow['status'] })}
  <span
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium {statusClass(
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

<RuleEditorSheet
  bind:open={sheetOpen}
  {editingRule}
  {creationSeed}
  {sites}
  {siteGroups}
  onSaved={refreshReport}
/>

<AlertDialog.Root
  open={ruleToDelete !== null}
  onOpenChange={(open) => {
    if (!open && !deleteRule.isPending) ruleToDelete = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete reconciliation rule?</AlertDialog.Title>
      <AlertDialog.Description>
        “{ruleToDelete?.name}” will be removed. Billing lines covered only by this rule will need a
        new rule. This does not change billing in your PSA.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleteRule.isPending}>Keep rule</AlertDialog.Cancel>
      <Button
        variant="destructive"
        disabled={deleteRule.isPending}
        onclick={() => {
          if (ruleToDelete) deleteRule.mutate(ruleToDelete.id);
        }}
      >
        {deleteRule.isPending ? 'Deleting…' : 'Delete rule'}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<Sheet.Root
  open={detailRow !== null}
  onOpenChange={(open) => {
    if (!open) detailRow = null;
  }}
>
  <Sheet.Content side="right" class="bw-detail flex w-full! flex-col gap-0 p-0 sm:max-w-lg!">
    <Sheet.Header class="border-b p-5 pr-12">
      <Sheet.Title>Billing item</Sheet.Title>
      <Sheet.Description>Review quantities and the rule behind this comparison.</Sheet.Description>
    </Sheet.Header>
    {#if detailRow}
      {@const rule = rules.find((rule) => rule.id === detailRow?.ruleId)}
      <div class="bw-detail-body">
        <p class="text-sm text-muted-foreground">{detailRow.siteName}</p>
        <h2>{detailRow.psaItemName}</h2>
        <span
          class="inline-flex rounded-full border px-2 py-1 text-xs {statusClass(detailRow.status)}"
          >{statusLabel(detailRow.status)}</span
        >
        <dl class="bw-detail-quantities">
          <div>
            <dt>Billed quantity</dt>
            <dd>{detailRow.billedQuantity}</dd>
          </div>
          <div>
            <dt>Actual quantity</dt>
            <dd>{detailRow.status === 'missing_rule' ? '—' : detailRow.actualQuantity}</dd>
          </div>
          <div>
            <dt>Quantity gap</dt>
            <dd>{detailRow.status === 'missing_rule' ? '—' : detailRow.diffQuantity}</dd>
          </div>
          <div>
            <dt>Monthly impact</dt>
            <dd>
              {detailRow.status === 'missing_rule' ? '—' : formatMoney(detailRow.monthlyDelta)}
            </dd>
          </div>
        </dl>
        <div class="bw-detail-rule">
          <h3>Reconciliation rule</h3>
          <p>{detailRow.ruleName ?? 'No rule configured'}</p>
          <p class="text-muted-foreground">
            {detailRow.vendorFacetLabel ?? 'Choose which inventory to count by creating a rule.'}
          </p>
        </div>
        <p class="text-sm leading-6 text-muted-foreground">
          {detailRow.status === 'missing_rule'
            ? 'This line has not been compared with inventory. Create a rule to calculate the actual quantity.'
            : detailRow.status === 'missing_psa_line'
              ? 'Inventory is covered by a rule, but no PSA billing line matches. Check the rule and your PSA agreement.'
              : detailRow.status === 'matched'
                ? 'The billed quantity matches the inventory counted by this rule.'
                : 'Check the inventory counted by the rule, then update the billing quantity in your PSA if needed. This report does not change invoices.'}
        </p>
        {#if detailRow.status === 'missing_rule' && detailRow.psaItemId}
          <Button
            onclick={() => {
              if (detailRow) openRuleFromLine(detailRow);
              detailRow = null;
            }}><Plus class="size-4" /> Create rule for this item</Button
          >
        {:else if rule}
          <Button
            variant="outline"
            onclick={() => {
              detailRow = null;
              openEditRule(rule);
            }}>Edit reconciliation rule</Button
          >
        {/if}
      </div>
      <Sheet.Footer class="flex-row items-center justify-between border-t p-4">
        <span class="text-xs text-muted-foreground"
          >Item {detailIndex + 1} of {reportSnapshot?.rows.length ?? 0} on this page</span
        >
        <div class="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={detailIndex <= 0}
            onclick={() => moveDetail(-1)}>Previous</Button
          ><Button
            variant="outline"
            size="sm"
            disabled={detailIndex < 0 || detailIndex >= (reportSnapshot?.rows.length ?? 0) - 1}
            onclick={() => moveDetail(1)}>Next</Button
          >
        </div>
      </Sheet.Footer>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<div class="billing-workspace">
  <header class="bw-header">
    <h1>{activeTab === 'reconciliation' ? 'Billing items' : 'Reconciliation rules'}</h1>
    {#if activeTab === 'reconciliation'}
      <div class="bw-scope">
        <ScopeBar />
      </div>
    {/if}
    <div class="bw-actions">
      <Button
        variant="outline"
        size="sm"
        onclick={() => (activeTab = activeTab === 'rules' ? 'reconciliation' : 'rules')}
        >{activeTab === 'rules' ? 'Back to billing items' : `Rules (${rules.length})`}</Button
      >
      <Button size="sm" onclick={openNewRule}><Plus class="size-4" /> New rule</Button>
    </div>
  </header>
  <div class="bw-body">
    {#if activeTab === 'reconciliation'}
      <div class="bw-reconciliation">
        {#if filterOptionsQuery.isError}
          <div class="bw-notice" role="alert">
            Site filters could not be loaded. <Button
              variant="ghost"
              size="sm"
              onclick={() => filterOptionsQuery.refetch()}>Retry filters</Button
            >
          </div>
        {/if}
        {#if reportError}
          <div class="bw-notice" role="alert">
            Billing report could not be loaded. <Button
              variant="outline"
              size="sm"
              onclick={refreshReport}>Retry report</Button
            >
          </div>
        {/if}
        <div class="bw-table flex min-h-0 flex-1 flex-col">
          <DataTable
            {fetchData}
            {columns}
            {views}
            {refreshKey}
            enableRowSelection={false}
            enableViewSelector={false}
            onrowclick={(row) => (detailRow = row)}
            defaultPageSize={50}
            defaultSort={{ field: 'monthlyDelta', dir: 'desc' }}
            globalSearchFields={['siteName', 'psaItemName', 'ruleName']}
            signalStrip={reconciliationStrip}
          />
        </div>
      </div>
    {:else}
      <div class="bw-rules">
        <div class="bw-section-heading">
          <div>
            <p>
              Define which PSA items to compare, what inventory to count, and which sites to
              include.
            </p>
          </div>
          <span class="bw-context"
            >{rules.filter((rule) => rule.enabled).length} enabled · {rules.filter(
              (rule) => !rule.enabled
            ).length} disabled</span
          >
        </div>
        <Card.Root class="bw-rules-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
          <div class="flex flex-wrap items-center gap-2 border-b p-3">
            <div class="relative min-w-[220px] flex-1">
              <Search
                class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                class="pl-8"
                aria-label="Search reconciliation rules"
                placeholder="Search rules or PSA items…"
                bind:value={ruleSearch}
              />
            </div>

            <div class="w-44">
              <SingleSelect
                aria-label="Filter rules by status"
                options={ruleEnabledOptions}
                selected={ruleEnabledFilter}
                onchange={onRuleEnabledFilterChange}
                placeholder="All rules"
              />
            </div>

            <div class="w-56">
              <SingleSelect
                aria-label="Filter rules by category"
                options={ruleFacetOptions}
                selected={ruleFacetFilter}
                onchange={onRuleFacetFilterChange}
                placeholder="All categories"
                searchPlaceholder="Search categories…"
              />
            </div>

            <div class="flex items-center gap-1">
              <div class="w-44">
                <SingleSelect
                  aria-label="Sort rules by"
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
                aria-label={ruleSortDir === 'asc'
                  ? 'Switch to descending order'
                  : 'Switch to ascending order'}
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
            </div>
          </div>

          <p class="px-4 pt-3 text-xs text-muted-foreground">
            Rule results reflect your saved scope. Disabled rules are excluded from the report.
          </p>
          <div class="min-h-0 flex-1 overflow-auto p-4">
            {#if rulesQuery.isLoading}
              <div class="flex h-40 items-center justify-center">
                <Loader />
              </div>
            {:else if rulesQuery.isError}
              <div class="bw-empty" role="alert">
                <CircleAlert class="size-7 text-destructive" />
                <h3>Rules could not be loaded</h3>
                <p>Try again to load your reconciliation rules.</p>
                <Button variant="outline" onclick={() => rulesQuery.refetch()}>Retry rules</Button>
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
                    Clear your search, status, and category filters to see all rules.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => {
                    ruleSearch = '';
                    ruleEnabledFilter = 'all';
                    ruleFacetFilter = 'all';
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
                    scopeSummary={summarizeScopes(rule.scopes ?? [])}
                    facetLabel={facetLabelById.get(rule.vendorFacet) ?? rule.vendorFacet}
                    matchedRows={reportSnapshot ? (matchedRowsByRule.get(rule.id) ?? 0) : undefined}
                    mrrDelta={reportSnapshot ? (mrrDeltaByRule.get(rule.id) ?? 0) : undefined}
                    onEdit={() => openEditRule(rule)}
                    onDelete={() => (ruleToDelete = rule)}
                    deletePending={deleteRule.isPending}
                  />
                {/each}
              </div>
            {/if}
          </div>
        </Card.Root>
      </div>
    {/if}
  </div>
</div>
