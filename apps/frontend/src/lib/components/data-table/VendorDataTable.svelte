<script lang="ts" generics="TData extends Record<string, unknown>">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { useQueryClient } from '@tanstack/svelte-query';
  import type {
    DataTableColumn,
    PaginationInput,
    RowAction,
    TableFilter,
    TableView,
  } from './types';
  import DataTable from './data-table.svelte';
  import type { createTrpcClient } from '$lib/trpc';

  type FilterOperatorMapped =
    | 'eq'
    | 'neq'
    | 'contains'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'is_null'
    | 'is_not_null';
  type FilterValueMapped = string | boolean | undefined;

  interface Props {
    table: string;
    linkId?: string;
    integrationId?: string;
    scopeColumn?: 'link' | 'site' | false;
    columns: DataTableColumn<TData>[];
    defaultPageSize?: number;
    defaultSort?: { field: string; dir: 'asc' | 'desc' };
    views?: TableView<TData>[];
    enableRowSelection?: boolean;
    rowActions?: RowAction<TData>[];
    onrowclick?: (row: TData) => void;
  }

  let {
    table,
    linkId,
    integrationId,
    scopeColumn = 'link',
    columns,
    defaultPageSize = 100,
    defaultSort,
    views = [],
    enableRowSelection = false,
    rowActions = [],
    onrowclick,
  }: Props = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();
  const normalizedLinkId = $derived(linkId || undefined);
  const tableScopeKey = $derived(`${table}:${normalizedLinkId ?? 'all'}:${scopeColumn || 'none'}`);

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', integrationId, 'all'],
    queryFn: () => trpc.integrationLinks.list.query({ integrationId }),
    enabled: !!integrationId && !normalizedLinkId && !!scopeColumn,
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    enabled: !!integrationId && !normalizedLinkId && scopeColumn === 'site',
  }));

  const linkNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const link of linksQuery.data ?? []) map.set(link.id, link.name ?? link.id);
    return map;
  });

  const siteNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const site of sitesQuery.data ?? []) map.set(site.id, site.name);
    return map;
  });

  const linkSiteNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const link of linksQuery.data ?? []) {
      if (!link.siteId) continue;
      const siteName = siteNameById.get(link.siteId);
      if (siteName) map.set(link.id, siteName);
    }
    return map;
  });

  const resolvedColumns: DataTableColumn<TData>[] = $derived([
    ...(!normalizedLinkId && scopeColumn
      ? ([
          {
            key: 'linkId',
            title: scopeColumn === 'site' ? 'Site' : 'Tenant',
            width: '180px',
            cell: scopeCell,
            sortable: true,
            searchable: false,
          },
        ] as DataTableColumn<TData>[])
      : []),
    ...columns,
  ]);

  function mapOperator(op: TableFilter['operator']): FilterOperatorMapped | null {
    switch (op) {
      case 'eq':
        return 'eq';
      case 'neq':
        return 'neq';
      case 'contains':
        return 'contains';
      case 'gt':
        return 'gt';
      case 'gte':
        return 'gte';
      case 'lt':
        return 'lt';
      case 'lte':
        return 'lte';
      case 'is_null':
        return 'is_null';
      case 'is_not_null':
        return 'is_not_null';
      default:
        return null;
    }
  }

  async function fetchData(input: PaginationInput): Promise<{ rows: TData[]; total: number }> {
    const mappedFilters = (input.filters ?? [])
      .map((f) => {
        const op = mapOperator(f.operator);
        if (!op) return null;
        return {
          column: f.field,
          operator: op,
          value:
            typeof f.value === 'string' || typeof f.value === 'boolean'
              ? (f.value as FilterValueMapped)
              : undefined,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    const searchableColumns = resolvedColumns.filter((c) => c.searchable).map((c) => c.key);

    const queryInput = {
      table,
      linkId: normalizedLinkId,
      page: input.page + 1,
      pageSize: input.pageSize,
      sortColumn: input.sortField,
      sortDirection: input.sortDir,
      filters: mappedFilters,
      globalSearch: input.globalSearch || undefined,
      globalSearchColumns: searchableColumns.length > 0 ? searchableColumns : undefined,
    };

    const result = await queryClient.fetchQuery({
      queryKey: ['vendor.tableData', queryInput],
      queryFn: () => trpc.vendor.tableData.query(queryInput),
    });

    return { rows: result.rows as TData[], total: result.total };
  }
</script>

{#snippet scopeCell({ row }: { row: TData; value: unknown })}
  {@const rowLinkId = row['linkId'] ? String(row['linkId']) : null}
  {@const rowSiteId = row['siteId'] ? String(row['siteId']) : null}
  {@const label =
    scopeColumn === 'site'
      ? ((rowSiteId ? siteNameById.get(rowSiteId) : undefined) ??
        (rowLinkId ? linkSiteNameById.get(rowLinkId) : undefined))
      : rowLinkId
        ? (linkNameById.get(rowLinkId) ?? rowLinkId)
        : undefined}
  <span class="text-sm">{label ?? '—'}</span>
{/snippet}

<div class="flex flex-col size-full p-4">
  {#key tableScopeKey}
    <DataTable
      {fetchData}
      columns={resolvedColumns}
      {defaultPageSize}
      {defaultSort}
      {views}
      {enableRowSelection}
      {rowActions}
      {onrowclick}
    />
  {/key}
</div>
