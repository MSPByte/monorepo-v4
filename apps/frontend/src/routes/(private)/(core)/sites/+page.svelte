<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
    type SignalStripApi,
  } from '$lib/components/data-table';
  import { numberColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import SignalStrip from '$lib/components/panel/signal-strip.svelte';
  import SignalCell from '$lib/components/panel/signal-cell.svelte';
  import SeverityRibbon from '$lib/components/panel/severity-ribbon.svelte';
  import CoverageMeter from '$lib/components/panel/coverage-meter.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  type SiteRow = {
    id: string;
    name: string;
    description: string | null;
    openFindingCount: number;
    assetCount: number;
    completenessScore: number;
    sources: string[];
    sourceList: string;
  };

  const overview = createQuery(() => ({
    queryKey: ['sites.overview'],
    queryFn: () => trpc.sites.overview.query(),
    staleTime: 60_000,
  }));

  const columns: DataTableColumn<SiteRow>[] = [
    textColumn<SiteRow>('name', 'Site'),
    {
      key: 'completenessScore',
      title: 'Completeness',
      sortable: true,
      cell: completenessCell,
      width: '130px',
      filter: { label: 'Completeness', operators: ['eq', 'lt', 'gt', 'lte', 'gte'], type: 'number' },
    },
    numberColumn<SiteRow>('openFindingCount', 'Open Findings'),
    numberColumn<SiteRow>('assetCount', 'Assets'),
    {
      key: 'sourceList',
      title: 'Sources',
      searchable: true,
      cell: sourcesCell,
      width: '260px',
      filter: { label: 'Sources', operators: ['contains'], type: 'text' },
    },
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.sites.tableData.query(
      toServerTableInput(input, ['name', 'description', 'sourceList'])
    );
    return { rows: result.rows as SiteRow[], total: result.total };
  }

  const connectedShare = $derived.by(() => {
    const d = overview.data;
    if (!d || d.totalSites === 0) return 0;
    return Math.round((d.connectedSites / d.totalSites) * 100);
  });

  const openTotal = $derived.by(() => {
    const s = overview.data?.severity;
    return s ? s.critical + s.high + s.medium + s.low : 0;
  });
</script>

{#snippet sourcesCell({ row }: { row: SiteRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources ?? [] as source}
      <SourceBadge {source} />
    {/each}
  </span>
{/snippet}

{#snippet completenessCell({ value }: { value: number })}
  <span class="font-mono text-sm tabular-nums">{value}%</span>
{/snippet}

{#snippet strip(api: SignalStripApi)}
  <SignalStrip
    code="01"
    title="Portfolio Signal"
    meta={overview.data ? `${overview.data.totalSites.toLocaleString()} sites` : 'loading'}
  >
    <SignalCell
      code="C"
      label="Connected"
      value={overview.data ? overview.data.connectedSites.toLocaleString() : '—'}
      detail={overview.data
        ? `${connectedShare}% linked · ${overview.data.totalSites - overview.data.connectedSites} without sources`
        : undefined}
      tone="primary"
    />
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
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            across {overview.data.sitesWithFindings} site{overview.data.sitesWithFindings === 1
              ? ''
              : 's'}
          </span>
        </div>
        <div class="pt-1">
          <SeverityRibbon buckets={overview.data.severity} />
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
    <SignalCell code="P" label="Footprint">
      {#if overview.data}
        <div class="mt-0.5 flex items-baseline gap-3">
          <span class="font-mono text-lg font-semibold tabular-nums text-foreground">
            {overview.data.totalAssets.toLocaleString()}
            <span class="text-[10px] font-normal uppercase tracking-wider text-muted-foreground"
              >assets</span
            >
          </span>
        </div>
        <div class="pt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {overview.data.totalSites > 0
            ? `${Math.round(overview.data.totalAssets / overview.data.totalSites)} assets/site avg`
            : '—'}
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
    <SignalCell
      code="H"
      label="Hotspot"
      href={overview.data?.hotspot ? `/sites/${overview.data.hotspot.id}` : undefined}
    >
      {#if overview.data?.hotspot}
        <div class="mt-0.5 truncate font-mono text-sm font-semibold text-foreground">
          {overview.data.hotspot.name}
        </div>
        <div class="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-destructive">
          {overview.data.hotspot.openFindingCount} open · needs triage
        </div>
      {:else if overview.data}
        <div class="mt-0.5 font-mono text-sm text-muted-foreground">—</div>
        <div class="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          no open work
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
  </SignalStrip>
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
    signalStrip={strip}
  />
</div>
