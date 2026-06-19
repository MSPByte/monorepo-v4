<script lang="ts">
  import UrlTabs from '$lib/components/url-tabs.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';

  const { children } = $props();

  const tabs = [
    { href: '/setup/users', label: 'Users' },
    { href: '/setup/roles', label: 'Roles' },
    { href: '/setup/integrations', label: 'Integrations' },
    { href: '/setup/audit', label: 'Audit', disabled: () => !authStore.isAllowed('Global.Admin') },
  ];
</script>

<div class="flex flex-col size-full overflow-hidden">
  <UrlTabs {tabs} />
  <div class="flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
