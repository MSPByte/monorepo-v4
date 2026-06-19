<script lang="ts">
  import { type LayoutProps } from './$types';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { MSPAGENT_CONFIG } from '@mspbyte/shared';
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children }: LayoutProps = $props();

  const tabs = [
    { label: 'Overview', href: '/mspagent', exact: true },
    ...MSPAGENT_CONFIG.navigation.map((n) => ({
      label: n.label,
      href: `/mspagent${n.route}`,
      disabled: () => n.isNullable && !scopeStore.currentSite,
    })),
  ];
</script>

<div class="flex flex-col size-full overflow-hidden">
  <UrlTabs {tabs} />
  <div class="flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
