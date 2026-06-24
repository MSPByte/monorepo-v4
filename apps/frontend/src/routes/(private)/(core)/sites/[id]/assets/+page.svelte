<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { DataTable, type DataTableColumn, type PaginationInput } from '$lib/components/data-table';
  import { numberColumn, stateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import { prettyText } from '$lib/utils/format';
  import SectionPanel from '../_components/section-panel.svelte';
  import { useSiteContext } from '../_components/site-context';

  const ctx = useSiteContext();
  const site = $derived(ctx.site!);

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  type AssetRow = {
    id: string;
    hostname: string | null;
    displayName: string;
    assetType: string;
    os: string | null;
    status: string;
    siteName: string;
    siteId: string;
    openFindingCount: number;
    sources: string[];
    sourceList: string;
  };

  const columns: DataTableColumn<AssetRow>[] = [
    textColumn<AssetRow>('hostname', 'Hostname'),
    textColumn<AssetRow>('assetType', 'Type', undefined, { pretty: true }, {
      filter: {
        type: 'select',
        operators: ['eq'],
        options: [
          { label: 'Server', value: 'server' },
          { label: 'Workstation', value: 'workstation' },
          { label: 'Network', value: 'network' },
        ],
      },
    }),
    textColumn<AssetRow>('os', 'OS'),
    stateColumn<AssetRow>(
      'status',
      'Status',
      {
        evaluate: (value) => {
          switch (value) {
            case 'active': return 'success';
            case 'inactive': return 'destructive';
            case 'unknown': return 'info';
            default: return 'info';
          }
        },
        transform: (value) => prettyText(String(value)),
      },
      {
        filter: {
          type: 'select',
          operators: ['eq'],
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
            { label: 'Unknown', value: 'unknown' },
          ],
        },
      }
    ),
    numberColumn<AssetRow>('openFindingCount', 'Open Findings'),
    { key: 'sourceList', title: 'Sources', searchable: true, cell: sourcesCell, width: '220px' },
  ];

  async function fetchData(input: PaginationInput) {
    const base = toServerTableInput(input, ['hostname', 'displayName', 'assetType', 'os', 'sourceList']);
    const result = await trpc.assets.tableData.query({
      ...base,
      filters: [...(base.filters ?? []), { column: 'siteId', operator: 'eq' as const, value: site.id }],
    });
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

<div class="mx-auto max-w-[1400px] p-4 lg:p-6">
  <SectionPanel code="02·A" title="CANONICAL ASSETS">
    {#snippet aside()}
      scoped · site {site.id.slice(0, 4).toUpperCase()}
    {/snippet}
    <div class="flex h-[60vh] flex-col">
      <DataTable
        {fetchData}
        {columns}
        defaultPageSize={25}
        defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
        onrowclick={(row) => goto(`/assets/${row.id}`)}
      />
    </div>
  </SectionPanel>
</div>
