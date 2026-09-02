<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import GlobalLinksOverview, {
    type LinkOverviewRow,
    type LinkOverviewExtraColumn,
  } from '../_GlobalLinksOverview.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const NOW = Date.now();

  // ── Global overview (sites with mspagent installed) ──────────────────────
  const overviewQuery = createQuery(() => ({
    queryKey: ['agents.siteOverview', scopeStore.currentGroup],
    queryFn: () => trpc.agents.siteOverview.query({ groupId: scopeStore.currentGroup ?? undefined }),
    enabled: !scopeStore.currentSite,
  }));

  const overviewRows = $derived.by<LinkOverviewRow[]>(() =>
    (overviewQuery.data ?? []).map((row) => ({
      linkId: row.siteId ?? row.siteName,
      siteId: row.siteId ?? null,
      siteName: row.siteName,
      findingCount: 0,
      maxSeverity: null,
      agentCount: row.agentCount,
      lastCheckIn: row.lastCheckIn,
    }))
  );

  const extraColumns: LinkOverviewExtraColumn[] = [
    {
      key: 'agentCount',
      label: 'Agents',
      widthClass: 'w-24',
      value: (row) => (row['agentCount'] as number) ?? 0,
      format: (value) => String(value ?? 0),
    },
    {
      key: 'lastCheckIn',
      label: 'Last Check-in',
      widthClass: 'w-40',
      value: (row) => row['lastCheckIn'] as string | null | undefined,
      format: (value) => relativeTime(value as string | null | undefined),
    },
  ];

  // ── Per-site data ─────────────────────────────────────────────────────────
  const agentsQuery = createQuery(() => ({
    queryKey: ['agents.list', scopeStore.currentSite, scopeStore.currentGroup],
    queryFn: () =>
      trpc.agents.list.query({
        siteId: scopeStore.currentSite ?? undefined,
        groupId: scopeStore.currentGroup ?? undefined,
      }),
    enabled: !!scopeStore.currentSite || !!scopeStore.currentGroup,
  }));

  const ticketsQuery = createQuery(() => ({
    queryKey: ['agents.listTickets', scopeStore.currentSite, scopeStore.currentGroup],
    queryFn: () =>
      trpc.agents.listTickets.query({
        siteId: scopeStore.currentSite ?? undefined,
        groupId: scopeStore.currentGroup ?? undefined,
      }),
    enabled: !!scopeStore.currentSite || !!scopeStore.currentGroup,
  }));

  const agentStats = $derived.by(() => {
    const rows = agentsQuery.data ?? [];
    const stale = rows.filter(
      (a) => !a.lastCheckinAt || NOW - new Date(a.lastCheckinAt).getTime() > 60 * 86_400_000
    ).length;
    return { total: rows.length, stale };
  });

  const ticketStats = $derived.by(() => {
    const rows = ticketsQuery.data ?? [];
    const recent = rows.filter(
      (t) => NOW - new Date(t.createdAt).getTime() < 7 * 86_400_000
    ).length;
    return { total: rows.length, recent };
  });

  function relativeTime(ts?: string | null) {
    if (!ts) return 'Never';
    const diff = NOW - new Date(ts).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function selectSite(row: LinkOverviewRow) {
    if (row.siteId) scopeStore.currentSite = row.siteId;
    goto('/mspagent');
  }
</script>

{#if scopeStore.currentSite}
  {#if agentsQuery.isLoading && ticketsQuery.isLoading}
    <Loader />
  {:else}
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
  {/if}
{:else}
  <GlobalLinksOverview
    rows={overviewRows}
    isLoading={overviewQuery.isPending}
    isPending={overviewQuery.isPending}
    vendorName="MSPAgent"
    totalLabel="Sites with Agents"
    {extraColumns}
    showFindingSummary={false}
    showFindingsColumn={false}
    showStatusColumn={false}
    showDispositionColumn={false}
    showNotesColumn={false}
    showIndicatorColumn={false}
    onrowclick={selectSite}
  />
{/if}
