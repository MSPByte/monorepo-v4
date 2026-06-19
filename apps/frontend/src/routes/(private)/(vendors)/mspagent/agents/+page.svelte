<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import * as Sheet from '$lib/components/ui/sheet/index.js';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const NOW = Date.now();

  const agentsQuery = createQuery(() => ({
    queryKey: ['agents.list', scopeStore.currentSite],
    queryFn: () => trpc.agents.list.query({ siteId: scopeStore.currentSite! }),
    enabled: !!scopeStore.currentSite,
  }));

  const agents = $derived(agentsQuery.data ?? []);

  // Filter state
  let search = $state('');
  let showStaleOnly = $state(false);

  const filtered = $derived(
    agents.filter((a) => {
      const matchesSearch =
        !search || a.hostname.toLowerCase().includes(search.toLowerCase());
      const matchesStale =
        !showStaleOnly ||
        !a.updatedAt ||
        NOW - new Date(a.updatedAt).getTime() > 60 * 86_400_000;
      return matchesSearch && matchesStale;
    }),
  );

  let drawerAgent = $state<(typeof agents)[number] | null>(null);
  let activeTab = $state<'Details' | 'Tickets'>('Details');

  $effect(() => {
    if (drawerAgent) activeTab = 'Details';
  });

  // Per-agent tickets query (only runs when drawer is on Tickets tab)
  const agentTicketsQuery = createQuery(() => ({
    queryKey: ['agents.listTickets.byAgent', drawerAgent?.id],
    queryFn: () => trpc.agents.listTickets.query({ siteId: scopeStore.currentSite! }),
    enabled: !!drawerAgent && activeTab === 'Tickets' && !!scopeStore.currentSite,
  }));

  const drawerTickets = $derived(
    (agentTicketsQuery.data ?? []).filter((t) => t.agentId === drawerAgent?.id),
  );

  function relativeTime(ts?: Date | string | null) {
    if (!ts) return 'Never';
    const diff = NOW - new Date(ts).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }

  function absoluteDate(ts?: Date | string | null) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function isStale(updatedAt?: Date | string | null) {
    if (!updatedAt) return true;
    return NOW - new Date(updatedAt).getTime() > 60 * 86_400_000;
  }
</script>

{#if !scopeStore.currentSite}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">Select a site to view agents</div>
    <div class="text-xs">Use the site selector in the navigation bar</div>
  </div>
{:else}
  <div class="flex flex-col size-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-4 py-3 border-b shrink-0">
      <input
        type="text"
        placeholder="Search by hostname..."
        bind:value={search}
        class="px-3 py-1.5 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary w-64"
      />
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
        <input type="checkbox" bind:checked={showStaleOnly} class="rounded" />
        Stale 60d only
      </label>
      {#if !agentsQuery.isLoading}
        <span class="text-xs text-muted-foreground ml-auto">{filtered.length} agents</span>
      {/if}
    </div>

    <!-- Table -->
    <div class="flex-1 overflow-y-auto">
      {#if agentsQuery.isLoading}
        <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Loading…
        </div>
      {:else if filtered.length === 0}
        <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
          No agents found for this site.
        </div>
      {:else}
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b bg-muted/40">
              <th
                class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
              >
                Hostname
              </th>
              <th
                class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28"
              >
                Platform
              </th>
              <th
                class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24"
              >
                Version
              </th>
              <th
                class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
              >
                IP Address
              </th>
              <th
                class="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
              >
                Registered
              </th>
              <th
                class="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
              >
                Last Seen
              </th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as agent}
              <tr
                class="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                onclick={() => (drawerAgent = agent)}
              >
                <td class="px-4 py-2.5 font-medium">{agent.hostname}</td>
                <td class="px-4 py-2.5 text-muted-foreground capitalize text-xs">
                  {agent.platform}
                </td>
                <td class="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                  v{agent.version}
                </td>
                <td class="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                  {agent.ipAddress ?? '—'}
                </td>
                <td class="px-4 py-2.5 text-right text-xs text-muted-foreground">
                  {absoluteDate(agent.registeredAt)}
                </td>
                <td class="px-4 py-2.5 text-right">
                  <span
                    class={cn(
                      'text-xs',
                      isStale(agent.updatedAt) ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {relativeTime(agent.updatedAt)}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
{/if}

<!-- Agent detail sheet -->
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
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex gap-1 border-b">
          {#each (['Details', 'Tickets'] as const) as tab}
            <button
              onclick={() => (activeTab = tab)}
              class={cn(
                'px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab}
            </button>
          {/each}
        </div>

        {#if activeTab === 'Details'}
          <div class="flex flex-col gap-2">
            {#each [
              { label: 'IP Address', value: ag.ipAddress },
              { label: 'External IP', value: ag.extAddress },
              { label: 'MAC Address', value: ag.macAddress },
              { label: 'Registered', value: absoluteDate(ag.registeredAt) },
              { label: 'Last Seen', value: relativeTime(ag.updatedAt) },
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
