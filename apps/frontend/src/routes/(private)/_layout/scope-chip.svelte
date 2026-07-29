<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ChevronDown, Layers } from '@lucide/svelte';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { cn } from '$lib/utils';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const integrationIds = new Set(Object.keys(INTEGRATIONS) as ProviderId[]);

  let open = $state(false);

  const integrationOptions = $derived(
    scopeStore.activeIntegrations
      .filter((a) => INTEGRATIONS[a.id as ProviderId]?.navigation?.length > 0)
      .map((i) => ({
        label: INTEGRATIONS[i.id as ProviderId].name,
        value: i.id,
      })),
  );

  const currentIntegration = $derived(scopeStore.currentIntegration);
  const currentScope = $derived(scopeStore.currentScope);

  const currentIntegrationLabel = $derived(
    currentIntegration ? INTEGRATIONS[currentIntegration].name : null,
  );

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list', currentIntegration],
    queryFn: () => trpc.sites.list.query(),
    enabled: currentScope === 'site' && !!currentIntegration,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', currentIntegration],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: currentIntegration ?? undefined,
        status: 'active',
      }),
    enabled: currentScope === 'link' && !!currentIntegration,
  }));

  const siteOptions = $derived(
    (sitesQuery.data ?? []).map((s) => ({ label: s.name, value: s.id })),
  );
  const linkOptions = $derived(
    (linksQuery.data ?? []).map((l) => ({
      label: l.name ?? l.externalId ?? '',
      value: l.id,
    })),
  );

  const scopeLabel = $derived.by(() => {
    if (!currentScope) return null;
    if (currentScope === 'site') {
      const s = (sitesQuery.data ?? []).find((s) => s.id === scopeStore.currentSite);
      return s?.name ?? null;
    }
    const l = (linksQuery.data ?? []).find((l) => l.id === scopeStore.currentLink);
    return l?.name ?? l?.externalId ?? null;
  });

  function handleIntegrationChange(v: string) {
    if (v) {
      scopeStore.currentIntegration = v as ProviderId;
      goto(`/${v}`);
    } else {
      scopeStore.currentIntegration = null;
      goto('/home');
    }
  }

  function syncFromPath(pathname: string) {
    const part = pathname.split('/')[1] as ProviderId | undefined;
    scopeStore.currentIntegration =
      part && integrationIds.has(part) ? part : null;
  }

  $effect(() => {
    syncFromPath(page.url.pathname);
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        class={cn(
          'inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-full border border-border/60 bg-muted/50 text-sm font-medium transition-colors hover:bg-accent',
          !currentIntegration && 'text-muted-foreground',
        )}
      >
        <Layers class="size-3.5 opacity-70" />
        {#if currentIntegrationLabel}
          <span class="truncate max-w-32">{currentIntegrationLabel}</span>
          {#if scopeLabel}
            <span class="text-muted-foreground/60">·</span>
            <span class="truncate max-w-32 text-muted-foreground">{scopeLabel}</span>
          {/if}
        {:else}
          <span>Select scope</span>
        {/if}
        <ChevronDown class="size-3.5 opacity-50" />
      </button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-72 gap-3">
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-muted-foreground">Integration</span>
      <SingleSelect
        placeholder="Select integration"
        searchPlaceholder="Search integrations"
        options={integrationOptions}
        selected={currentIntegration ?? undefined}
        onchange={handleIntegrationChange}
      />
    </div>
    {#if currentScope === 'site'}
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">Site</span>
        <SingleSelect
          placeholder="Select site"
          searchPlaceholder="Search sites"
          options={siteOptions}
          bind:selected={scopeStore.currentSite as string | undefined}
          loading={sitesQuery.isLoading}
        />
      </div>
    {:else if currentScope === 'link'}
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">Tenant</span>
        <SingleSelect
          placeholder="Select tenant"
          searchPlaceholder="Search tenants"
          options={linkOptions}
          bind:selected={scopeStore.currentLink as string | undefined}
          loading={linksQuery.isLoading}
        />
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>
