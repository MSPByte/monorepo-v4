<script lang="ts">
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import type { LayoutProps } from './$types';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { buildRouteMap } from '$lib/config/routes';
  import { createTrpcClient } from '$lib/trpc';
  import { Aperture, ChevronDown } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import Separator from '$lib/components/ui/separator/separator.svelte';

  import UserAccount from './_layout/user-account.svelte';

  const { data, children }: LayoutProps = $props();

  const trpc = createTrpcClient();
  setContext('trpc', trpc);

  const routeMap = buildRouteMap();
  const linkClass =
    'inline-flex items-center h-9 px-4 py-2 rounded-full text-sm font-medium transition-colors hover:cursor-pointer hover:bg-accent hover:text-accent-foreground';

  let openGroup = $state<string | null>(null);

  $effect(() => {
    authStore.currentUser = data.user;
    authStore.currentRole = data.role;
    authStore.currentOrg = data.orgId;
  });
</script>

{#snippet navLink({ href, label }: { href: string; label: string })}
  {@const active = page.url.pathname.startsWith(href)}
  <a {href} class={cn(linkClass, active && 'bg-primary/50')}>{label}</a>
{/snippet}

{#if openGroup !== null}
  <div class="fixed inset-0 z-10" onclick={() => (openGroup = null)} aria-hidden="true"></div>
{/if}

<div class="flex flex-col size-full">
  <div class="flex h-fit min-h-14 w-full items-center justify-between border-b">
    <div class="flex w-fit h-full gap-2 items-center p-2">
      <a href="/home"><Aperture class="w-8 h-8" /></a>
      <Separator orientation="vertical" />
      <div class="flex rounded-full p-1 bg-background/320 border gap-1">
        {#each routeMap.entries() as [group, routes]}
          {#if group === 'top'}
            {#each routes as route}
              {#if authStore.isAllowed(route.permission) && (route.devOnly ? authStore.isDev() : true)}
                {@render navLink({ href: route.href, label: route.label })}
              {/if}
            {/each}
          {:else}
            {@const groupActive = routes.some((route) => page.url.pathname.startsWith(route.href))}
            <div class="relative z-20">
              <button
                type="button"
                class={cn(linkClass, 'gap-1', groupActive && 'bg-primary/50')}
                onclick={() => (openGroup = openGroup === group ? null : group)}
              >
                {group}
                <ChevronDown
                  class={cn('size-4 transition-transform', openGroup === group && 'rotate-180')}
                />
              </button>
              {#if openGroup === group}
                <div
                  class="absolute top-full left-0 mt-1 min-w-36 rounded-2xl p-2 border bg-background shadow-md flex flex-col gap-1"
                >
                  {#each routes as route}
                    {#if authStore.isAllowed(route.permission) && (route.devOnly ? authStore.isDev() : true)}
                      {@const active = page.url.pathname.startsWith(route.href)}
                      <a
                        href={route.href}
                        class={cn(linkClass, 'w-full rounded-full', active && 'bg-primary/50')}
                        onclick={() => (openGroup = null)}
                      >
                        {route.label}
                      </a>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
    <div class="flex h-full px-2 items-center gap-1">
      <UserAccount orgId={data.orgId} orgName={data.orgName} />
    </div>
  </div>
  <div class="flex flex-col relative size-full overflow-hidden">
    {@render children()}
  </div>
</div>
