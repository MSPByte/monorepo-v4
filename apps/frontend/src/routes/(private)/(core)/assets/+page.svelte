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
  } from '$lib/components/data-table';
  import { numberColumn, stateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import { prettyText } from '$lib/utils/format';
  import SignalStrip from '$lib/components/panel/signal-strip.svelte';
  import SignalCell from '$lib/components/panel/signal-cell.svelte';
  import SeverityRibbon from '$lib/components/panel/severity-ribbon.svelte';
  import CoverageMeter from '$lib/components/panel/coverage-meter.svelte';

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
    textColumn<AssetRow>('hostname', 'Hostname'),
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
          ],
        },
      },
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
      },
    ),
    textColumn<AssetRow>('siteName', 'Site'),
    numberColumn<AssetRow>('openFindingCount', 'Open Findings'),
    { key: 'sourceList', title: 'Sources', searchable: true, cell: sourcesCell, width: '240px' },
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.assets.tableData.query(
      toServerTableInput(input, [
        'hostname',
        'displayName',
        'assetType',
        'os',
        'status',
        'siteName',
        'sourceList',
      ]),
    );
    return { rows: result.rows as AssetRow[], total: result.total };
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

  const openTotal = $derived.by(() => {
    const s = overview.data?.severity;
    return s ? s.critical + s.high + s.medium + s.low : 0;
  });
</script>

{#snippet sourcesCell({ row }: { row: AssetRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources as source}
      <SourceBadge {source} />
    {/each}
  </span>
{/snippet}

{#snippet strip(api: SignalStripApi)}
  <SignalStrip code="01" title="Fleet Signal" meta={overview.data ? `${overview.data.total.toLocaleString()} assets tracked` : 'loading'}>
    <SignalCell
      code="A"
      label="Active"
      value={overview.data ? overview.data.byStatus.active.toLocaleString() : '—'}
      detail={overview.data ? `${activeShare}% of fleet · ${overview.data.byStatus.inactive} inactive` : undefined}
      tone="primary"
      onclick={() => api.addFilter({ field: 'status', operator: 'eq', value: 'active' })}
    />
    <SignalCell
      code="T"
      label="By Type"
    >
      {#if overview.data}
        {@const t = overview.data.byType}
        {@const total = t.workstation + t.server + t.network + t.mobile + t.unknown}
        <div class="mt-0.5 space-y-1">
          <div class="flex h-1.5 gap-[2px]" aria-hidden="true">
            {#if total > 0}
              <span class="bg-primary" style={`flex: ${t.workstation} 0 0`}></span>
              <span class="bg-foreground/70" style={`flex: ${t.server} 0 0`}></span>
              <span class="bg-warning/80" style={`flex: ${t.network} 0 0`}></span>
              <span class="bg-foreground/30" style={`flex: ${t.mobile + t.unknown} 0 0`}></span>
            {:else}
              <span class="w-full bg-foreground/10"></span>
            {/if}
          </div>
          <div class="flex flex-wrap gap-x-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <button
              type="button"
              class="hover:text-foreground"
              onclick={(e) => { e.stopPropagation(); api.addFilter({ field: 'assetType', operator: 'eq', value: 'workstation' }); }}
            >W <span class="tabular-nums text-foreground">{t.workstation}</span></button>
            <button
              type="button"
              class="hover:text-foreground"
              onclick={(e) => { e.stopPropagation(); api.addFilter({ field: 'assetType', operator: 'eq', value: 'server' }); }}
            >S <span class="tabular-nums text-foreground">{t.server}</span></button>
            <button
              type="button"
              class="hover:text-foreground"
              onclick={(e) => { e.stopPropagation(); api.addFilter({ field: 'assetType', operator: 'eq', value: 'network' }); }}
            >N <span class="tabular-nums text-foreground">{t.network}</span></button>
          </div>
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
    <SignalCell
      code="F"
      label="Open Findings"
      onclick={() => api.setSort('openFindingCount', 'desc')}
    >
      {#if overview.data}
        <div class="mt-0.5 flex items-baseline gap-2">
          <span class="font-mono text-xl font-semibold tabular-nums text-foreground">
            {openTotal.toLocaleString()}
          </span>
        </div>
        <div class="pt-1">
          <SeverityRibbon buckets={overview.data.severity} />
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
    <SignalCell
      code="S"
      label="Source Coverage"
    >
      {#if overview.data}
        <div class="mt-0.5 flex items-baseline gap-2">
          <span class="font-mono text-xl font-semibold tabular-nums text-foreground">
            {sourceCoverage}<span class="text-[11px] text-muted-foreground">%</span>
          </span>
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {overview.data.withoutSources} unlinked
          </span>
        </div>
        <div class="pt-1">
          <CoverageMeter value={sourceCoverage} />
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
  </SignalStrip>
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">Assets</h1>
    <p class="text-sm text-muted-foreground">
      Canonical devices and infrastructure built from source evidence.
    </p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/assets/${row.id}`)}
    signalStrip={strip}
  />
</div>
