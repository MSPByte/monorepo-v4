<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
  } from '$lib/components/data-table';
  import { numberColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  type SiteRow = {
    id: string;
    name: string;
    description: string | null;
    openFindingCount: number;
    assetCount: number;
    peopleCount: number;
    frameworkScore?: number;
    policyHealth?: number;
    sources: string[];
    sourceList: string;
  };

  const columns: DataTableColumn<SiteRow>[] = [
    textColumn<SiteRow>('name', 'Site'),
    numberColumn<SiteRow>('openFindingCount', 'Open Findings'),
    numberColumn<SiteRow>('assetCount', 'Assets'),
    numberColumn<SiteRow>('peopleCount', 'People'),
    { key: 'sourceList', title: 'Sources', searchable: true, cell: sourcesCell, width: '260px' },
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.sites.tableData.query(
      toServerTableInput(input, ['name', 'description', 'sourceList'])
    );
    return { rows: result.rows as SiteRow[], total: result.total };
  }
</script>

{#snippet percentCell({ value }: { row: SiteRow; value: number })}
  <span>{value}%</span>
{/snippet}

{#snippet sourcesCell({ row }: { row: SiteRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources ?? [] as source}
      <SourceBadge {source} />
    {/each}
  </span>
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">Sites</h1>
    <p class="text-sm text-muted-foreground">Canonical client and sub-site structure.</p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/sites/${row.id}`)}
  />
</div>
