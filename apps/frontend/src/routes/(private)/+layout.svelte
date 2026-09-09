<script lang="ts">
  import { setContext } from 'svelte';
  import type { LayoutProps } from './$types';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { createTrpcClient } from '$lib/trpc';
  import { Aperture, Search, ChevronRight } from '@lucide/svelte';
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

<div class="byte-shell">
  <header class="byte-header">
    <div class="byte-header-top">
      <a href="/home" class="byte-brand" aria-label="MSPByte home"
        ><span class="byte-brand-mark"><Aperture size={23} strokeWidth={1.6} /></span><span
          >MSP<span class="byte-brand-emphasis">Byte</span><span class="byte-brand-period">.</span
          ></span
        ></a
      >
      <div class="byte-workspace">
        <span class="byte-header-divider"></span><ChevronRight size={12} /><span
          >{data.orgName || 'Workspace'}</span
        >
      </div>
      <button
        type="button"
        class="byte-search"
        onclick={() => paletteOpen = true}
        aria-label="Search pages and commands (Ctrl or Command J)"
        ><Search size={15} /><span>Search pages and commands</span><kbd>⌘ / Ctrl J</kbd></button
      >
      <div class="byte-actions"><ScopeChip />
        {#if setupRoutes.length > 0}<SetupMenu routes={setupRoutes} />{/if}
        <UserAccount orgId={data.orgId} orgName={data.orgName} /></div>
    </div>
    <div class="byte-header-nav">
      <nav aria-label="Main navigation"><NavPill routes={topRoutes} /></nav>
      <span class="byte-workspace-label">YOUR OPERATIONS, CONNECTED</span>
    </div>
  </header>
  <main class="byte-main" id="main-content">{@render children()}</main>
</div>

<style>
  .byte-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--background);
  }
  .byte-header {
    flex-shrink: 0;
    color: #cadbe1;
    background: #112a33;
    border-bottom: 1px solid #28434e;
  }
  .byte-header-top {
    display: flex;
    align-items: center;
    gap: 18px;
    min-height: 64px;
    padding: 12px 28px;
  }
  .byte-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 24px;
    line-height: 1;
    letter-spacing: -1.2px;
    font-weight: 400;
    color: #f0f7f8;
    flex-shrink: 0;
  }
  .byte-brand-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    color: #73e6c5;
    border: 1px solid #447164;
    background: #1d403e;
    border-radius: 10px;
  }
  .byte-brand-emphasis {
    font-weight: 650;
  }
  .byte-brand-period {
    color: #73e6c5;
  }
  .byte-workspace {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 12px;
    min-width: 0;
  }
  .byte-workspace > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 190px;
  }
  .byte-header-divider {
    height: 22px;
    width: 1px;
    background: #35505a;
    margin-right: 4px;
  }
  .byte-search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border: 1px solid #3b535d;
    border-radius: 8px;
    color: #b4cbd5;
    font-size: 11px;
    margin-left: auto;
    min-width: 240px;
    background: #1b3540;
    transition: background 0.15s;
  }
  .byte-search:hover {
    background: #25444f;
    color: #fff;
  }
  .byte-search kbd {
    margin-left: auto;
    padding: 1px 4px;
    border: 1px solid #4b6570;
    border-radius: 3px;
    font-size: 9px;
  }
  .byte-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    --foreground: #e7f0f4;
    --muted-foreground: #b4cad4;
    --background: #112a33;
    --accent: #284752;
    --accent-foreground: #ffffff;
    --border: #395561;
    --muted: #203c47;
  }
  .byte-header-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    min-height: 45px;
    padding: 0 28px;
    border-top: 1px solid #ffffff0c;
  }
  nav {
    min-width: 0;
  }
  .byte-workspace-label {
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.14em;
    color: #8cabb7;
    white-space: nowrap;
  }
  .byte-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    position: relative;
    min-height: 0;
    overflow: hidden;
  }
  :is(a, button):focus-visible {
    outline: 2px solid #73e6c5;
    outline-offset: 4px;
  }
  @media (max-width: 1100px) {
    .byte-workspace {
      display: none;
    }
    .byte-workspace-label {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .byte-header-top {
      padding: 12px 16px;
      gap: 10px;
      flex-wrap: wrap;
    }
    .byte-search {
      min-width: 0;
      padding: 9px;
    }
    .byte-search span,
    .byte-search kbd {
      display: none;
    }
    .byte-actions {
      gap: 4px;
    }
    .byte-brand {
      font-size: 21px;
    }
    .byte-brand-mark {
      width: 29px;
      height: 29px;
    }
    .byte-header-nav {
      padding: 0 12px;
    }
    nav {
      width: 100%;
    }
  }
  @media (max-width: 420px) {
    .byte-header-top {
      gap: 8px;
    }
    .byte-brand {
      gap: 7px;
      font-size: 19px;
    }
    .byte-actions {
      margin-left: auto;
    }
  }
</style>
