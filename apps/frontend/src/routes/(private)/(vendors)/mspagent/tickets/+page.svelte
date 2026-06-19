<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import type { createTrpcClient } from '$lib/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const NOW = Date.now();

  const agentsQuery = createQuery(() => ({
    queryKey: ['agents.list', scopeStore.currentSite],
    queryFn: () => trpc.agents.list.query({ siteId: scopeStore.currentSite! }),
    enabled: !!scopeStore.currentSite,
  }));

  const ticketsQuery = createQuery(() => ({
    queryKey: ['agents.listTickets', scopeStore.currentSite],
    queryFn: () => trpc.agents.listTickets.query({ siteId: scopeStore.currentSite! }),
    enabled: !!scopeStore.currentSite,
  }));

  const agentNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const a of agentsQuery.data ?? []) {
      map.set(a.id, a.hostname);
    }
    return map;
  });

  const tickets = $derived(ticketsQuery.data ?? []);

  let search = $state('');

  const filtered = $derived(
    tickets.filter(
      (t) =>
        !search ||
        (t.summary ?? '').toLowerCase().includes(search.toLowerCase()) ||
        t.ticketId.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  function absoluteDate(ts: Date | string | null | undefined) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function relativeTime(ts: Date | string | null | undefined) {
    if (!ts) return '—';
    const diff = NOW - new Date(ts).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }
</script>

{#if !scopeStore.currentSite}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">Select a site to view tickets</div>
    <div class="text-xs">Use the site selector in the navigation bar</div>
  </div>
{:else}
  <div class="flex flex-col size-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-4 py-3 border-b shrink-0">
      <input
        type="text"
        placeholder="Search tickets..."
        bind:value={search}
        class="px-3 py-1.5 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary w-64"
      />
      {#if !ticketsQuery.isLoading}
        <span class="text-xs text-muted-foreground ml-auto">{filtered.length} tickets</span>
      {/if}
    </div>

    <!-- Table -->
    <div class="flex-1 overflow-y-auto">
      {#if ticketsQuery.isLoading || agentsQuery.isLoading}
        <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Loading…
        </div>
      {:else if filtered.length === 0}
        <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
          No tickets found for this site.
        </div>
      {:else}
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b bg-muted/40">
              <th
                class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
              >
                Ticket ID
              </th>
              <th
                class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-40"
              >
                Agent
              </th>
              <th
                class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
              >
                Summary
              </th>
              <th
                class="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
              >
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as ticket}
              <tr class="border-b hover:bg-muted/30 transition-colors">
                <td class="px-4 py-2.5 font-medium font-mono text-xs">{ticket.ticketId}</td>
                <td class="px-4 py-2.5 text-sm text-muted-foreground">
                  {agentNameById.get(ticket.agentId) ?? '—'}
                </td>
                <td class="px-4 py-2.5 text-sm text-muted-foreground truncate max-w-xs">
                  {ticket.summary ?? '—'}
                </td>
                <td class="px-4 py-2.5 text-right text-xs text-muted-foreground">
                  {relativeTime(ticket.createdAt)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
{/if}
