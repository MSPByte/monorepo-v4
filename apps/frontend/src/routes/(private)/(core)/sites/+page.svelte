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
    <div class="sw-directory-summary" aria-label="Portfolio summary">
      <span title={overview.data ? `${connectedShare}% of sites have linked sources` : undefined}
        ><strong>{overview.data?.connectedSites.toLocaleString() ?? '—'}</strong> connected sites</span
      >
      <span><strong>{overview.data?.totalAssets.toLocaleString() ?? '—'}</strong> assets</span>
      <button
        onclick={() => api.setView('needs-attention')}
        title={overview.data
          ? `${overview.data.severity.critical} critical · ${overview.data.severity.high} high · ${overview.data.severity.medium} medium · ${overview.data.severity.low} low`
          : undefined}
        ><strong>{overview.data ? openTotal.toLocaleString() : '—'}</strong> open findings ↗</button
      >
      {#if overview.data?.hotspot}
        <a
          class="sw-directory-priority"
          href={`/sites/${overview.data.hotspot.id}/findings`}
          title={`Review ${overview.data.hotspot.openFindingCount} open findings at ${overview.data.hotspot.name}`}
        >
          Most findings: <span>{overview.data.hotspot.name}</span>
          <strong>{overview.data.hotspot.openFindingCount}</strong> ↗
        </a>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="sw-page sw-directory">
  <div class="sw-directory-heading">
    <h1>Sites</h1>
    {#if overview.data}<span>{overview.data.totalSites.toLocaleString()} total</span>{/if}
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
