<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import type {
    DataTableColumn,
    PaginationInput,
  } from '$lib/components/data-table/types';
  import DataTable from '$lib/components/data-table/data-table.svelte';
  import {
    dateColumn,
    numberColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type LogRow = inferRouterOutputs<AppRouter>['agents']['listLogs'][number];

  const scopeKey = $derived(`${scopeStore.currentSite ?? 'all'}:${scopeStore.currentGroup ?? 'all'}`);

  const logsQuery = createQuery(() => ({
    queryKey: ['agents.listLogs', 'all', scopeKey],
    queryFn: () =>
      trpc.agents.listLogs.query(
        scopeStore.currentSite || scopeStore.currentGroup
          ? {
              siteId: scopeStore.currentSite ?? undefined,
              groupId: scopeStore.currentGroup ?? undefined,
            }
          : undefined
      ),
  }));

  const columns: DataTableColumn<LogRow>[] = $derived([
    ...(scopeStore.currentSite
      ? []
      : [
          textColumn<LogRow>('siteName', 'Site', undefined, undefined, {
            width: '160px',
          }),
        ]),
    textColumn<LogRow>('agentHostname', 'Agent', undefined, undefined, {
      width: '180px',
    }),
    textColumn<LogRow>('method', 'Method', undefined, undefined, { width: '160px' }),
    textColumn<LogRow>('message', 'Message'),
    {
      key: 'status',
      title: 'Status',
      width: '100px',
      sortable: true,
      filter: {
        type: 'number',
        operators: ['eq', 'neq'],
      },
      cell: statusCell,
    },
    numberColumn<LogRow>('timeElapsedMs', 'Elapsed (ms)', undefined, {
      width: '130px',
    }),
    dateColumn<LogRow>(
      'createdAt',
      'Timestamp',
      {
        width: '180px',
        filter: {
          type: 'date',
          operators: ['lt', 'gt'],
          defaultOperator: 'gt',
        },
      },
      { withTime: true }
    ),
  ] as DataTableColumn<LogRow>[]);

  async function fetchData(
    input: PaginationInput
  ): Promise<{ rows: LogRow[]; total: number }> {
    const source = logsQuery.data ?? [];
    const searchable = columns.filter((c) => c.searchable).map((c) => c.key);
    const searchTerm = input.globalSearch.trim().toLowerCase();

    let filtered = source.slice();
    if (searchTerm && searchable.length) {
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
          case 'gt':
            return value != null && new Date(String(value)).getTime() > new Date(String(filter.value)).getTime();
          case 'gte':
            return value != null && new Date(String(value)).getTime() >= new Date(String(filter.value)).getTime();
          case 'lt':
            return value != null && new Date(String(value)).getTime() < new Date(String(filter.value)).getTime();
          case 'lte':
            return value != null && new Date(String(value)).getTime() <= new Date(String(filter.value)).getTime();
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
        return String(av).localeCompare(String(bv), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * dir;
      });
    }

    const total = filtered.length;
    const start = input.page * input.pageSize;
    return { rows: filtered.slice(start, start + input.pageSize), total };
  }

  let drawerLog = $state<LogRow | null>(null);

  function absoluteDate(ts?: string | null) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function prettyJson(value: unknown) {
    if (value == null) return null;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

{#snippet statusCell({ value }: { row: LogRow; value: number })}
  <Badge
    variant="outline"
    class={cn(
      value === 0
        ? 'bg-success/15 text-success border-success/30'
        : 'bg-destructive/15 text-destructive border-destructive/30'
    )}
  >
    {value}
  </Badge>
{/snippet}

<div class="flex flex-col size-full overflow-hidden p-4">
  {#key scopeKey}
    <DataTable
      {fetchData}
      {columns}
      defaultSort={{ field: 'createdAt', dir: 'desc' }}
      refreshKey={logsQuery.dataUpdatedAt}
      onrowclick={(row) => (drawerLog = row)}
    />
  {/key}
</div>

<Sheet.Root
  open={!!drawerLog}
  onOpenChange={(open) => {
    if (!open) drawerLog = null;
  }}
>
  <Sheet.Content side="right" class="w-[32rem] max-w-[100vw] flex flex-col p-0">
    {#if drawerLog}
      {@const lg = drawerLog}
      {@const metaText = prettyJson(lg.metadata)}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title class="font-mono text-base">{lg.method}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 flex-wrap mt-1 items-center">
          <Badge
            variant="outline"
            class={cn(
              lg.status === 0
                ? 'bg-success/15 text-success border-success/30'
                : 'bg-destructive/15 text-destructive border-destructive/30'
            )}
          >
            {lg.status}
          </Badge>
          {#if lg.agentHostname}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground"
            >
              {lg.agentHostname}
            </span>
          {/if}
          {#if lg.siteName}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground"
            >
              {lg.siteName}
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="rounded border bg-card px-3 py-2">
          <div class="text-xs text-muted-foreground">Message</div>
          <div class="text-sm mt-0.5 whitespace-pre-wrap wrap-break-word">{lg.message}</div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="rounded border bg-card px-3 py-2">
            <div class="text-xs text-muted-foreground">Elapsed</div>
            <div class="text-sm font-medium mt-0.5 font-mono">{lg.timeElapsedMs} ms</div>
          </div>
          <div class="rounded border bg-card px-3 py-2">
            <div class="text-xs text-muted-foreground">Timestamp</div>
            <div class="text-sm font-medium mt-0.5 font-mono">{absoluteDate(lg.createdAt)}</div>
          </div>
        </div>

        {#if metaText}
          <div class="flex flex-col gap-1.5">
            <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Metadata
            </div>
            <pre
              class="overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed font-mono">{metaText}</pre>
          </div>
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
