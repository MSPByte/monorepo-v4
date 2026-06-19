<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { cn } from '$lib/utils';
  import { goto } from '$app/navigation';
  import type { createTrpcClient } from '$lib/trpc';
  import VendorInsightsPanel from '$lib/components/alerts/vendor-insights-panel.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import GlobalSitesOverview, {
    type GlobalOverviewExtraColumn,
    type GlobalOverviewRow,
  } from '../_GlobalSitesOverview.svelte';
  import { sophosEndpoints } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const NOW = Date.now();

  // ── Global overview ──────────────────────────────────────────────────────
  const overviewQuery = createQuery(() => ({
    queryKey: ['vendor.sophosSiteOverview'],
    queryFn: () => trpc.vendor.sophosSiteOverview.query(),
    enabled: !scopeStore.currentSite,
  }));

  // ── Per-site: resolve link ────────────────────────────────────────────────
  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'sophos-partner', scopeStore.currentSite],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'sophos-partner',
        siteId: scopeStore.currentSite!,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLink = $derived(siteLinkQuery.data?.[0]?.id ?? null);

  // ── Per-link: endpoint data ──────────────────────────────────────────────
  const endpointsQuery = createQuery(() => ({
    queryKey: ['vendor.tableData', 'sophos_endpoints', currentLink],
    queryFn: () =>
      trpc.vendor.tableData.query({
        table: 'sophos_endpoints',
        linkId: currentLink!,
        page: 1,
        pageSize: 1000,
      }),
    enabled: !!currentLink && !!scopeStore.currentSite,
  }));

  type EndpointRow = typeof sophosEndpoints.$inferSelect & Record<string, unknown>;

  const endpointStats = $derived.by(() => {
    const eps = (endpointsQuery.data?.rows ?? []) as EndpointRow[];
    return {
      total: eps.length,
      healthIssues: eps.filter((e) => e['health'] !== 'good').length,
      tamperDisabled: eps.filter((e) => !e['tamperProtectionEnabled']).length,
      needsUpgrade: eps.filter((e) => e['needsUpgrade']).length,
      stale60d: eps.filter(
        (e) =>
          !e['lastHeartbeatAt'] ||
          NOW - new Date(e['lastHeartbeatAt'] as string).getTime() > 60 * 86_400_000
      ).length,
    };
  });

  const overviewRows = $derived(overviewQuery.data ?? []);

  function selectSite(row: GlobalOverviewRow) {
    if (row.siteId) scopeStore.currentSite = row.siteId;
    goto('/sophos-partner');
  }

  function tierBadge(value: unknown) {
    const tier = typeof value === 'string' ? value : null;
    if (tier === 'MDR') return 'bg-primary/15 text-primary';
    if (tier === 'XDR') return 'bg-warning/20 text-warning';
    if (tier === 'Endpoint') return 'bg-success/15 text-success';
    return 'bg-muted text-muted-foreground';
  }

  const licenseTierColumns: GlobalOverviewExtraColumn[] = [
    {
      key: 'serverTier',
      label: 'Server',
      widthClass: 'w-28',
      badgeClass: tierBadge,
    },
    {
      key: 'endpointTier',
      label: 'Endpoint',
      widthClass: 'w-28',
      badgeClass: tierBadge,
    },
  ];

  function refreshSiteAlerts() {
    queryClient.invalidateQueries({
      queryKey: [
        'alerts.insightGroups',
        'sophos-partner',
        scopeStore.currentSite,
        currentLink,
        'active',
      ],
    });
    queryClient.invalidateQueries({ queryKey: ['alerts.insightGroupCounts', 'sophos-partner'] });
    queryClient.invalidateQueries({ queryKey: ['vendor.sophosSiteOverview'] });
  }

  const insightFilters = [
    {
      id: 'tamper',
      label: 'Tamper',
      definitionPrefixes: ['sophos.endpoint.tamper_protection'],
    },
    {
      id: 'stale-endpoints',
      label: 'Stale Endpoints',
      definitionPrefixes: ['sophos.endpoint.stale'],
    },
    {
      id: 'stale-firewalls',
      label: 'Stale Firewalls',
      definitionPrefixes: ['sophos.firewall.stale'],
    },
    {
      id: 'endpoint-updates',
      label: 'Endpoint Updates',
      definitionPrefixes: ['sophos.endpoint.needsUpdate'],
    },
    {
      id: 'firewall-updates',
      label: 'Firewall Updates',
      definitionPrefixes: ['sophos.firewall.needsUpdate'],
    },
  ];

  function moduleLabelForDefinition(definitionId: string) {
    if (definitionId === 'sophos.endpoint.tamper_protection') return 'Tamper';
    if (definitionId === 'sophos.endpoint.stale') return 'Stale Endpoint';
    if (definitionId === 'sophos.firewall.stale') return 'Stale Firewall';
    if (definitionId === 'sophos.endpoint.needsUpdate') return 'Endpoint Update';
    if (definitionId === 'sophos.firewall.needsUpdate') return 'Firewall Update';
    return 'Other';
  }
</script>

{#if scopeStore.currentSite}
  <!-- ── Per-site dashboard ────────────────────────────────────────────── -->
  {#if siteLinkQuery.isLoading}
    <Loader />
  {:else if !currentLink}
    <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
      <div class="text-sm font-medium">No Sophos Partner integration for this site.</div>
    </div>
  {:else}
    <FadeIn class="flex flex-col size-full overflow-hidden">
      <div class="flex items-center gap-5 px-4 py-2.5 border-b shrink-0 flex-wrap">
        <div class="flex flex-col gap-0.5">
          <div class="flex items-baseline gap-1.5">
            <span class="text-lg font-semibold tabular-nums">
              {endpointsQuery.isLoading ? '—' : endpointStats.total}
            </span>
            <span class="text-xs text-muted-foreground">Endpoints</span>
          </div>
        </div>

        <div class="w-px h-8 bg-border shrink-0"></div>

        <div class="flex flex-col gap-0.5">
          <div class="flex items-baseline gap-1.5">
            <span
              class={cn(
                'text-lg font-semibold tabular-nums',
                endpointStats.healthIssues > 0 && 'text-destructive'
              )}
            >
              {endpointsQuery.isLoading ? '—' : endpointStats.healthIssues}
            </span>
            <span class="text-xs text-muted-foreground">Health Issues</span>
          </div>
        </div>

        <div class="w-px h-8 bg-border shrink-0"></div>

        <div class="flex flex-col gap-0.5">
          <div class="flex items-baseline gap-1.5">
            <span
              class={cn(
                'text-lg font-semibold tabular-nums',
                endpointStats.tamperDisabled > 0 && 'text-destructive'
              )}
            >
              {endpointsQuery.isLoading ? '—' : endpointStats.tamperDisabled}
            </span>
            <span class="text-xs text-muted-foreground">Tamper Disabled</span>
          </div>
          <span class="text-[11px] text-muted-foreground">AV unprotected</span>
        </div>

        <div class="w-px h-8 bg-border shrink-0"></div>

        <div class="flex flex-col gap-0.5">
          <div class="flex items-baseline gap-1.5">
            <span
              class={cn(
                'text-lg font-semibold tabular-nums',
                endpointStats.needsUpgrade > 0 && 'text-warning'
              )}
            >
              {endpointsQuery.isLoading ? '—' : endpointStats.needsUpgrade}
            </span>
            <span class="text-xs text-muted-foreground">Needs Upgrade</span>
          </div>
          <span class="text-[11px] text-muted-foreground">outdated agent</span>
        </div>

        <div class="w-px h-8 bg-border shrink-0"></div>

        <div class="flex flex-col gap-0.5">
          <div class="flex items-baseline gap-1.5">
            <span
              class={cn(
                'text-lg font-semibold tabular-nums',
                endpointStats.stale60d > 0 && 'text-muted-foreground'
              )}
            >
              {endpointsQuery.isLoading ? '—' : endpointStats.stale60d}
            </span>
            <span class="text-xs text-muted-foreground">Stale 60d</span>
          </div>
          <span class="text-[11px] text-muted-foreground">no heartbeat</span>
        </div>
      </div>

      <FadeIn class="flex-1 overflow-hidden">
        <VendorInsightsPanel
          integrationId="sophos-partner"
          siteId={scopeStore.currentSite}
          linkId={currentLink}
          alertsHref="/sophos-partner/alerts"
          filters={insightFilters}
          entityHeading="Endpoint"
          {moduleLabelForDefinition}
          onalertchange={refreshSiteAlerts}
        />
      </FadeIn>
    </FadeIn>
  {/if}
{:else}
  <!-- ── Global sites overview ──────────────────────────────────────────── -->
  <GlobalSitesOverview
    rows={overviewRows}
    isLoading={overviewQuery.isLoading}
    isPending={overviewQuery.isPending}
    vendorName="Sophos Partner"
    extraColumns={licenseTierColumns}
    onrowclick={selectSite}
  />
{/if}
