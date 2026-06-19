<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorInsightsPanel from '$lib/components/alerts/vendor-insights-panel.svelte';
  import { goto } from '$app/navigation';
  import type { createTrpcClient } from '$lib/trpc';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import GlobalSitesOverview, {
    type GlobalOverviewRow,
  } from '../_GlobalSitesOverview.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  // ── Global overview ──────────────────────────────────────────────────────
  const overviewQuery = createQuery(() => ({
    queryKey: ['vendor.coveSiteOverview'],
    queryFn: () => trpc.vendor.coveSiteOverview.query(),
    enabled: !scopeStore.currentSite,
  }));

  // ── Per-site: find the link for this site ────────────────────────────────
  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'cove', scopeStore.currentSite],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'cove',
        siteId: scopeStore.currentSite!,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLink = $derived(siteLinkQuery.data?.[0]?.id ?? null);

  function refreshSiteAlerts() {
    queryClient.invalidateQueries({
      queryKey: ['alerts.insightGroups', 'cove', scopeStore.currentSite, currentLink, 'active'],
    });
    queryClient.invalidateQueries({ queryKey: ['alerts.insightGroupCounts', 'cove'] });
    queryClient.invalidateQueries({ queryKey: ['vendor.coveSiteOverview'] });
  }

  const overviewRows = $derived(overviewQuery.data ?? []);

  function selectSite(row: GlobalOverviewRow) {
    if (row.siteId) scopeStore.currentSite = row.siteId;
    goto('/cove');
  }

  const insightFilters = [
    { id: 'errors', label: 'Errors', definitionPrefixes: ['cove.endpoint.errors'] },
    { id: 'stale', label: 'Stale backup', definitionPrefixes: ['cove.endpoint.lastSuccessStale'] },
  ];

  function moduleLabelForDefinition(definitionId: string) {
    if (definitionId === 'cove.endpoint.errors') return 'Errors';
    if (definitionId === 'cove.endpoint.lastSuccessStale') return 'Stale Backup';
    return 'Other';
  }
</script>

{#if scopeStore.currentSite}
  <!-- ── Per-site dashboard ────────────────────────────────────────────── -->
  {#if siteLinkQuery.isLoading}
    <Loader />
  {:else if !currentLink}
    <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
      <div class="text-sm font-medium">No Cove integration for this site.</div>
    </div>
  {:else}
    <FadeIn class="flex-1 overflow-hidden">
      <VendorInsightsPanel
        integrationId="cove"
        siteId={scopeStore.currentSite}
        linkId={currentLink}
        alertsHref="/cove/alerts"
        filters={insightFilters}
        entityHeading="Endpoint"
        {moduleLabelForDefinition}
        onalertchange={refreshSiteAlerts}
      />
    </FadeIn>
  {/if}
{:else}
  <!-- ── Global sites overview ──────────────────────────────────────────── -->
  <GlobalSitesOverview
    rows={overviewRows}
    isLoading={overviewQuery.isLoading}
    isPending={overviewQuery.isPending}
    vendorName="Cove"
    onrowclick={selectSite}
  />
{/if}
