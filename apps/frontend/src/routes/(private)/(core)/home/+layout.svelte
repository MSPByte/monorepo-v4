<script lang="ts">
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children } = $props();

  const tabs = [
    { href: '/home', label: 'Briefing', exact: true },
    { href: '/home/findings', label: 'Findings' },
    { href: '/home/sites', label: 'Sites' }
  ];
</script>

<div class="flex flex-col size-full overflow-hidden">
  <UrlTabs {tabs} />
  <div class="flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
