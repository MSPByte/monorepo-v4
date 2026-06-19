<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { DataTable, type DataTableColumn, type PaginationInput } from '$lib/components/data-table';
  import { numberColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  type PersonRow = {
    id: string;
    displayName: string;
    primaryEmail: string;
    status: string;
    siteName: string;
    openFindingCount: number;
    sources: string[];
    sourceList: string;
  };

  const columns: DataTableColumn<PersonRow>[] = [
    textColumn<PersonRow>('displayName', 'Display Name'),
    textColumn<PersonRow>('primaryEmail', 'Primary Email'),
    { key: 'status', title: 'Status', sortable: true, filter: { type: 'select', operators: ['eq'], options: [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }, { label: 'Unknown', value: 'unknown' }] } },
    textColumn<PersonRow>('siteName', 'Site'),
    numberColumn<PersonRow>('openFindingCount', 'Open Findings'),
    { key: 'sourceList', title: 'Sources', searchable: true, cell: sourcesCell, width: '240px' },
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.people.tableData.query(
      toServerTableInput(input, ['displayName', 'primaryEmail', 'status', 'siteName', 'sourceList'])
    );
    return { rows: result.rows as PersonRow[], total: result.total };
  }
</script>

{#snippet sourcesCell({ row }: { row: PersonRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources as source}
      <SourceBadge {source} />
    {/each}
  </span>
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">People</h1>
    <p class="text-sm text-muted-foreground">Canonical identities and contacts with policy context.</p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/people/${row.id}`)}
  />
</div>
