<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import AlertsTable from '$lib/components/alerts/alerts-table.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import type { createTrpcClient } from '$lib/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'sophos-partner', scopeStore.currentSite],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'sophos-partner',
        siteId: scopeStore.currentSite!,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'sophos-partner', 'all'],
    queryFn: () => trpc.integrationLinks.list.query({ integrationId: 'sophos-partner' }),
    enabled: !scopeStore.currentSite,
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    enabled: !scopeStore.currentSite,
  }));

  const currentLink = $derived(siteLinkQuery.data?.[0]?.id ?? null);

  const siteNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const site of sitesQuery.data ?? []) map.set(site.id, site.name);
    return map;
  });

  const links = $derived(
    (linksQuery.data ?? siteLinkQuery.data ?? []).map((link) => ({
      id: link.id,
      name: link.name ?? link.id,
      siteId: link.siteId,
      siteName: link.siteId ? (siteNameById.get(link.siteId) ?? null) : null,
    })),
  );
</script>

{#if siteLinkQuery.isLoading || linksQuery.isLoading || sitesQuery.isLoading}
  <Loader />
{:else if scopeStore.currentSite && !currentLink}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">No Sophos Partner integration for this site.</div>
  </div>
{:else}
  <div class="flex flex-col size-full p-4">
    <AlertsTable
      linkId={currentLink ?? undefined}
      integrationId="sophos-partner"
      {links}
      scopeColumn="site"
    />
  </div>
{/if}
