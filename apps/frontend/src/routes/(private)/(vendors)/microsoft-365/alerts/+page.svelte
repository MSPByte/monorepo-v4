<script lang="ts">
  import AlertsTable from "$lib/components/alerts/alerts-table.svelte";
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
    import Loader from "$lib/components/transition/loader.svelte";

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  // ── Global overview ──────────────────────────────────────────────────────
  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'microsoft-365', 'all'],
    queryFn: () =>
      trpc.integrationLinks.list.query({ integrationId: 'microsoft-365' }),
    enabled: !scopeStore.currentLink,
  }));
</script>

{#if linksQuery.isLoading}
  <Loader />
{:else}
<div class="flex flex-col size-full p-4">
  <AlertsTable
    linkId={scopeStore.currentLink || undefined}
    integrationId="microsoft-365"
    links={(linksQuery.data || []).map((l) => ({ id: l.id, name: l.name! }))}
  />
</div>
{/if}
