<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorFindingsTable from '../../_VendorFindingsTable.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'cove', scopeStore.currentSite, scopeStore.currentGroup],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'cove',
        siteId: scopeStore.currentSite!,
        groupId: scopeStore.currentGroup ?? undefined,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLink = $derived(siteLinkQuery.data?.[0]?.id ?? null);
</script>

<div class="flex flex-col size-full p-4">
  <VendorFindingsTable
    linkId={currentLink}
    groupId={scopeStore.currentGroup}
    providerId="cove"
    showLinkColumn={!scopeStore.currentSite && !scopeStore.currentGroup}
    showSiteColumn={!scopeStore.currentSite}
  />
</div>
