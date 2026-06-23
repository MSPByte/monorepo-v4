<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import InsightsPanel from './_InsightsPanel.svelte';
  import GlobalLinksOverview, { type LinkOverviewRow } from '../_GlobalLinksOverview.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const overviewQuery = createQuery(() => ({
    queryKey: ['vendor.linkOverview', 'cove'],
    queryFn: () => trpc.vendor.linkOverview.query({ integrationId: 'cove' }),
    enabled: !scopeStore.currentSite,
  }));

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
  const overviewRows = $derived((overviewQuery.data ?? []) as LinkOverviewRow[]);

  function selectSite(row: LinkOverviewRow) {
    if (row.siteId) scopeStore.currentSite = row.siteId;
    goto('/cove');
  }
</script>

{#if scopeStore.currentSite}
  {#if siteLinkQuery.isLoading}
    <Loader />
  {:else if !currentLink}
    <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
      <div class="text-sm font-medium">No Cove integration for this site.</div>
    </div>
  {:else}
    <FadeIn class="flex-1 overflow-hidden size-full">
      <InsightsPanel linkId={currentLink} />
    </FadeIn>
  {/if}
{:else}
  <GlobalLinksOverview
    rows={overviewRows}
    isLoading={overviewQuery.isPending}
    isPending={overviewQuery.isPending}
    vendorName="Cove"
    onrowclick={selectSite}
  />
{/if}
