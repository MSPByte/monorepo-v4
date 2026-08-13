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
  import { Play } from '@lucide/svelte';
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

  let runDialogOpen = $state(false);
  let refreshKey = $state(0);

  // Active jobs are deliberately fresh without making search/sort state jump.
  $effect(() => {
    const interval = window.setInterval(() => refreshKey++, 10_000);
    return () => window.clearInterval(interval);
  });

  function sourceLabel(run: {
    triggerSourceLabel: string | null;
    triggerType: string;
  }): string {
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
    textColumn<RunRow>('packageName', 'Package', 'Search packages', undefined, { width: '260px' }),
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
    textColumn<RunRow>('triggerType', 'Trigger', 'Search trigger', { pretty: true }),
    numberColumn<RunRow>('attempt', 'Attempt'),
    relativeDateColumn<RunRow>('startedAt', 'Started'),
    relativeDateColumn<RunRow>('createdAt', 'Created', { defaultHidden: true }),
    numberColumn<RunRow>('billingTotal', 'Cost'),
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

    const query = opts.globalSearch.trim().toLowerCase();
    let filtered = query ? rows.filter((row) => row.searchBlob.includes(query)) : rows;

    for (const filter of opts.filters) {
      filtered = filtered.filter((row) => {
        const value = row[filter.field];
        if (filter.operator === 'eq') return value === filter.value;
        if (filter.operator === 'neq') return value !== filter.value;
        if (filter.operator === 'contains')
          return String(value ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase());
        if (filter.operator === 'gt') return Number(value) > Number(filter.value);
        if (filter.operator === 'gte') return Number(value) >= Number(filter.value);
        if (filter.operator === 'lt') return Number(value) < Number(filter.value);
        if (filter.operator === 'lte') return Number(value) <= Number(filter.value);
        if (filter.operator === 'is_null') return value === null || value === undefined || value === '';
        if (filter.operator === 'is_not_null') return !(value === null || value === undefined || value === '');
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

<div class="flex size-full flex-col gap-6 overflow-hidden p-6">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">Runs</h1>
      <p class="text-sm text-muted-foreground">
        One job per package execution — including every retry and its retained context.
      </p>
    </div>
    <Button class="gap-2" onclick={() => (runDialogOpen = true)}>
      <Play class="size-4" />
      Run a package
    </Button>
  </header>

  <RunPackageDialog bind:open={runDialogOpen} onOpenChange={(open) => (runDialogOpen = open)} />

  <DataTable
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
    defaultPageSize={50}
    globalSearchFields={['packageName', 'source', 'triggerType', 'status']}
    onrowclick={(row) => goto(`/automation/runs/${row.id}`)}
  />
</div>
