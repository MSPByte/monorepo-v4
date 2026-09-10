<script lang="ts">
  import './workspace.css';
  import UrlTabs from '$lib/components/url-tabs.svelte';

  const { children } = $props();
  const tabs = [
    { href: '/automation/packages', label: 'Packages' },
    { href: '/automation/runs', label: 'Run history' },
    { href: '/automation/schedules', label: 'Schedules' },
    { href: '/automation/fact-rules', label: 'Fact rules' },
  ];
</script>

<div class="flex size-full flex-col overflow-hidden">
  <div class="shrink-0 overflow-x-auto"><UrlTabs {tabs} /></div>
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
