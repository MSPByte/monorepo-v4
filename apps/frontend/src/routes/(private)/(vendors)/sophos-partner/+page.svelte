<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import { cn } from '$lib/utils';
  import InsightsPanel from './_InsightsPanel.svelte';
  import GlobalLinksOverview, {
    type LinkOverviewRow,
    type LinkOverviewExtraColumn,
  } from '../_GlobalLinksOverview.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const NOW = Date.now();

  const overviewQuery = createQuery(() => ({
    queryKey: ['vendor.linkOverview', 'sophos-partner'],
    queryFn: () => trpc.vendor.linkOverview.query({ integrationId: 'sophos-partner' }),
    enabled: !scopeStore.currentSite,
  }));

  const licenseTiersQuery = createQuery(() => ({
    queryKey: ['vendor.sophosLicenseTiers'],
    queryFn: () => trpc.vendor.sophosLicenseTiers.query(),
    enabled: !scopeStore.currentSite,
  }));

  const tiersByLink = $derived.by(() => {
    const map = new Map<string, { serverTier: string | null; endpointTier: string | null }>();
    for (const row of licenseTiersQuery.data ?? []) {
      map.set(row.linkId, { serverTier: row.serverTier, endpointTier: row.endpointTier });
    }
    return map;
  });

  function tierBadge(value: unknown) {
    if (value === 'MDR') return 'bg-primary/15 text-primary';
    if (value === 'XDR') return 'bg-warning/20 text-warning';
    if (value === 'Endpoint') return 'bg-success/15 text-success';
    return 'bg-muted text-muted-foreground';
  }

  const licenseTierColumns: LinkOverviewExtraColumn[] = [
    {
      key: 'serverTier',
      label: 'Server',
      widthClass: 'w-28',
      value: (row) => tiersByLink.get(row.linkId)?.serverTier ?? null,
      badgeClass: tierBadge,
    },
    {
      key: 'endpointTier',
      label: 'Endpoint',
      widthClass: 'w-28',
      value: (row) => tiersByLink.get(row.linkId)?.endpointTier ?? null,
      badgeClass: tierBadge,
    },
  ];

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

  type EndpointRow = Record<string, unknown>;

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

  const overviewRows = $derived((overviewQuery.data ?? []) as LinkOverviewRow[]);

  function selectSite(row: LinkOverviewRow) {
    if (row.siteId) scopeStore.currentSite = row.siteId;
    goto('/sophos-partner');
  }
</script>

{#if scopeStore.currentSite}
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
        <InsightsPanel linkId={currentLink} />
      </FadeIn>
    </FadeIn>
  {/if}
{:else}
  <GlobalLinksOverview
    rows={overviewRows}
    isLoading={overviewQuery.isPending}
    isPending={overviewQuery.isPending}
    vendorName="Sophos Partner"
    extraColumns={licenseTierColumns}
    onrowclick={selectSite}
  />
{/if}
