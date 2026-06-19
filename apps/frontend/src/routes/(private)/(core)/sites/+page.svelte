<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext } from 'svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import { cn } from '$lib/utils';
  import { DataTable } from '$lib/components/data-table';
  import type { DataTableColumn, PaginationInput } from '$lib/components/data-table/types';
  import { textColumn } from '$lib/components/data-table/column-defs';
  import { sitesOverview } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type SiteRow = typeof sitesOverview.$inferSelect & Record<string, unknown>;

  const integrationColors: Record<string, string> = {
    'microsoft-365': 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    'sophos-partner': 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20',
    dattormm: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20',
    cove: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
  };

  function integrationColor(id: string): string {
    return integrationColors[id] ?? 'bg-muted text-muted-foreground border-border';
  }

  const integrationOptions = Object.entries(INTEGRATIONS).map(([id, config]) => ({
    label: config.name,
    value: id,
  }));

  const columns = $derived([
    textColumn('name', 'Name'),
    {
      key: 'integrations',
      title: 'Integrations',
      cell: integrationsCell,
      filter: {
        type: 'select' as const,
        operators: ['contains'],
        options: integrationOptions,
      },
    },
    {
      key: 'alertCount',
      title: 'Alerts',
      sortable: true,
    },
  ] as DataTableColumn<SiteRow>[]);

  async function fetchData(opts: PaginationInput): Promise<{ rows: SiteRow[]; total: number }> {
    const data = await queryClient.fetchQuery({
      queryKey: ['sites.overview'],
      queryFn: () => trpc.sites.overview.query(),
    });

    const rows: SiteRow[] = data.map((s) => ({ ...s }));

    let filtered = rows;

    for (const filter of opts.filters) {
      if (filter.field === 'integrations' && filter.operator === 'contains') {
        filtered = filtered.filter((r) => r.integrations.includes(filter.value));
      }
    }

    const search = opts.globalSearch.toLowerCase();
    if (search) {
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(search) ||
          r.integrations.some((intId) => {
            const label = INTEGRATIONS[intId as keyof typeof INTEGRATIONS]?.name ?? intId;
            return label.toLowerCase().includes(search);
          })
      );
    }

    const sorted = opts.sortField
      ? [...filtered].sort((a, b) => {
          const av = a[opts.sortField!];
          const bv = b[opts.sortField!];
          if (typeof av === 'number' && typeof bv === 'number') {
            return opts.sortDir === 'desc' ? bv - av : av - bv;
          }
          return opts.sortDir === 'desc'
            ? String(bv ?? '').localeCompare(String(av ?? ''))
            : String(av ?? '').localeCompare(String(bv ?? ''));
        })
      : filtered;

    const start = opts.page * opts.pageSize;
    return { rows: sorted.slice(start, start + opts.pageSize), total: sorted.length };
  }
</script>

{#snippet integrationsCell({ row }: { row: SiteRow; value: unknown })}
  <div class="flex flex-wrap gap-1">
    {#each row.integrations as intId}
      <span
        class={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
          integrationColor(intId)
        )}
      >
        {INTEGRATIONS[intId as keyof typeof INTEGRATIONS]?.name ?? intId}
      </span>
    {/each}
    {#if row.integrations.length === 0}
      <span class="text-xs text-muted-foreground">—</span>
    {/if}
  </div>
{/snippet}

<div class="flex size-full p-4 overflow-hidden">
  <DataTable
    {columns}
    {fetchData}
    enableGlobalSearch
    enableURLState={false}
    defaultPageSize={50}
    onrowclick={(row) => goto(`/sites/${row.id}`)}
  />
</div>
