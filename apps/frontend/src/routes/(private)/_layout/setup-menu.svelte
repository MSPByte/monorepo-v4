<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Settings } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { cn } from '$lib/utils';
  import type { Route } from '$lib/config/routes';

  let { routes }: { routes: Route[] } = $props();

  const groupActive = $derived(
    routes.some((r) => page.url.pathname.startsWith(r.href)),
  );
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        aria-label="Setup"
        class={cn(
          'inline-flex items-center justify-center size-9 rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          groupActive && 'bg-accent text-foreground',
        )}
      >
        <Settings class="size-4" />
      </button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-40">
    <DropdownMenu.Label class="text-xs text-muted-foreground">Setup</DropdownMenu.Label>
    <DropdownMenu.Separator />
    {#each routes as route}
      {@const active = page.url.pathname.startsWith(route.href)}
      <DropdownMenu.Item
        onclick={() => goto(route.href)}
        class={cn(active && 'bg-accent text-foreground')}
      >
        {route.label}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
