<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import type { createTrpcClient } from '$lib/trpc';
  import type {
    DataTableColumn,
    PaginationInput,
  } from '$lib/components/data-table/types';
  import DataTable from '$lib/components/data-table/data-table.svelte';
  import {
    nullableTextColumn,
    relativeDateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type TicketRow = inferRouterOutputs<AppRouter>['agents']['listTickets'][number];

  const scopeKey = $derived(scopeStore.currentSite ?? 'all');

  const ticketsQuery = createQuery(() => ({
    queryKey: ['agents.listTickets', scopeKey],
    queryFn: () =>
      trpc.agents.listTickets.query(
        scopeStore.currentSite ? { siteId: scopeStore.currentSite } : undefined
      ),
  }));

  const columns: DataTableColumn<TicketRow>[] = $derived([
    ...(scopeStore.currentSite
      ? []
      : [
          textColumn<TicketRow>('siteName', 'Site', undefined, undefined, {
            width: '180px',
          }),
        ]),
    textColumn<TicketRow>('ticketId', 'Ticket ID', undefined, undefined, {
      width: '140px',
    }),
    nullableTextColumn<TicketRow>('agentHostname', 'Agent', undefined, {
      width: '180px',
      sortable: true,
      searchable: true,
    }),
    textColumn<TicketRow>('summary', 'Summary'),
    relativeDateColumn<TicketRow>('createdAt', 'Created', {
      width: '140px',
      filter: {
        type: 'date',
        operators: ['lt', 'gt'],
        defaultOperator: 'gt',
      },
    }),
  ] as DataTableColumn<TicketRow>[]);

  async function fetchData(
    input: PaginationInput
  ): Promise<{ rows: TicketRow[]; total: number }> {
    const source = ticketsQuery.data ?? [];
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

  let drawerTicket = $state<TicketRow | null>(null);

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

  function prettyJson(value: unknown) {
    if (value == null) return null;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

<div class="flex flex-col size-full overflow-hidden p-4">
  {#key scopeKey}
    <DataTable
      {fetchData}
      {columns}
      defaultSort={{ field: 'createdAt', dir: 'desc' }}
      refreshKey={ticketsQuery.dataUpdatedAt}
      onrowclick={(row) => (drawerTicket = row)}
    />
  {/key}
</div>

<Sheet.Root
  open={!!drawerTicket}
  onOpenChange={(open) => {
    if (!open) drawerTicket = null;
  }}
>
  <Sheet.Content side="right" class="w-[28rem] max-w-[100vw] flex flex-col p-0">
    {#if drawerTicket}
      {@const tk = drawerTicket}
      {@const metaText = prettyJson(tk.meta)}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title class="font-mono text-base">{tk.ticketId}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 flex-wrap mt-1">
          {#if tk.agentHostname}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground"
            >
              {tk.agentHostname}
            </span>
          {/if}
          {#if tk.siteName}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground"
            >
              {tk.siteName}
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <div class="rounded border bg-card px-3 py-2">
            <div class="text-xs text-muted-foreground">Summary</div>
            <div class="text-sm font-medium mt-0.5 whitespace-pre-wrap">
              {tk.summary ?? '—'}
            </div>
          </div>
          <div class="rounded border bg-card px-3 py-2">
            <div class="text-xs text-muted-foreground">Created</div>
            <div class="text-sm font-medium mt-0.5 font-mono">{absoluteDate(tk.createdAt)}</div>
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
