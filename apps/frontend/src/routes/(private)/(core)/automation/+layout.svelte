<script lang="ts">
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children } = $props();
  const tabs = [
    { href: '/automation/packages', label: 'Packages' },
    { href: '/automation/runs', label: 'Package Runs' },
    { href: '/automation/schedules', label: 'Schedules' },
    { href: '/automation/fact-rules', label: 'Fact Rules' },
  ];
</script>

<div class="flex size-full flex-col overflow-hidden">
  <UrlTabs {tabs} />
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
