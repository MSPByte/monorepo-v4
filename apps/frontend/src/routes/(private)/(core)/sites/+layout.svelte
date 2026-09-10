<script lang="ts">
  import './workspace.css';
  import UrlTabs from './_components/site-tabs.svelte';

  const { children } = $props();

  const tabs = [
    { href: '/sites', label: 'Sites' },
    { href: '/groups', label: 'Groups' },
    { href: '/assets', label: 'Assets' },
    { href: '/wiki', label: 'Wiki' },
  ];
</script>

<div class="sites-workspace flex size-full flex-col overflow-hidden">
  <UrlTabs {tabs} label="Workspace" />
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
