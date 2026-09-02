<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import type {
    DataTableColumn,
    PaginationInput,
    RowAction,
    TableView,
  } from '$lib/components/data-table/types';
  import DataTable from '$lib/components/data-table/data-table.svelte';
  import {
    dateColumn,
    nullableTextColumn,
    relativeDateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type AgentRow = inferRouterOutputs<AppRouter>['agents']['list'][number];

  const STALE_MS = 60 * 86_400_000;

  const canDeleteAgents = $derived(authStore.isAllowed('Agents.Delete'));

  const queryKey = $derived(['agents.list', scopeStore.currentSite ?? 'all', scopeStore.currentGroup ?? 'all'] as const);
  const scopeKey = $derived(`${scopeStore.currentSite ?? 'all'}:${scopeStore.currentGroup ?? 'all'}`);

  const agentsQuery = createQuery(() => ({
    queryKey,
    queryFn: () =>
      trpc.agents.list.query(
        scopeStore.currentSite || scopeStore.currentGroup
          ? {
              siteId: scopeStore.currentSite ?? undefined,
              groupId: scopeStore.currentGroup ?? undefined,
            }
          : undefined
      ),
  }));

  const columns: DataTableColumn<AgentRow>[] = $derived([
    ...(scopeStore.currentSite
      ? []
      : [
          textColumn<AgentRow>('siteName', 'Site', undefined, undefined, {
            width: '180px',
          }),
        ]),
    textColumn<AgentRow>('hostname', 'Hostname'),
    nullableTextColumn<AgentRow>('platform', 'Platform', undefined, {
      width: '120px',
      sortable: true,
    }),
    nullableTextColumn<AgentRow>('version', 'Version', undefined, {
      width: '110px',
      sortable: true,
    }),
    nullableTextColumn<AgentRow>('ipAddress', 'IP Address', undefined, {
      width: '150px',
      sortable: true,
    }),
    dateColumn<AgentRow>('registeredAt', 'Registered', {
      width: '140px',
      filter: {
        type: 'date',
        operators: ['lt', 'gt'],
        defaultOperator: 'lt',
      },
    }),
    relativeDateColumn<AgentRow>('lastCheckinAt', 'Last Seen', {
      width: '140px',
      filter: {
        type: 'date',
        operators: ['lt', 'gt'],
        defaultOperator: 'lt',
      },
    }),
  ] as DataTableColumn<AgentRow>[]);

  const views: TableView<AgentRow>[] = [
    {
      id: 'stale',
      label: 'Stale (60d)',
      filters: [
        {
          field: 'updatedAt',
          operator: 'lt',
          value: new Date(Date.now() - STALE_MS).toISOString(),
        },
      ],
      sort: { field: 'lastCheckinAt', dir: 'asc' },
    },
  ];

  const rowActions: RowAction<AgentRow>[] = $derived(
    canDeleteAgents
      ? [
          {
            label: 'Revoke',
            icon: Trash2Icon,
            variant: 'destructive',
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = rows.map((row) => row.id).filter(Boolean);
              if (ids.length === 0) return;

              setProgress(`Revoking ${ids.length} device${ids.length === 1 ? '' : 's'}...`);
              const result = await trpc.agents.delete.mutate({ ids });
              setProgress('Refreshing agents...');
              await queryClient.invalidateQueries({ queryKey: ['agents.list'] });
              await queryClient.invalidateQueries({ queryKey: ['agents.siteOverview'] });
              await fetchData();

              if (result.skipped > 0 && result.revoked > 0) {
                toast.warning(
                  `Revoked ${result.revoked} device${result.revoked === 1 ? '' : 's'}, skipped ${result.skipped} out of scope`
                );
              } else if (result.revoked > 0) {
                toast.success(
                  `Revoked ${result.revoked} device${result.revoked === 1 ? '' : 's'}`
                );
              } else {
                toast.error('Failed to revoke devices');
              }
            },
          } satisfies RowAction<AgentRow>,
        ]
      : []
  );

  // Client-side pagination/filter/sort over the fetched dataset.
  async function fetchData(
    input: PaginationInput
  ): Promise<{ rows: AgentRow[]; total: number }> {
    const source = agentsQuery.data ?? [];
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

  let drawerAgent = $state<AgentRow | null>(null);
  let activeTab = $state<'Details' | 'Tickets'>('Details');

  $effect(() => {
    if (drawerAgent) activeTab = 'Details';
  });

  const drawerSiteId = $derived(drawerAgent?.siteId ?? null);

  const agentTicketsQuery = createQuery(() => ({
    queryKey: ['agents.listTickets', drawerSiteId],
    queryFn: () =>
      trpc.agents.listTickets.query(drawerSiteId ? { siteId: drawerSiteId } : undefined),
    enabled: !!drawerAgent && activeTab === 'Tickets',
  }));

  const drawerTickets = $derived(
    (agentTicketsQuery.data ?? []).filter((t) => t.agentId === drawerAgent?.id)
  );

  function absoluteDate(ts?: string | null) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function relativeTime(ts?: string | null) {
    if (!ts) return 'Never';
    const diff = Date.now() - new Date(ts).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }
</script>

<div class="flex flex-col size-full overflow-hidden p-4">
  {#key scopeKey}
    <DataTable
      {fetchData}
      {columns}
      {views}
      {rowActions}
      enableRowSelection={canDeleteAgents}
      defaultSort={{ field: 'hostname', dir: 'asc' }}
      refreshKey={agentsQuery.dataUpdatedAt}
      onrowclick={(row) => (drawerAgent = row)}
    />
  {/key}
</div>

<Sheet.Root
  open={!!drawerAgent}
  onOpenChange={(open) => {
    if (!open) drawerAgent = null;
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if drawerAgent}
      {@const ag = drawerAgent}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{ag.hostname}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 flex-wrap mt-1">
          {#if ag.platform}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground capitalize"
            >
              {ag.platform}
            </span>
          {/if}
          {#if ag.version}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground font-mono"
            >
              v{ag.version}
            </span>
          {/if}
          {#if ag.siteName}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground"
            >
              {ag.siteName}
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex gap-1 border-b">
          {#each ['Details', 'Tickets'] as const as tab}
            <button
              onclick={() => (activeTab = tab)}
              class={cn(
                'px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab}
            </button>
          {/each}
        </div>

        {#if activeTab === 'Details'}
          <div class="flex flex-col gap-2">
            {#each [
              { label: 'Username', value: ag.username },
              { label: 'IP Address', value: ag.ipAddress },
              { label: 'External IP', value: ag.extAddress },
              { label: 'MAC Address', value: ag.macAddress },
              { label: 'Serial', value: ag.serial },
              { label: 'Registered', value: absoluteDate(ag.registeredAt) },
              { label: 'Last Check-in', value: relativeTime(ag.lastCheckinAt) },
            ] as item}
              {#if item.value && item.value !== '—'}
                <div class="rounded border bg-card px-3 py-2">
                  <div class="text-xs text-muted-foreground">{item.label}</div>
                  <div class="text-sm font-medium mt-0.5 font-mono">{item.value}</div>
                </div>
              {/if}
            {/each}
          </div>
        {:else if activeTab === 'Tickets'}
          {#if agentTicketsQuery.isLoading}
            <div class="flex flex-col gap-2">
              {#each [1, 2, 3] as _}
                <div class="h-12 bg-muted rounded animate-pulse"></div>
              {/each}
            </div>
          {:else if drawerTickets.length === 0}
            <div class="text-sm text-muted-foreground">No tickets found.</div>
          {:else}
            <div class="flex flex-col gap-2">
              {#each drawerTickets as ticket}
                <div class="rounded border bg-card px-3 py-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium">{ticket.ticketId}</span>
                    <span class="text-xs text-muted-foreground shrink-0">
                      {absoluteDate(ticket.createdAt)}
                    </span>
                  </div>
                  {#if ticket.summary}
                    <div class="text-xs text-muted-foreground mt-0.5">{ticket.summary}</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
