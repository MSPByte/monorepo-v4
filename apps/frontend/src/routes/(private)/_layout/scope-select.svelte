<script lang="ts">
  import { getContext } from 'svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const currentIntegration = $derived(scopeStore.currentIntegration);
  const currentScope = $derived(scopeStore.currentScope);

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list', currentIntegration],
    queryFn: () => trpc.sites.list.query(),
    enabled: currentScope === 'site' && !!currentIntegration,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', currentIntegration],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: currentIntegration ?? undefined,
        status: 'active',
      }),
    enabled: currentScope === 'link' && !!currentIntegration,
  }));

  const siteOptions = $derived.by(() =>
    (sitesQuery.data ?? []).map((s) => ({ label: s.name, value: s.id }))
  );

  const linkOptions = $derived.by(() =>
    (linksQuery.data ?? []).map((l) => ({
      label: l.name ?? l.externalId ?? '',
      value: l.id,
    }))
  );
</script>

{#if !currentScope}
  <div class="w-56">
    <SingleSelect placeholder="Select Scope..." options={[]} disabled />
  </div>
{:else if currentScope === 'site'}
  <div class="w-56">
    <SingleSelect
      placeholder="Select Site..."
      searchPlaceholder="Search Sites"
      options={siteOptions}
      bind:selected={scopeStore.currentSite as string | undefined}
      loading={sitesQuery.isLoading}
    />
  </div>
{:else if currentScope === 'link'}
  <div class="w-56">
    <SingleSelect
      placeholder="Select Tenant..."
      searchPlaceholder="Search Tenants"
      options={linkOptions}
      bind:selected={scopeStore.currentLink as string | undefined}
      loading={linksQuery.isLoading}
    />
  </div>
{/if}
