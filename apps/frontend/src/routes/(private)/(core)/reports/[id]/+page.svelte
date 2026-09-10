<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { ArrowLeft, Pencil } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import type { FieldDefinition, SchemaFields } from '@mspbyte/shared';
  import { STALE } from '$lib/query';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
    DataTable,
    type DataTableColumn,
    type FilterConfig,
    type PaginationInput,
  } from '$lib/components/data-table';
  import BoolBadgeCell from '$lib/components/data-table/cells/bool-badge-cell.svelte';
  import NullableTextCell from '$lib/components/data-table/cells/nullable-text-cell.svelte';
  import RelativeDateCell from '$lib/components/data-table/cells/relative-date-cell.svelte';
  import RecordDetailSheet from '$lib/components/domain/record-detail-sheet.svelte';
  import SophosFirewallDetailSheet from '$lib/components/domain/sophos-firewall-detail-sheet.svelte';
  import ScopeBar from '../_components/scope-bar.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));

  const reportId = $derived(page.params.id ?? '');
  let refreshKey = $state(0);
  let drawerRecord = $state<ReportRow | null>(null);

  type SourceMeta = {
    table: string;
    label: string;
    shape: SchemaFields;
  };

  type ReportOperator =
    | 'eq'
    | 'neq'
    | 'contains'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'is_null'
    | 'is_not_null'
    | 'has_requirement'
    | 'lacks_requirement'
    | 'has_any_of'
    | 'lacks_any_of';

  type SavedFilter = {
    column: string;
    operator: ReportOperator;
    value?: string | number | boolean | string[];
  };

  type ReportDefinition = {
    columns: string[];
    filters: SavedFilter[];
    sort?: { column: string; direction: 'asc' | 'desc' };
  };

  type ReportRow = Record<string, unknown>;

  const reportQuery = createQuery(() => ({
    queryKey: ['reports.byId', reportId],
    queryFn: () => trpc.reports.byId.query({ id: reportId }),
    retry: false,
  }));

  const sourcesQuery = createQuery(() => ({
    queryKey: ['reports.listSources'],
    queryFn: () => trpc.reports.listSources.query(),
    staleTime: STALE.REF,
  }));

  const report = $derived(reportQuery.data ?? null);
  const sources = $derived((sourcesQuery.data ?? []) as SourceMeta[]);
  const sourceMeta = $derived(report ? sources.find((s) => s.table === report.source) : undefined);
  const definition = $derived(report?.definition as ReportDefinition | undefined);

  function buildColumnFilter(field: FieldDefinition, canFilter: boolean): FilterConfig | undefined {
    if (!canFilter) return undefined;
    switch (field.type) {
      case 'boolean':
        return { type: 'boolean', operators: ['eq', 'neq'] };
      case 'number':
        return { type: 'number', operators: ['eq', 'lt', 'lte', 'gt', 'gte'] };
      case 'enum':
        return {
          type: 'select',
          operators: ['eq', 'neq'],
          options: field.options ?? [],
        };
      case 'date':
        return {
          type: 'date',
          operators: ['eq', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null'],
        };
      case 'string':
        return {
          type: 'text',
          operators: ['contains', 'eq', 'neq', 'is_null', 'is_not_null'],
        };
      default:
        return undefined;
    }
  }

  function buildColumns(cols: string[], shape: SchemaFields): DataTableColumn<ReportRow>[] {
    return cols.map((key): DataTableColumn<ReportRow> => {
      const field = shape[key];
      if (!field) return { key, title: key };

      const canFilter = field.trackable === true || field.filterable === true;
      const filter = buildColumnFilter(field, canFilter);
      const sortable = field.trackable === true;

      switch (field.type) {
        case 'boolean':
          return { key, title: field.label, sortable, cellComponent: BoolBadgeCell, filter };
        case 'date':
          return { key, title: field.label, sortable, cellComponent: RelativeDateCell, filter };
        default:
          return { key, title: field.label, sortable, cellComponent: NullableTextCell, filter };
      }
    });
  }

  const columns = $derived<DataTableColumn<ReportRow>[]>(
    definition && sourceMeta ? buildColumns(definition.columns, sourceMeta.shape) : [],
  );

  const defaultSort = $derived(
    definition?.sort
      ? { field: definition.sort.column, dir: definition.sort.direction }
      : undefined,
  );

  const isSophosFirewallReport = $derived(report?.source === 'sophosFirewalls');

  function recordTitle(row: ReportRow): string {
    for (const key of ['name', 'hostname', 'displayName', 'email', 'serialNumber', 'id']) {
      if (typeof row[key] === 'string' && row[key]) return row[key] as string;
    }
    return sourceMeta?.label ?? 'Record';
  }

  async function fetchData(input: PaginationInput): Promise<{ rows: ReportRow[]; total: number }> {
    if (!report || !definition) return { rows: [], total: 0 };

    const adHocFilters = input.filters.map((f) => ({
      column: f.field,
      operator: f.operator as
        | 'eq'
        | 'neq'
        | 'contains'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'is_null'
        | 'is_not_null',
      value: f.value ?? undefined,
    }));

    const sort = input.sortField
      ? { column: input.sortField, direction: (input.sortDir ?? 'asc') as 'asc' | 'desc' }
      : definition.sort;

    const result = await trpc.reports.run.mutate({
      source: report.source,
      definition: {
        columns: definition.columns,
        filters: [...(definition.filters ?? []), ...adHocFilters],
        sort,
      },
      table: { page: Math.max(1, input.page), pageSize: input.pageSize, globalSearch: input.globalSearch },
    });

    return { rows: result.rows as ReportRow[], total: result.total };
  }

  onMount(() => {
    const onScopeChange = () => {
      refreshKey++;
    };
    window.addEventListener('reports:scope-changed', onScopeChange);
    return () => window.removeEventListener('reports:scope-changed', onScopeChange);
  });
</script>

{#if reportQuery.isLoading || sourcesQuery.isLoading}
  <div class="flex size-full items-center justify-center">
    <p class="text-muted-foreground text-sm">Loading...</p>
  </div>
{:else if reportQuery.isError || sourcesQuery.isError || !report}
  <div class="flex size-full flex-col items-center justify-center gap-3">
    <p class="text-muted-foreground text-sm">This report couldn’t be loaded. It may be unavailable or you may not have access.</p>
    <Button variant="outline" size="sm" onclick={() => goto('/reports')}>Back to reports</Button>
  </div>
{:else}
  <div class="rw-detail flex size-full flex-col gap-4 overflow-hidden p-6">
    <div class="rw-detail-heading flex items-start justify-between gap-4">
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to reports" onclick={() => goto('/reports')}>
          <ArrowLeft class="size-4" />
        </Button>
        <div>
          <h1 class="text-2xl font-semibold tracking-normal">{report.name}</h1>
          {#if report.description}
            <p class="text-sm text-muted-foreground">{report.description}</p>
          {/if}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <ScopeBar />
        {#if canWrite}
          <Button
            size="sm"
            variant="outline"
            class="gap-2"
            onclick={() => goto(`/reports/builder?id=${report.id}`)}
          >
            <Pencil class="size-4" />
            Edit report
          </Button>
        {/if}
      </div>
    </div>

    <div class="rw-detail-context">{sourceMeta?.label ?? report.source} · {columns.length} columns · {definition?.filters?.length ?? 0} saved filters. Use column filters to refine this view without changing the saved report.</div>

    {#if columns.length > 0}
      <DataTable
        {fetchData}
        {columns}
        {refreshKey}
        {defaultSort}
        enableGlobalSearch={true}
        enableExport={true}
        enableURLState={true}
        defaultPageSize={25}
        onrowclick={(row) => (drawerRecord = row)}
      />
    {:else}
      <div class="flex flex-1 items-center justify-center">
        <p class="text-muted-foreground text-sm">No columns configured for this report.</p>
      </div>
    {/if}
  </div>
{/if}

{#if isSophosFirewallReport}
  <SophosFirewallDetailSheet
    open={!!drawerRecord}
    firewall={drawerRecord}
    onOpenChange={(open) => {
      if (!open) drawerRecord = null;
    }}
  />
{:else}
  <RecordDetailSheet
    open={!!drawerRecord}
    row={drawerRecord}
    {columns}
    title={drawerRecord ? recordTitle(drawerRecord) : 'Record'}
    description={sourceMeta ? `${sourceMeta.label} report record` : undefined}
    onOpenChange={(open) => {
      if (!open) drawerRecord = null;
    }}
  />
{/if}
