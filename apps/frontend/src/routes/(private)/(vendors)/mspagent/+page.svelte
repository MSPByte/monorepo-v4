<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import type { createTrpcClient } from '$lib/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const NOW = Date.now();

  // ── Global overview ──────────────────────────────────────────────────────
  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    enabled: !scopeStore.currentSite,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'mspagent'],
    queryFn: () => trpc.integrationLinks.list.query({ integrationId: 'mspagent' }),
    enabled: !scopeStore.currentSite,
  }));

  // ── Per-site data ─────────────────────────────────────────────────────────
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

  // ── Derived stats (per-site) ──────────────────────────────────────────────
  const agentStats = $derived.by(() => {
    const agents = agentsQuery.data ?? [];
    const stale = agents.filter(
      (a) => !a.updatedAt || NOW - new Date(a.updatedAt).getTime() > 60 * 86_400_000,
    ).length;
    return { total: agents.length, stale };
  });

  const ticketStats = $derived.by(() => {
    const tickets = ticketsQuery.data ?? [];
    const recent = tickets.filter(
      (t) => NOW - new Date(t.createdAt).getTime() < 7 * 86_400_000,
    ).length;
    return { total: tickets.length, recent };
  });

  // ── Global overview helpers ───────────────────────────────────────────────
  const siteNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const site of sitesQuery.data ?? []) map.set(site.id, site.name);
    return map;
  });

  const links = $derived(linksQuery.data ?? []);

  function relativeTime(ts: Date | string | null | undefined) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function selectSite(link: (typeof links)[number]) {
    if (link.siteId) scopeStore.currentSite = link.siteId;
    goto('/mspagent');
  }
</script>

{#if scopeStore.currentSite}
  <!-- ── Per-site dashboard ────────────────────────────────────────────── -->
  <div class="flex flex-col size-full overflow-y-auto p-4 gap-4">
    <div class="grid grid-cols-4 gap-3">
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Total Agents
        </div>
        <div class="text-3xl font-bold tabular-nums">
          {agentsQuery.isLoading ? '—' : agentStats.total}
        </div>
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Stale (60d)
        </div>
        <div
          class="text-3xl font-bold tabular-nums {agentStats.stale > 0 ? 'text-warning' : ''}"
        >
          {agentsQuery.isLoading ? '—' : agentStats.stale}
        </div>
        <div class="text-xs text-muted-foreground">no recent check-in</div>
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Total Tickets
        </div>
        <div class="text-3xl font-bold tabular-nums">
          {ticketsQuery.isLoading ? '—' : ticketStats.total}
        </div>
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Recent (7d)
        </div>
        <div
          class="text-3xl font-bold tabular-nums {ticketStats.recent > 0
            ? 'text-amber-500'
            : ''}"
        >
          {ticketsQuery.isLoading ? '—' : ticketStats.recent}
        </div>
        <div class="text-xs text-muted-foreground">new tickets</div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <a
        href="/mspagent/agents"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm font-medium hover:bg-accent transition-colors"
      >
        Agents →
      </a>
      <a
        href="/mspagent/tickets"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm font-medium hover:bg-accent transition-colors"
      >
        Tickets →
      </a>
      <a
        href="/mspagent/logs"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm font-medium hover:bg-accent transition-colors"
      >
        Logs →
      </a>
    </div>
  </div>
{:else}
  <!-- ── Global sites overview ──────────────────────────────────────────── -->
  <div class="flex flex-col size-full overflow-hidden">
    <div class="grid grid-cols-2 gap-3 p-4 border-b shrink-0">
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Linked Sites
        </div>
        <div class="text-3xl font-bold tabular-nums">
          {linksQuery.isLoading ? '—' : links.length}
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      {#if linksQuery.isLoading}
        <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Loading…
        </div>
      {:else if links.length === 0}
        <div class="flex flex-col items-center gap-2 text-muted-foreground pt-12">
          <div class="text-sm">No MSPAgent sites configured.</div>
          <a href="/setup/integrations" class="text-xs text-primary hover:underline">
            Configure integration →
          </a>
        </div>
      {:else}
        <div class="flex flex-col gap-1">
          {#each links as link}
            <button
              onclick={() => selectSite(link)}
              class="flex items-center gap-3 px-4 py-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left w-full"
            >
              <span class="inline-block w-2.5 h-2.5 rounded-full shrink-0 bg-success"></span>
              <span class="font-medium text-sm flex-1">
                {(link.siteId ? siteNameById.get(link.siteId) : null) ?? link.name ?? link.externalId ?? link.id}
              </span>
              <span class="text-xs text-muted-foreground">{relativeTime(link.updatedAt)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
