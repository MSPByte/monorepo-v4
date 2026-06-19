<script lang="ts">
  import SingleSelect from '$lib/components/single-select.svelte';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { ProviderId } from '@mspbyte/shared';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  const integrationIds = new Set(Object.keys(INTEGRATIONS) as ProviderId[]);

  const options = $derived(
    scopeStore.activeIntegrations
      .filter((a) => INTEGRATIONS[a.id as ProviderId]?.navigation?.length > 0)
      .map((i) => {
        const integration = INTEGRATIONS[i.id as ProviderId];
        return { label: integration.name, value: i.id };
      })
  );

  const handleChange = (v: string) => {
    if (v) {
      scopeStore.currentIntegration = v as ProviderId;
      goto(`/${v}`);
    } else {
      scopeStore.currentIntegration = null;
      goto('/home');
    }
  };

  const getRouteIntegration = (pathname: string) => {
    const urlPart = pathname.split('/')[1] as ProviderId | undefined;

    return urlPart && integrationIds.has(urlPart) ? urlPart : null;
  };

  const syncIntegrationFromPath = (pathname: string) => {
    scopeStore.currentIntegration = getRouteIntegration(pathname);
  };

  $effect(() => {
    syncIntegrationFromPath(page.url.pathname);
  });
</script>

<div class="w-44">
  <SingleSelect
    placeholder="Select Integration"
    searchPlaceholder="Search Integrations"
    {options}
    bind:selected={scopeStore.currentIntegration as string | undefined}
    onchange={handleChange}
  />
</div>
