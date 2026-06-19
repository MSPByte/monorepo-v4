<script lang="ts">
  import { getContext } from 'svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { DataTable } from '$lib/components/data-table';
  import type { DataTableColumn, PaginationInput } from '$lib/components/data-table/types';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type RoleRow = {
    id: string;
    name: string;
    description: string;
    [key: string]: unknown;
  };

  const columns: DataTableColumn<RoleRow>[] = [
    { key: 'name', title: 'Name', sortable: true, searchable: true },
    { key: 'description', title: 'Description', searchable: true },
  ];

  async function fetchData(opts: PaginationInput): Promise<{ rows: RoleRow[]; total: number }> {
    const raw = await queryClient.fetchQuery({
      queryKey: ['roles.list'],
      queryFn: () => trpc.roles.list.query(),
    });

    const rows: RoleRow[] = raw.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? '—',
    }));

    const search = opts.globalSearch.toLowerCase();
    const filtered = search
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(search) ||
            r.description.toLowerCase().includes(search),
        )
      : rows;

    const sorted = opts.sortField
      ? [...filtered].sort((a, b) => {
          const av = String(a[opts.sortField!] ?? '');
          const bv = String(b[opts.sortField!] ?? '');
          return opts.sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
        })
      : filtered;

    const start = opts.page * opts.pageSize;
    return Promise.resolve({ rows: sorted.slice(start, start + opts.pageSize), total: sorted.length });
  }
</script>

<div class="flex size-full p-4 overflow-hidden">
  <DataTable
    {columns}
    {fetchData}
    enableGlobalSearch
    enableFilters={false}
    enableExport={false}
    enableURLState={false}
    defaultPageSize={50}
  />
</div>
