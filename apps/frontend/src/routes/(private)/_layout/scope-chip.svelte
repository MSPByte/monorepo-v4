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

  // The URL decides which integration is active; all scope selection lives in scopeStore.
  $effect(() => {
    const pathname = page.url.pathname;
    const part = pathname.split('/')[1] as ProviderId | undefined;
    const integration = (part && integrationIds.has(part) ? part : null) as ProviderId | null;
    if (integration !== scopeStore.currentIntegration) {
      scopeStore.currentIntegration = integration;
    }
  });

  const currentIntegration = $derived(scopeStore.currentIntegration);
  const currentScope = $derived(scopeStore.currentScope);
  const currentIntegrationLabel = $derived(
    currentIntegration ? INTEGRATIONS[currentIntegration]?.name : null
  );
  const integrationOptions = $derived(
    scopeStore.activeIntegrations
      .filter((a) => INTEGRATIONS[a.id as ProviderId]?.navigation?.length > 0)
      .map((i) => ({ label: INTEGRATIONS[i.id as ProviderId].name, value: i.id }))
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
    enabled: currentScope === 'tenant' && !!currentIntegration,
  }));
  const groupsQuery = createQuery(() => ({
    queryKey: ['siteGroups.list.scopeChip'],
    queryFn: () => trpc.siteGroups.list.query(),
    enabled: !!currentIntegration,
  }));

  const siteOptions = $derived(
    (sitesQuery.data ?? []).map((s) => ({ label: s.name, value: s.id }))
  );
  const linkOptions = $derived(
    (linksQuery.data ?? []).map((l) => ({ label: l.name ?? l.externalId ?? '', value: l.id }))
  );
  const groupOptions = $derived(
    (groupsQuery.data ?? []).map((g) => ({ label: g.name, value: g.id }))
  );

  const scopeLabel = $derived.by(() => {
    if (!currentScope) return null;
    if (scopeStore.currentGroup) {
      const g = (groupsQuery.data ?? []).find((g) => g.id === scopeStore.currentGroup);
      return g?.name ?? null;
    }
    if (currentScope === 'site' && scopeStore.currentSite) {
      const s = (sitesQuery.data ?? []).find((s) => s.id === scopeStore.currentSite);
      return s?.name ?? null;
    }
    if (currentScope === 'tenant' && scopeStore.currentLink) {
      const l = (linksQuery.data ?? []).find((l) => l.id === scopeStore.currentLink);
      return l?.name ?? l?.externalId ?? null;
    }
    return null;
  });

  function handleIntegrationChange(v: string) {
    const integration = (v || null) as ProviderId | null;
    scopeStore.currentIntegration = integration;
    goto(integration ? `/${integration}` : '/home');
  }

  function handleGroupChange(v: string) {
    if (!v || v === scopeStore.currentGroup) {
      scopeStore.clearScope();
      return;
    }
    scopeStore.currentGroup = v || null;
  }

  function handleNativeChange(v: string) {
    const currentNative =
      currentScope === 'site' ? scopeStore.currentSite : scopeStore.currentLink;
    if (!v || v === currentNative) {
      scopeStore.clearScope();
      return;
    }
    if (currentScope === 'site') {
      scopeStore.currentSite = v;
    } else if (currentScope === 'tenant') {
      scopeStore.currentLink = v;
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        class={cn(
          'inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-full border border-border/60 bg-muted/50 text-sm font-medium transition-colors hover:bg-accent',
          !currentIntegration && 'text-muted-foreground'
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
    {#if currentScope === 'site' || currentScope === 'tenant'}
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">Group</span>
        <SingleSelect
          placeholder="Select group"
          searchPlaceholder="Search groups"
          options={groupOptions}
          selected={scopeStore.currentGroup ?? undefined}
          onchange={handleGroupChange}
          loading={groupsQuery.isLoading}
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">
          {currentScope === 'site' ? 'Site' : 'Tenant'}
        </span>
        <SingleSelect
          placeholder={currentScope === 'site' ? 'Select site' : 'Select tenant'}
          searchPlaceholder={currentScope === 'site' ? 'Search sites' : 'Search tenants'}
          options={currentScope === 'site' ? siteOptions : linkOptions}
          selected={
            currentScope === 'site'
              ? (scopeStore.currentSite ?? undefined)
              : (scopeStore.currentLink ?? undefined)
          }
          onchange={handleNativeChange}
          loading={currentScope === 'site' ? sitesQuery.isLoading : linksQuery.isLoading}
        />
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>
