<script lang="ts">
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children } = $props();
  const tabs = [
    { href: '/automation/runs', label: 'Runs' },
    { href: '/automation/packages', label: 'Packages' },
  ];
</script>

<div class="flex size-full flex-col overflow-hidden">
  <UrlTabs {tabs} />
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
