<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import GlobalLinksOverview, { type LinkOverviewRow } from '../_GlobalLinksOverview.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const NOW = Date.now();

  const overviewQuery = createQuery(() => ({
    queryKey: ['vendor.linkOverview', 'dattormm'],
    queryFn: () => trpc.vendor.linkOverview.query({ integrationId: 'dattormm' }),
    enabled: !scopeStore.currentSite,
  }));

  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'dattormm', scopeStore.currentSite],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'dattormm',
        siteId: scopeStore.currentSite!,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLink = $derived(siteLinkQuery.data?.[0]?.id ?? null);

  const endpointsQuery = createQuery(() => ({
    queryKey: ['vendor.tableData', 'datto_endpoints', currentLink],
    queryFn: () =>
      trpc.vendor.tableData.query({
        table: 'datto_endpoints',
        linkId: currentLink!,
        page: 1,
        pageSize: 1000,
      }),
    enabled: !!currentLink && !!scopeStore.currentSite,
  }));

  type EndpointRow = Record<string, unknown>;

  const endpointStats = $derived.by(() => {
    const eps = (endpointsQuery.data?.rows ?? []) as EndpointRow[];
    return {
      total: eps.length,
      offline: eps.filter((e) => !e['online']).length,
      stale60d: eps.filter(
        (e) =>
          !e['lastHeartbeatAt'] ||
          NOW - new Date(e['lastHeartbeatAt'] as string).getTime() > 60 * 86_400_000
      ).length,
    };
  });

  const overviewRows = $derived((overviewQuery.data ?? []) as LinkOverviewRow[]);

  function selectSite(row: LinkOverviewRow) {
    if (row.siteId) scopeStore.currentSite = row.siteId;
    goto('/dattormm');
  }
</script>

{#if scopeStore.currentSite}
  {#if siteLinkQuery.isLoading}
    <Loader />
  {:else if !currentLink}
    <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
      <div class="text-sm font-medium">No DattoRMM integration for this site.</div>
    </div>
  {:else}
    <div class="flex flex-col size-full overflow-y-auto p-4 gap-4">
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Total Endpoints
          </div>
          <div class="text-3xl font-bold tabular-nums">
            {endpointsQuery.isLoading ? '—' : endpointStats.total}
          </div>
        </div>
        <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Offline
          </div>
          <div
            class="text-3xl font-bold tabular-nums {endpointStats.offline > 0
              ? 'text-destructive'
              : ''}"
          >
            {endpointsQuery.isLoading ? '—' : endpointStats.offline}
          </div>
          <div class="text-xs text-muted-foreground">currently unreachable</div>
        </div>
        <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Stale (60d)
          </div>
          <div
            class="text-3xl font-bold tabular-nums {endpointStats.stale60d > 0
              ? 'text-warning'
              : ''}"
          >
            {endpointsQuery.isLoading ? '—' : endpointStats.stale60d}
          </div>
          <div class="text-xs text-muted-foreground">no heartbeat</div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <a
          href="/dattormm/endpoints"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm font-medium hover:bg-accent transition-colors"
        >
          Endpoints →
        </a>
      </div>
    </div>
  {/if}
{:else}
  <GlobalLinksOverview
    rows={overviewRows}
    isLoading={overviewQuery.isPending}
    isPending={overviewQuery.isPending}
    vendorName="DattoRMM"
    totalLabel="Total Sites"
    showFindingSummary={false}
    showFindingsColumn={false}
    showStatusColumn={false}
    onrowclick={selectSite}
  />
{/if}
