<script lang="ts">
  import { setContext } from 'svelte';
  import type { LayoutProps } from './$types';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { createTrpcClient } from '$lib/trpc';
  import { Aperture, Search } from '@lucide/svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';

  import NavPill from './_layout/nav-pill.svelte';
  import ScopeChip from './_layout/scope-chip.svelte';
  import SetupMenu from './_layout/setup-menu.svelte';
  import CommandPalette from './_layout/command-palette.svelte';
  import UserAccount from './_layout/user-account.svelte';
  import { flattenRoutes } from '$lib/config/routes';

  const { data, children }: LayoutProps = $props();

  const trpc = createTrpcClient();
  setContext('trpc', trpc);

  const routeMap = new Map(data.routeGroups);
  const topRoutes = $derived(routeMap.get('top') ?? []);
  const setupRoutes = $derived(routeMap.get('Setup') ?? []);
  // Command palette wants leaf routes; expand grouped children so every page
  // remains discoverable via ⌘J even though the top nav collapses them.
  const allRoutes = $derived(flattenRoutes([...routeMap.values()].flat()));

  let paletteOpen = $state(false);

  const integrationsQuery = createQuery(() => ({
    queryKey: ['integrations.list'],
    queryFn: () => trpc.integrations.list.query(),
    enabled: !!data.orgId,
  }));

  $effect(() => {
    authStore.currentUser = data.user;
    authStore.currentRole = data.role;
    authStore.currentGrants = data.grants;
    authStore.currentOrg = data.orgId;
    authStore.currentOrgDev = data.orgDev;
  });

  $effect(() => {
    if (!integrationsQuery.isLoading && integrationsQuery.data) {
      scopeStore.activeIntegrations = integrationsQuery.data.filter((i) => !i.deletedAt);
    }
  });
</script>

<CommandPalette routes={allRoutes} bind:open={paletteOpen} />

<div class="flex flex-col size-full">
  <header class="flex h-14 w-full items-center justify-between px-4 border-b border-border/60">
    <div class="flex items-center gap-4">
      <a href="/home" class="inline-flex items-center" aria-label="Home">
        <Aperture class="size-7" />
      </a>
      <NavPill routes={topRoutes} />
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => (paletteOpen = true)}
        aria-label="Jump to (Ctrl+J)"
        class="hidden md:inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-full border border-border/60 bg-muted/50 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Search class="size-3.5" />
        <span>Jump to</span>
        <kbd
          class="ml-2 inline-flex items-center rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
        >
          ⌘J
        </kbd>
      </button>
      <ScopeChip />
      {#if setupRoutes.length > 0}
        <SetupMenu routes={setupRoutes} />
      {/if}
      <div class="pl-1">
        <UserAccount orgId={data.orgId} orgName={data.orgName} />
      </div>
    </div>
  </header>

  <div class="flex flex-col relative size-full overflow-hidden">
    {@render children()}
  </div>
</div>
