<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import type { createTrpcClient } from '$lib/trpc';
  import GlobalSitesOverview, {
    type GlobalOverviewExtraColumn,
    type GlobalOverviewRow,
  } from '../_GlobalSitesOverview.svelte';
  import { dattoEndpoints } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const NOW = Date.now();

  // ── Global overview ──────────────────────────────────────────────────────
  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    enabled: !scopeStore.currentSite,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'dattormm', 'active'],
    queryFn: () =>
      trpc.integrationLinks.list.query({ integrationId: 'dattormm', status: 'active' }),
    enabled: !scopeStore.currentSite,
  }));

  // ── Per-site: resolve link ────────────────────────────────────────────────
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

  // ── Per-link: endpoint overview data ────────────────────────────────────
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

  type EndpointRow = typeof dattoEndpoints.$inferSelect & Record<string, unknown>;

  const endpointStats = $derived.by(() => {
    const eps = (endpointsQuery.data?.rows ?? []) as EndpointRow[];
    return {
      total: eps.length,
      offline: eps.filter((e) => !e['online']).length,
      stale60d: eps.filter(
        (e) => !e['last_heartbeat_at'] || NOW - Number(e['last_heartbeat_at']) > 60 * 86_400_000
      ).length,
    };
  });

  const siteNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const site of sitesQuery.data ?? []) map.set(site.id, site.name);
    return map;
  });

  const links = $derived(linksQuery.data ?? []);

  const overviewRows: GlobalOverviewRow[] = $derived(
    links.map((link) => ({
      linkId: link.id,
      siteId: link.siteId,
      siteName:
        (link.siteId ? siteNameById.get(link.siteId) : null) ??
        link.name ??
        link.externalId ??
        link.id,
      linkName: link.name,
      externalId: link.externalId,
      updatedAt: link.updatedAt,
      status: 'Active',
      alertCount: 0,
      highestSeverity: null,
    }))
  );

  function selectSite(row: GlobalOverviewRow) {
    if (row.siteId) scopeStore.currentSite = row.siteId;
    goto('/dattormm');
  }
</script>

{#if scopeStore.currentSite}
  <!-- ── Per-site dashboard ────────────────────────────────────────────── -->
  {#if siteLinkQuery.isLoading}
    <div class="flex items-center justify-center size-full text-sm text-muted-foreground">
      Loading…
    </div>
  {:else if !currentLink}
    <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
      <div class="text-sm font-medium">No DattoRMM integration for this site.</div>
    </div>
  {:else}
    <div class="flex flex-col size-full overflow-y-auto p-4 gap-4">
      <!-- KPI strip -->
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

      <!-- Quick links -->
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
  <!-- ── Global sites overview ──────────────────────────────────────────── -->
  <GlobalSitesOverview
    rows={overviewRows}
    isLoading={linksQuery.isLoading}
    isPending={linksQuery.isPending}
    vendorName="DattoRMM"
    totalLabel="Total Sites"
    emptyEntityLabel="sites"
    onrowclick={selectSite}
  />
{/if}
