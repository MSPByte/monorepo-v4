<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { DataTable } from '$lib/components/data-table';
  import type { DataTableColumn, PaginationInput } from '$lib/components/data-table/types';
  import {
    numberColumn,
    relativeDateColumn,
    stateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import Button from '$lib/components/ui/button/button.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import '../workspace.css';
  import type { SignalStripApi } from '$lib/components/data-table/types';
  import { Play, Activity, ArrowUpRight } from '@lucide/svelte';
  import { prettyText } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  type RunRow = {
    id: string;
    packageName: string;
    packageVersion: number;
    status: string;
    source: string;
    triggerType: string;
    attempt: number;
    startedAt: string | null;
    createdAt: string;
    billingTotal: number;
    searchBlob: string;
    [key: string]: unknown;
  };

  const canRun = $derived(authStore.isAllowed('Packages.Run'));
  let runSummary = $state<{
    total: number;
    attention: number;
    active: number;
    completed: number;
  } | null>(null);
  const views = [
    {
      id: 'attention',
      label: 'Needs attention',
      filters: [{ field: 'statusGroup', operator: 'eq' as const, value: 'attention' }],
    },
    {
      id: 'active',
      label: 'In progress',
      filters: [{ field: 'statusGroup', operator: 'eq' as const, value: 'active' }],
    },
    {
      id: 'completed',
      label: 'Completed',
      filters: [{ field: 'status', operator: 'eq' as const, value: 'completed' }],
    },
  ];
  let runDialogOpen = $state(false);
  let refreshKey = $state(0);

  // Active jobs are deliberately fresh without making search/sort state jump.
  $effect(() => {
    const interval = window.setInterval(() => refreshKey++, 10_000);
    return () => window.clearInterval(interval);
  });

  function sourceLabel(run: { triggerSourceLabel: string | null; triggerType: string }): string {
    if (run.triggerSourceLabel) return run.triggerSourceLabel;
    if (run.triggerType === 'finding') return 'Finding automation';
    if (run.triggerType === 'scheduled') return 'Scheduled automation';
    if (run.triggerType === 'api') return 'API';
    return 'Manual run';
  }

  function compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a ?? '').localeCompare(String(b ?? ''));
  }

  const columns: DataTableColumn<RunRow>[] = [
    textColumn<RunRow>('packageName', 'Package', 'Search packages', undefined, {
      width: '300px',
      cell: runIdentity,
      cellComponent: undefined,
    }),
    stateColumn<RunRow>(
      'status',
      'Status',
      {
        transform: (value) => prettyText(String(value ?? '')),
        evaluate: (value) => {
          if (value === 'completed') return 'success';
          if (value === 'halted' || value === 'partial') return 'warn';
          if (value === 'failed' || value === 'canceled') return 'destructive';
          return 'info';
        },
      },
      {
        filter: {
          type: 'select',
          operators: ['eq'],
          options: [
            { label: 'Completed', value: 'completed' },
            { label: 'Running', value: 'running' },
            { label: 'Queued', value: 'queued' },
            { label: 'Pending', value: 'pending' },
            { label: 'Halted', value: 'halted' },
            { label: 'Partial', value: 'partial' },
            { label: 'Failed', value: 'failed' },
            { label: 'Canceled', value: 'canceled' },
          ],
        },
      }
    ),
    textColumn<RunRow>('source', 'Run by / source', 'Search people or sources'),
    {
      ...textColumn<RunRow>('triggerType', 'Started from', 'Search trigger', { pretty: true }),
      defaultHidden: true,
    },
    { ...numberColumn<RunRow>('attempt', 'Attempt'), defaultHidden: true },
    relativeDateColumn<RunRow>('startedAt', 'Started'),
    relativeDateColumn<RunRow>('createdAt', 'Created', { defaultHidden: true }),
    { ...numberColumn<RunRow>('billingTotal', 'Cost'), defaultHidden: true },
    { key: 'open', title: '', sortable: false, hideable: false, width: '110px', cell: runLink },
  ];

  async function fetchRuns(opts: PaginationInput): Promise<{ rows: RunRow[]; total: number }> {
    const runs = await trpc.packageRuns.list.query({ limit: 200 });
    const rows: RunRow[] = runs.map((run) => {
      const packageName = run.packageName ?? 'Unknown package';
      const source = sourceLabel(run);
      return {
        id: run.id,
        packageName,
        packageVersion: run.packageVersion,
        status: run.status,
        statusGroup: ['failed', 'halted', 'partial'].includes(run.status)
          ? 'attention'
          : ['pending', 'queued', 'running'].includes(run.status)
            ? 'active'
            : 'finished',
        source,
        triggerType: run.triggerType,
        attempt: (run.executionAttempt ?? 0) + 1,
        startedAt: run.startedAt,
        createdAt: run.createdAt,
        billingTotal: Number(run.billingTotal ?? 0),
        searchBlob: [
          packageName,
          run.packageVersion,
          run.status,
          source,
          run.triggerType,
          (run.executionAttempt ?? 0) + 1,
        ]
          .join(' ')
          .toLowerCase(),
      };
    });

    runSummary = {
      total: rows.length,
      attention: rows.filter((r) => r.statusGroup === 'attention').length,
      active: rows.filter((r) => r.statusGroup === 'active').length,
      completed: rows.filter((r) => r.status === 'completed').length,
    };
    const query = opts.globalSearch.trim().toLowerCase();
    let filtered = query ? rows.filter((row) => row.searchBlob.includes(query)) : rows;

    for (const filter of opts.filters) {
      filtered = filtered.filter((row) => {
        const value = row[filter.field];
        if (filter.operator === 'eq') return value === filter.value;
        if (filter.operator === 'neq') return value !== filter.value;
        if (filter.operator === 'contains')
          return String(value ?? '')
            .toLowerCase()
            .includes(String(filter.value ?? '').toLowerCase());
        if (filter.operator === 'gt') return Number(value) > Number(filter.value);
        if (filter.operator === 'gte') return Number(value) >= Number(filter.value);
        if (filter.operator === 'lt') return Number(value) < Number(filter.value);
        if (filter.operator === 'lte') return Number(value) <= Number(filter.value);
        if (filter.operator === 'is_null')
          return value === null || value === undefined || value === '';
        if (filter.operator === 'is_not_null')
          return !(value === null || value === undefined || value === '');
        return true;
      });
    }

    const sorted = opts.sortField
      ? [...filtered].sort((a, b) => {
          const comparison = compareValues(a[opts.sortField!], b[opts.sortField!]);
          return opts.sortDir === 'asc' ? comparison : -comparison;
        })
      : filtered;
    const start = opts.page * opts.pageSize;
    return { rows: sorted.slice(start, start + opts.pageSize), total: sorted.length };
  }
</script>

{#snippet runIdentity({ row }: { row: RunRow })}
  <div class="au-identity">
    <span class="au-identity-icon"><Activity size={17} /></span>
    <div>
      <a href={`/automation/runs/${row.id}`} onclick={(event) => event.stopPropagation()}
        >{row.packageName}</a
      >
      <p>Version {row.packageVersion} · Attempt {row.attempt}</p>
    </div>
  </div>
{/snippet}
{#snippet runLink({ row }: { row: RunRow })}<a
    class="inline-flex items-center gap-1 text-xs text-primary"
    href={`/automation/runs/${row.id}`}
    onclick={(event) => event.stopPropagation()}>View run <ArrowUpRight size={13} /></a
  >{/snippet}
{#snippet runSignals(api: SignalStripApi)}
  <div class="au-signal-strip">
    <button
      type="button"
      aria-pressed={!api.activeViewId}
      onclick={() => {
        api.clearFilters();
        api.setView();
      }}><strong>{runSummary?.total ?? '—'}</strong>All</button
    >
    {#each [{ label: 'Need attention', count: runSummary?.attention, value: 'attention', tone: 'au-attention' }, { label: 'In progress', count: runSummary?.active, value: 'active', tone: 'au-info' }, { label: 'Completed', count: runSummary?.completed, value: 'completed', tone: 'au-success' }] as item}
      <button
        type="button"
        class={item.tone}
        aria-pressed={api.activeViewId === item.value}
        onclick={() => {
          api.clearFilters();
          api.setView(item.value);
        }}><strong>{item.count ?? '—'}</strong>{item.label}</button
      >
    {/each}
    <span>Latest {runSummary?.total ?? '—'} runs · Refreshes every 10 seconds</span>
  </div>
{/snippet}
<div class="au-page">
  <header class="au-heading">
    <div>
      <p class="au-eyebrow">Automation / Monitor</p>
      <h1>Run history</h1>
      <p>See what finished, follow work in progress, and pick up where an automation stopped.</p>
    </div>
    {#if canRun}<Button class="gap-2" onclick={() => (runDialogOpen = true)}
        ><Play size={15} /> Run a package</Button
      >{/if}
  </header>
  <RunPackageDialog bind:open={runDialogOpen} onOpenChange={(open) => (runDialogOpen = open)} />

  <div class="au-table">
    <DataTable
      {views}
      enableViewSelector={false}
      signalStrip={runSignals}
      fetchData={fetchRuns}
      {columns}
      {refreshKey}
      enableRowSelection={false}
      enableGlobalSearch={true}
      enableFilters={true}
      enablePagination={true}
      enableColumnToggle={true}
      enableExport={true}
      defaultSort={{ field: 'createdAt', dir: 'desc' }}
      defaultPageSize={25}
      globalSearchFields={['packageName', 'source', 'triggerType', 'status']}
      onrowclick={(row) => goto(`/automation/runs/${row.id}`)}
    />
  </div>
</div>
