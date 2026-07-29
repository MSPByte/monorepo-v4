<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { createTrpcClient } from '$lib/trpc';
  import type { DataTableColumn, PaginationInput, RowAction } from '$lib/components/data-table/types';
  import DataTable from '$lib/components/data-table/data-table.svelte';
  import { relativeDateColumn, textColumn, numberColumn } from '$lib/components/data-table/column-defs';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Progress from '$lib/components/ui/progress/progress.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import { cn } from '$lib/utils';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type MigrationRow = inferRouterOutputs<AppRouter>['vendor']['listSophosMigrations'][number];

  const migrationsQuery = createQuery(() => ({
    queryKey: ['vendor.listSophosMigrations'],
    queryFn: () => trpc.vendor.listSophosMigrations.query(),
    refetchInterval: 15000,
  }));

  let drawerId = $state<string | null>(null);
  let refreshingAll = $state(false);
  let refreshingRowId = $state<string | null>(null);

  const detailQuery = createQuery(() => ({
    queryKey: ['vendor.getSophosMigration', drawerId],
    queryFn: () => trpc.vendor.getSophosMigration.query({ id: drawerId! }),
    enabled: !!drawerId,
  }));

  const activeStatusQuery = createQuery(() => ({
    queryKey: ['vendor.sophosEndpointMigrationStatus', drawerId, 'sheet'],
    queryFn: () => trpc.vendor.sophosEndpointMigrationStatus.query({ id: drawerId! }),
    enabled: !!drawerId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'running' || s === 'pending' ? 3000 : false;
    },
  }));

  async function pollStatus(id: string) {
    try {
      await trpc.vendor.sophosEndpointMigrationStatus.query({ id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Poll failed: ${msg}`);
    }
  }

  async function refreshAllActive() {
    if (refreshingAll) return;
    refreshingAll = true;
    try {
      const rows = migrationsQuery.data ?? [];
      const active = rows.filter((r) => r.status === 'running' || r.status === 'pending');
      await Promise.all(active.map((r) => pollStatus(r.id)));
      await queryClient.invalidateQueries({ queryKey: ['vendor.listSophosMigrations'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
      toast.success(
        active.length === 0
          ? 'No active migrations to refresh'
          : `Refreshed ${active.length} active migration${active.length === 1 ? '' : 's'}`
      );
    } finally {
      refreshingAll = false;
    }
  }

  const rowActions: RowAction<MigrationRow>[] = [
    {
      label: 'Refresh',
      icon: RefreshCwIcon,
      variant: 'outline',
      disabled: (rows) => rows.length === 0,
      onclick: async (rows, fetchData, { setProgress }) => {
        setProgress(`Polling ${rows.length} migration${rows.length === 1 ? '' : 's'}...`);
        await Promise.all(rows.map((r) => pollStatus(r.id)));
        await queryClient.invalidateQueries({ queryKey: ['vendor.listSophosMigrations'] });
        await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
        await fetchData();
      },
    },
  ];

  const columns: DataTableColumn<MigrationRow>[] = $derived([
    {
      key: 'status',
      title: 'Status',
      width: '120px',
      sortable: true,
      cell: statusCell,
      filter: {
        type: 'select',
        operators: ['eq'],
        options: [
          { label: 'Pending', value: 'pending' },
          { label: 'Running', value: 'running' },
          { label: 'Completed', value: 'completed' },
          { label: 'Partial', value: 'partial' },
          { label: 'Failed', value: 'failed' },
        ],
      },
    },
    textColumn<MigrationRow>('fromSiteName', 'From', undefined, undefined, { width: '200px' }),
    textColumn<MigrationRow>('toSiteName', 'To', undefined, undefined, { width: '200px' }),
    {
      key: 'progress',
      title: 'Progress',
      width: '180px',
      cell: progressCell,
    },
    numberColumn<MigrationRow>('requestedCount', 'Requested', undefined, { width: '110px' }),
    numberColumn<MigrationRow>('succeededCount', 'Succeeded', undefined, { width: '110px' }),
    numberColumn<MigrationRow>('failedCount', 'Failed', undefined, { width: '90px' }),
    textColumn<MigrationRow>(
      'initiatedByName',
      'Initiated by',
      undefined,
      undefined,
      { width: '160px' }
    ),
    relativeDateColumn<MigrationRow>('startedAt', 'Started', { width: '140px' }),
    relativeDateColumn<MigrationRow>('completedAt', 'Completed', { width: '140px' }),
  ] as DataTableColumn<MigrationRow>[]);

  async function fetchData(input: PaginationInput): Promise<{ rows: MigrationRow[]; total: number }> {
    const source = migrationsQuery.data ?? [];
    const searchable = ['fromSiteName', 'toSiteName', 'initiatedByName', 'initiatedByEmail', 'sophosMigrationId'];
    const searchTerm = input.globalSearch.trim().toLowerCase();

    let filtered = source.slice();
    if (searchTerm) {
      filtered = filtered.filter((row) =>
        searchable.some((key) => {
          const value = (row as Record<string, unknown>)[key];
          return value != null && String(value).toLowerCase().includes(searchTerm);
        })
      );
    }

    for (const filter of input.filters) {
      const key = filter.field;
      filtered = filtered.filter((row) => {
        const value = (row as Record<string, unknown>)[key];
        switch (filter.operator) {
          case 'eq':
            return String(value ?? '') === String(filter.value ?? '');
          case 'neq':
            return String(value ?? '') !== String(filter.value ?? '');
          case 'contains':
            return (
              value != null &&
              String(value).toLowerCase().includes(String(filter.value ?? '').toLowerCase())
            );
          case 'is_null':
            return value == null;
          case 'is_not_null':
            return value != null;
          default:
            return true;
        }
      });
    }

    if (input.sortField) {
      const key = input.sortField;
      const dir = input.sortDir === 'desc' ? -1 : 1;
      filtered.sort((a, b) => {
        const av = (a as Record<string, unknown>)[key];
        const bv = (b as Record<string, unknown>)[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (
          String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) *
          dir
        );
      });
    }

    const total = filtered.length;
    const start = input.page * input.pageSize;
    return { rows: filtered.slice(start, start + input.pageSize), total };
  }

  function statusVariant(status: string): { classes: string; label: string } {
    switch (status) {
      case 'completed':
        return { classes: 'bg-success/15 text-success border-success/30', label: 'Completed' };
      case 'running':
        return { classes: 'bg-primary/15 text-primary border-primary/30', label: 'Running' };
      case 'pending':
        return { classes: 'bg-muted text-muted-foreground border-muted-foreground/30', label: 'Pending' };
      case 'partial':
        return { classes: 'bg-warning/15 text-warning border-warning/30', label: 'Partial' };
      case 'failed':
        return { classes: 'bg-destructive/15 text-destructive border-destructive/30', label: 'Failed' };
      default:
        return { classes: 'bg-muted text-muted-foreground', label: status };
    }
  }

  function absoluteDate(ts?: string | null) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  onDestroy(() => {
    // svelte-query will handle cancellation
  });
</script>

{#snippet statusCell({ value }: { row: MigrationRow; value: string })}
  {@const v = statusVariant(value)}
  <Badge variant="outline" class={cn(v.classes)}>{v.label}</Badge>
{/snippet}

{#snippet progressCell({ row }: { row: MigrationRow; value: unknown })}
  {@const done = row.succeededCount + row.failedCount}
  {@const total = Math.max(row.requestedCount, 1)}
  {@const pct = Math.round((done / total) * 100)}
  <div class="flex flex-col gap-1">
    <Progress value={pct} class="h-1.5" />
    <div class="text-[10px] text-muted-foreground font-mono">{done} / {row.requestedCount}</div>
  </div>
{/snippet}

<div class="flex flex-col size-full overflow-hidden">
  <div class="flex items-center justify-between px-4 pt-3 pb-2 border-b">
    <div>
      <div class="text-sm font-medium">Endpoint Migrations</div>
      <div class="text-xs text-muted-foreground">
        Sophos endpoint move jobs between sites. Auto-refreshes every 15s.
      </div>
    </div>
    <Button
      variant="outline"
      size="sm"
      onclick={refreshAllActive}
      disabled={refreshingAll || migrationsQuery.isLoading}
    >
      <RefreshCwIcon class={cn('size-4 mr-1.5', refreshingAll && 'animate-spin')} />
      {refreshingAll ? 'Refreshing...' : 'Refresh active'}
    </Button>
  </div>
  <div class="flex-1 overflow-hidden p-4">
    <DataTable
      {fetchData}
      {columns}
      {rowActions}
      enableRowSelection
      defaultSort={{ field: 'startedAt', dir: 'desc' }}
      refreshKey={migrationsQuery.dataUpdatedAt}
      onrowclick={(row) => (drawerId = row.id)}
    />
  </div>
</div>

<Sheet.Root
  open={!!drawerId}
  onOpenChange={(open) => {
    if (!open) drawerId = null;
  }}
>
  <Sheet.Content side="right" class="w-[36rem] max-w-[100vw] flex flex-col p-0">
    {#if drawerId}
      {@const detail = detailQuery.data}
      {@const live = activeStatusQuery.data}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>Migration detail</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 flex-wrap mt-1 items-center">
          {#if detail}
            {@const v = statusVariant(live?.status ?? detail.status)}
            <Badge variant="outline" class={cn(v.classes)}>{v.label}</Badge>
            <span class="text-xs text-muted-foreground font-mono">{detail.sophosMigrationId}</span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {#if detailQuery.isLoading}
          <Loader />
        {:else if detail}
          <div class="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div class="text-muted-foreground mb-0.5">From</div>
              <div class="font-medium">{detail.fromSiteName ?? '—'}</div>
            </div>
            <div>
              <div class="text-muted-foreground mb-0.5">To</div>
              <div class="font-medium">{detail.toSiteName ?? '—'}</div>
            </div>
            <div>
              <div class="text-muted-foreground mb-0.5">Requested</div>
              <div class="font-medium font-mono">{detail.requestedCount}</div>
            </div>
            <div>
              <div class="text-muted-foreground mb-0.5">Finalized in DB</div>
              <div class="font-medium font-mono">{detail.finalizedCount}</div>
            </div>
            <div>
              <div class="text-muted-foreground mb-0.5">Succeeded</div>
              <div class="font-medium text-success font-mono">
                {live?.succeeded ?? detail.succeededCount}
              </div>
            </div>
            <div>
              <div class="text-muted-foreground mb-0.5">Failed</div>
              <div class="font-medium text-destructive font-mono">
                {live?.failed ?? detail.failedCount}
              </div>
            </div>
            <div>
              <div class="text-muted-foreground mb-0.5">Started</div>
              <div class="font-medium font-mono">{absoluteDate(detail.startedAt)}</div>
            </div>
            <div>
              <div class="text-muted-foreground mb-0.5">Completed</div>
              <div class="font-medium font-mono">{absoluteDate(detail.completedAt)}</div>
            </div>
            <div class="col-span-2">
              <div class="text-muted-foreground mb-0.5">Initiated by</div>
              <div class="font-medium">
                {detail.initiatedByName ?? detail.initiatedByEmail ?? '—'}
              </div>
            </div>
          </div>

          {#if detail.error}
            <div class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {detail.error}
            </div>
          {/if}

          <div class="border-t pt-3">
            <div class="flex items-center justify-between mb-2">
              <div class="text-sm font-medium">
                Endpoints ({detail.endpoints.length} / {detail.requestedCount})
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={refreshingRowId === drawerId}
                onclick={async () => {
                  refreshingRowId = drawerId;
                  try {
                    await pollStatus(drawerId!);
                    await queryClient.invalidateQueries({
                      queryKey: ['vendor.sophosEndpointMigrationStatus', drawerId, 'sheet'],
                    });
                    await queryClient.invalidateQueries({
                      queryKey: ['vendor.getSophosMigration', drawerId],
                    });
                    await queryClient.invalidateQueries({
                      queryKey: ['vendor.listSophosMigrations'],
                    });
                  } finally {
                    refreshingRowId = null;
                  }
                }}
              >
                <RefreshCwIcon
                  class={cn('size-3.5 mr-1.5', refreshingRowId === drawerId && 'animate-spin')}
                />
                Poll now
              </Button>
            </div>
            {#if detail.endpoints.length === 0}
              <div class="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No endpoint records remain in the source link. The migration may have already
                repointed the rows to the target site.
              </div>
            {:else}
              <div class="flex flex-col gap-1.5 text-xs">
                {#each detail.endpoints as ep}
                  <div class="rounded-md border bg-muted/20 px-3 py-1.5 flex items-center justify-between">
                    <div class="font-mono">{ep.hostname}</div>
                    <div class="text-muted-foreground font-mono text-[10px]">
                      {ep.externalId.slice(0, 8)}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
