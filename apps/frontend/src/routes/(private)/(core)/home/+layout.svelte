<script lang="ts">
  import './workspace.css';
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children } = $props();

  const tabs = [
    { href: '/home', label: 'Dashboard', exact: true },
    { href: '/home/sites', label: 'Sites' },
  ];
</script>

<div class="flex flex-col size-full overflow-hidden">
  <div class="shrink-0 overflow-x-auto"><UrlTabs {tabs} /></div>
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
