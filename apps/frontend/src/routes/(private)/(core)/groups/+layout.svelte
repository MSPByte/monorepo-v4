<script lang="ts">
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children } = $props();

  const tabs = [
    { href: '/sites', label: 'Sites' },
    { href: '/groups', label: 'Groups' },
    { href: '/assets', label: 'Assets' },
  ];
</script>

<div class="flex size-full flex-col overflow-hidden">
  <UrlTabs {tabs} />
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
