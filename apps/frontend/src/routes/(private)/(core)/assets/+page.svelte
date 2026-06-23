<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { DataTable, type DataTableColumn, type PaginationInput } from '$lib/components/data-table';
  import { numberColumn, stateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
    import { prettyText } from "$lib/utils/format";

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  type AssetRow = {
    id: string;
    hostname: string | null;
    displayName: string;
    assetType: string;
    type?: string;
    os: string | null;
    status: string;
    siteName: string;
    openFindingCount: number;
    sources: string[];
    sourceList: string;
  };

  const columns: DataTableColumn<AssetRow>[] = [
    textColumn<AssetRow>('hostname', 'Hostname'),
    textColumn<AssetRow>('assetType', 'Type', undefined, { pretty: true }, 
      {
        filter: { type: 'select', operators: ['eq'], options: [{ label: 'Server', value: 'server' }, { label: 'Workstation', value: 'workstation' }, { label: 'Network', value: 'network' }] }
      }
    ),
    textColumn<AssetRow>('os', 'OS'),
    stateColumn<AssetRow>('status', 'Status', {
      evaluate: (value) => {
        switch (value) {
          case 'active': return 'success';
          case 'inactive': return 'destructive';
          case 'unknown': return 'info';
          default: return 'info';
        }
      },
      transform: (value) => {
        return prettyText(String(value))
      }
    }, { filter: { type: 'select', operators: ['eq'], options: [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }, { label: 'Unknown', value: 'unknown' }] } }),
    textColumn<AssetRow>('siteName', 'Site'),
    numberColumn<AssetRow>('openFindingCount', 'Open Findings'),
    { key: 'sourceList', title: 'Sources', searchable: true, cell: sourcesCell, width: '240px' },
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.assets.tableData.query(
      toServerTableInput(input, ['hostname', 'displayName', 'assetType', 'os', 'status', 'siteName', 'sourceList'])
    );
    return { rows: result.rows as AssetRow[], total: result.total };
  }
</script>

{#snippet sourcesCell({ row }: { row: AssetRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources as source}
      <SourceBadge {source} />
    {/each}
  </span>
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">Assets</h1>
    <p class="text-sm text-muted-foreground">Canonical devices and infrastructure built from source evidence.</p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/assets/${row.id}`)}
  />
</div>
