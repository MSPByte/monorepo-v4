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
  import { numberColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SeverityRibbon from '$lib/components/panel/severity-ribbon.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';

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
    staleTime: STALE.PAGE,
  }));

  const columns: DataTableColumn<SiteRow>[] = [
    textColumn<SiteRow>('name', 'Site', undefined, undefined, {
      cell: siteCell,
      cellComponent: undefined,
    }),
    {
      key: 'completenessScore',
      title: 'Completeness',
      sortable: true,
      cell: completenessCell,
      width: '130px',
      filter: {
        label: 'Completeness',
        operators: ['eq', 'lt', 'gt', 'lte', 'gte'],
        type: 'number',
      },
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

  const views: TableView<SiteRow>[] = [
    { id: 'all', label: 'All sites', filters: [], isDefault: true },
    {
      id: 'needs-attention',
      label: 'With open findings',
      filters: [{ field: 'openFindingCount', operator: 'gt', value: 0 }],
      sort: { field: 'openFindingCount', dir: 'desc' },
    },
    {
      id: 'incomplete',
      label: 'Incomplete profiles',
      filters: [{ field: 'completenessScore', operator: 'lt', value: 100 }],
      sort: { field: 'completenessScore', dir: 'asc' },
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

{#snippet siteCell({ row }: { row: SiteRow; value: string })}
  <a class="sw-site-link" href={`/sites/${row.id}`} onclick={(event) => event.stopPropagation()}
    >{row.name}</a
  >
  {#if row.description}<p class="mt-1 max-w-xs truncate text-xs text-muted-foreground">
      {row.description}
    </p>{/if}
{/snippet}

{#snippet sourcesCell({ row }: { row: SiteRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources ?? [] as source}
      <SourceBadge {source} />
    {:else}<span class="text-xs text-muted-foreground">No sources linked</span>{/each}
  </span>
{/snippet}

{#snippet completenessCell({ value }: { value: number })}
  <span class="font-mono text-sm tabular-nums">{value}%</span>
{/snippet}

{#snippet strip(api: SignalStripApi)}
  {#if overview.isError}
    <div class="sw-notice" role="alert">
      Site totals could not be loaded. <button onclick={() => overview.refetch()}>Try again</button>
    </div>
  {:else}
    <div class="sw-summary">
      <div>
        <span>Connected sites</span><strong
          >{overview.data?.connectedSites.toLocaleString() ?? '—'}</strong
        ><small
          >{overview.data
            ? `${connectedShare}% of ${overview.data.totalSites} sites have linked sources`
            : 'Loading site totals…'}</small
        >
      </div>
      <button onclick={() => api.setView('needs-attention')}
        ><span>Open findings ↗</span><strong
          >{overview.data ? openTotal.toLocaleString() : '—'}</strong
        ><small
          >{overview.data
            ? `Across ${overview.data.sitesWithFindings} sites · View findings by site`
            : 'Loading findings…'}</small
        >{#if overview.data}<div class="w-full pt-1">
            <SeverityRibbon buckets={overview.data.severity} />
          </div>{/if}</button
      >
      <div>
        <span>Managed assets</span><strong
          >{overview.data?.totalAssets.toLocaleString() ?? '—'}</strong
        ><small>Across your site portfolio</small>
      </div>
      <div class="sw-priority">
        <span>Most open findings</span>{#if overview.data?.hotspot}<a
            href={`/sites/${overview.data.hotspot.id}/findings`}>{overview.data.hotspot.name} ↗</a
          ><small>{overview.data.hotspot.openFindingCount} open findings · Review this site</small
          >{:else}<strong class="sw-summary-message"
            >{overview.data ? 'No open findings' : '—'}</strong
          ><small
            >{overview.data
              ? 'Your portfolio has no open findings.'
              : 'Loading site activity…'}</small
          >{/if}
      </div>
    </div>
  {/if}
{/snippet}

<div class="sw-page sw-directory">
  <div class="sw-section-heading">
    <div>
      <p class="sw-eyebrow">Client workspace</p>
      <h1>Sites</h1>
      <p>Find a client, review outstanding findings, and keep their profile up to date.</p>
    </div>
  </div>

  <DataTable
    {fetchData}
    {columns}
    {views}
    enableRowSelection={false}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/sites/${row.id}`)}
    signalStrip={strip}
  />
</div>
