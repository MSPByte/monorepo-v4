<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { createTrpcClient } from '$lib/trpc';
  import DataTable from '$lib/components/data-table/data-table.svelte';
  import { textColumn } from '$lib/components/data-table/column-defs';
  import type { PaginationInput } from '$lib/components/data-table/types';
  import StatusCell from './_status-cell.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type IntegrationRow = { id: string; name: string; category: string; status: string };

  const integrationsQuery = createQuery(() => ({
    queryKey: ['integrations.list'],
    queryFn: () => trpc.integrations.list.query(),
  }));

  const rows = $derived.by<IntegrationRow[]>(() =>
    Object.values(INTEGRATIONS).map((i) => {
      const dbRow = integrationsQuery.data?.find((dbi) => dbi.id === i.id);
      return {
        id: i.id,
        name: i.name,
        category: i.category.charAt(0).toUpperCase() + i.category.slice(1),
        status: dbRow ? (dbRow.deletedAt ? 'Pending Delete' : 'Active') : 'Not Setup',
      };
    })
  );

  const columns = [
    textColumn<IntegrationRow>('name', 'Name'),
    textColumn<IntegrationRow>('category', 'Category'),
    textColumn<IntegrationRow>('status', 'Status', undefined, {
      cellComponent: StatusCell,
    }),
  ];

  function clientFetchData(
    input: PaginationInput
  ): Promise<{ rows: IntegrationRow[]; total: number }> {
    let result = [...rows];

    if (input.globalSearch) {
      const q = input.globalSearch.toLowerCase();
      result = result.filter(
        (r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
      );
    }

    if (input.sortField) {
      const dir = input.sortDir === 'desc' ? -1 : 1;
      result = [...result].sort((a, b) => {
        const av = String(a[input.sortField as keyof IntegrationRow] ?? '');
        const bv = String(b[input.sortField as keyof IntegrationRow] ?? '');
        return av.localeCompare(bv) * dir;
      });
    }

    const total = result.length;
    const start = input.page * input.pageSize;
    return Promise.resolve({ rows: result.slice(start, start + input.pageSize), total });
  }
</script>

<div class="flex size-full p-4">
  <DataTable
    fetchData={clientFetchData}
    {columns}
    defaultPageSize={25}
    onrowclick={(row) => goto(`/setup/integrations/${(row as IntegrationRow).id}`)}
  />
</div>
