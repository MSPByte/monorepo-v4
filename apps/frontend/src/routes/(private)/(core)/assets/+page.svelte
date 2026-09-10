<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { STALE } from '$lib/query';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
    type SignalStripApi,
    type TableView,
  } from '$lib/components/data-table';
  import { numberColumn, stateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import { prettyText } from '$lib/utils/format';
  import Monitor from '@lucide/svelte/icons/monitor';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { Button } from '$lib/components/ui/button';

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

  const overview = createQuery(() => ({
    queryKey: ['assets.overview'],
    queryFn: () => trpc.assets.overview.query(),
    staleTime: STALE.PAGE,
  }));

  const columns: DataTableColumn<AssetRow>[] = [
    {
      ...textColumn<AssetRow>('hostname', 'Device'),
      cellComponent: undefined,
      cell: deviceCell,
      hideable: false,
    },
    textColumn<AssetRow>(
      'assetType',
      'Type',
      undefined,
      { pretty: true },
      {
        filter: {
          type: 'select',
          operators: ['eq'],
          options: [
            { label: 'Server', value: 'server' },
            { label: 'Workstation', value: 'workstation' },
            { label: 'Network', value: 'network' },
            { label: 'Mobile', value: 'mobile' },
            { label: 'Unknown', value: 'unknown' },
          ],
        },
      }
    ),
    textColumn<AssetRow>('os', 'OS'),
    stateColumn<AssetRow>(
      'status',
      'Status',
      {
        evaluate: (value) => {
          switch (value) {
            case 'active':
              return 'success';
            case 'inactive':
              return 'destructive';
            case 'unknown':
              return 'info';
            default:
              return 'info';
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
    textColumn<AssetRow>('siteName', 'Site'),
    { ...numberColumn<AssetRow>('openFindingCount', 'Open findings'), cell: findingsCell },
    { key: 'sourceList', title: 'Sources', searchable: true, cell: sourcesCell, width: '240px' },
  ];

  let tableError = $state(false);
  let refreshKey = $state(0);
  const views: TableView<AssetRow>[] = [
    {
      id: 'findings',
      label: 'With findings',
      filters: [{ field: 'openFindingCount', operator: 'gt', value: 0 }],
      sort: { field: 'openFindingCount', dir: 'desc' },
    },
    {
      id: 'active',
      label: 'Active',
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    },
    {
      id: 'inactive',
      label: 'Inactive',
      filters: [{ field: 'status', operator: 'eq', value: 'inactive' }],
    },
    {
      id: 'unknown',
      label: 'Unknown status',
      filters: [{ field: 'status', operator: 'eq', value: 'unknown' }],
    },
  ];

  async function fetchData(input: PaginationInput) {
    try {
      const result = await trpc.assets.tableData.query(
        toServerTableInput(input, [
          'hostname',
          'displayName',
          'assetType',
          'os',
          'status',
          'siteName',
          'sourceList',
        ])
      );
      tableError = false;
      return { rows: result.rows as AssetRow[], total: result.total };
    } catch (error) {
      tableError = true;
      throw error;
    }
  }

  const activeShare = $derived.by(() => {
    const d = overview.data;
    if (!d || d.total === 0) return 0;
    return Math.round((d.byStatus.active / d.total) * 100);
  });

  const sourceCoverage = $derived.by(() => {
    const d = overview.data;
    if (!d || d.total === 0) return 0;
    return Math.round(((d.total - d.withoutSources) / d.total) * 100);
  });
</script>

<svelte:head><title>Assets · MSPByte</title></svelte:head>

{#snippet deviceCell({ row }: { row: AssetRow })}
  <a class="aw-device" href={`/assets/${row.id}`}>
    <span class="aw-device-icon"><Monitor class="size-4" /></span>
    <span class="min-w-0"
      ><span class="aw-device-name">{row.hostname || row.displayName || 'Unnamed asset'}</span>
      {#if row.displayName && row.hostname && row.displayName !== row.hostname}<span
          class="aw-device-subtitle">{row.displayName}</span
        >{/if}
    </span>
  </a>
{/snippet}

{#snippet findingsCell({ row }: { row: AssetRow })}
  <span class="aw-finding-count" class:has-findings={row.openFindingCount > 0}
    >{row.openFindingCount.toLocaleString()}</span
  >
{/snippet}

{#snippet sourcesCell({ row }: { row: AssetRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources as source}<SourceBadge {source} />{:else}<span
        class="text-xs text-muted-foreground">No linked sources</span
      >{/each}
  </span>
{/snippet}

{#snippet strip(api: SignalStripApi)}
  <nav class="aw-views" aria-label="Asset views">
    <button
      type="button"
      class:active={!api.activeViewId}
      aria-pressed={!api.activeViewId}
      onclick={() => {
        api.clearFilters();
        api.setView();
      }}>All assets</button
    >
    {#each views as view}
      <button
        type="button"
        class:active={api.activeViewId === view.id}
        aria-pressed={api.activeViewId === view.id}
        onclick={() => {
          api.clearFilters();
          api.setView(view.id);
        }}>{view.label}</button
      >
    {/each}
  </nav>
{/snippet}

<div class="aw-directory">
  <header class="aw-heading">
    <div>
      <p class="aw-eyebrow">Infrastructure</p>
      <h1>Assets</h1>
      <p class="aw-subtitle">
        Find a device, review its findings, and trace the sources behind it.
      </p>
    </div>
    <span class="aw-context">Across your accessible sites</span>
  </header>

  <div class="aw-overview" aria-label="Fleet overview" aria-busy={overview.isPending}>
    <div>
      <span>Total assets</span><strong>{overview.data?.total.toLocaleString() ?? '—'}</strong><small
        >Devices in your inventory</small
      >
    </div>
    <div>
      <span>Active assets</span><strong
        >{overview.data?.byStatus.active.toLocaleString() ?? '—'}</strong
      ><small>{overview.data ? `${activeShare}% of inventory` : 'Waiting for fleet data'}</small>
    </div>
    <div>
      <span>Inactive assets</span><strong
        >{overview.data?.byStatus.inactive.toLocaleString() ?? '—'}</strong
      >
      <small
        >{overview.data
          ? `${overview.data.byStatus.unknown.toLocaleString()} with unknown status`
          : 'Waiting for fleet data'}</small
      >
    </div>
    <div class="aw-coverage">
      <span>Source coverage</span><strong>{overview.data ? `${sourceCoverage}%` : '—'}</strong
      ><small
        >{overview.data
          ? `${overview.data.withoutSources.toLocaleString()} assets without linked sources`
          : 'Waiting for source data'}</small
      >
    </div>
  </div>
  {#if overview.isError}<div class="aw-notice" role="alert">
      Fleet totals could not be loaded. <button type="button" onclick={() => overview.refetch()}
        >Retry totals</button
      >
    </div>{/if}
  {#if tableError}<div class="aw-notice" role="alert">
      Assets could not be loaded. <button type="button" onclick={() => refreshKey++}
        >Retry assets</button
      >
    </div>{/if}

  {#if overview.data?.total === 0 && !tableError}
    <div class="aw-empty aw-panel">
      <Monitor class="size-8 text-primary" />
      <h2>No assets yet</h2>
      <p>
        Assets appear when your connected integrations sync device records. Check your integrations
        to get started.
      </p>
      <Button href="/setup/integrations" variant="outline"
        >View integrations <ArrowUpRight class="size-4" /></Button
      >
    </div>
  {:else}
    <div class="aw-inventory">
      <DataTable
        {fetchData}
        {columns}
        {views}
        {refreshKey}
        enableViewSelector={false}
        defaultPageSize={25}
        defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
        onrowclick={(row) => goto(`/assets/${row.id}`)}
        signalStrip={strip}
      />
    </div>
    <p class="aw-table-help">
      Search by device, site, operating system, or source. Use filters to narrow the inventory.
    </p>
  {/if}
</div>
