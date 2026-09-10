<script lang="ts">
  import './workspace.css';
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children } = $props();

  const tabs = [
    { href: '/policies', label: 'Policies' },
    { href: '/frameworks', label: 'Frameworks' },
  ];
</script>

<div class="framework-workspace flex size-full flex-col overflow-hidden">
  <UrlTabs {tabs} />
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
