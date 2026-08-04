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
  import { numberColumn, stateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import SignalStrip from '$lib/components/panel/signal-strip.svelte';
  import SignalCell from '$lib/components/panel/signal-cell.svelte';
  import SeverityRibbon from '$lib/components/panel/severity-ribbon.svelte';
  import CoverageMeter from '$lib/components/panel/coverage-meter.svelte';
  import { prettyText } from '$lib/utils/format';

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

  const overview = createQuery(() => ({
    queryKey: ['people.overview'],
    queryFn: () => trpc.people.overview.query(),
    staleTime: 60_000,
  }));

  const columns: DataTableColumn<PersonRow>[] = [
    textColumn<PersonRow>('displayName', 'Display Name'),
    textColumn<PersonRow>('primaryEmail', 'Primary Email'),
    stateColumn<PersonRow>(
      'status',
      'Status',
      {
        transform: (v) => (typeof v === 'string' ? prettyText(v) : 'Unknown'),
        evaluate: (v) => (v === 'active' ? 'success' : 'warn'),
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

{#snippet sourcesCell({ row }: { row: PersonRow; value: string })}
  <span class="flex flex-wrap gap-1">
    {#each row.sources as source}
      <SourceBadge {source} />
    {/each}
  </span>
{/snippet}

{#snippet strip(api: SignalStripApi)}
  <SignalStrip
    code="01"
    title="Identity Signal"
    meta={overview.data ? `${overview.data.total.toLocaleString()} identities` : 'loading'}
  >
    <SignalCell
      code="A"
      label="Active"
      value={overview.data ? overview.data.byStatus.active.toLocaleString() : '—'}
      detail={overview.data
        ? `${activeShare}% of book · ${overview.data.byStatus.inactive} inactive`
        : undefined}
      tone="primary"
      onclick={() => api.addFilter({ field: 'status', operator: 'eq', value: 'active' })}
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
        </div>
        <div class="pt-1">
          <SeverityRibbon buckets={overview.data.severity} />
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
    <SignalCell code="S" label="Source Coverage">
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
    <SignalCell
      code="U"
      label="Unassigned"
      value={overview.data ? overview.data.unassigned.toLocaleString() : '—'}
      detail={overview.data && overview.data.unassigned > 0 ? 'no site linked' : 'all mapped'}
      tone={overview.data && overview.data.unassigned > 0 ? 'warning' : 'muted'}
      onclick={overview.data && overview.data.unassigned > 0
        ? () => api.addFilter({ field: 'siteName', operator: 'eq', value: 'Unassigned' })
        : undefined}
    />
  </SignalStrip>
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">People</h1>
    <p class="text-sm text-muted-foreground">
      Canonical identities and contacts with policy context.
    </p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/people/${row.id}`)}
    signalStrip={strip}
  />
</div>
