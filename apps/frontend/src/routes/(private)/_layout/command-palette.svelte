<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Command from '$lib/components/ui/command/index.js';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import type { Route } from '$lib/config/routes';

  let { routes, open = $bindable(false) }: { routes: Route[]; open?: boolean } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const integrationOptions = $derived(
    scopeStore.activeIntegrations
      .filter((a) => INTEGRATIONS[a.id as ProviderId]?.navigation?.length > 0)
      .map((i) => ({
        id: i.id,
        label: INTEGRATIONS[i.id as ProviderId].name,
      }))
  );

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list.palette'],
    queryFn: () => trpc.sites.list.query(),
    enabled: open,
  }));

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      open = !open;
    }
  }

  function run(fn: () => void) {
    open = false;
    fn();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Command.Dialog bind:open class="max-w-xl">
  <Command.Input placeholder="Jump to a page, integration, or site…" />
  <Command.List>
    <Command.Empty>No matches.</Command.Empty>

    <Command.Group heading="Navigation">
      {#each routes as route}
        <Command.Item
          value={`nav:${route.label}:${route.href}`}
          onSelect={() => run(() => goto(route.href))}
        >
          <span>{route.label}</span>
          <span class="ml-auto text-xs text-muted-foreground">{route.href}</span>
        </Command.Item>
      {/each}
    </Command.Group>

    {#if integrationOptions.length > 0}
      <Command.Separator />
      <Command.Group heading="Integrations">
        {#each integrationOptions as opt}
          <Command.Item
            value={`integration:${opt.label}:${opt.id}`}
            onSelect={() =>
              run(() => {
                scopeStore.currentIntegration = opt.id as ProviderId;
                goto(`/${opt.id}`);
              })}
          >
            {opt.label}
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}

    {#if (sitesQuery.data ?? []).length > 0}
      <Command.Separator />
      <Command.Group heading="Sites">
        {#each sitesQuery.data ?? [] as site}
          <Command.Item
            value={`site:${site.name}:${site.id}`}
            onSelect={() => run(() => goto(`/sites/${site.id}`))}
          >
            {site.name}
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>
