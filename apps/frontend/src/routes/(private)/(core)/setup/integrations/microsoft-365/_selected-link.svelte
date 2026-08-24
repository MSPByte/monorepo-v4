<script lang="ts">
  import { CONSENT_VERSION } from '@mspbyte/shared';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import {
    CircleAlert,
    X,
    TriangleAlert,
    Globe,
    Activity,
    CircleCheck,
    CircleHelp,
    Check,
    Pencil,
    LoaderCircle,
    MapPin,
    Network,
  } from '@lucide/svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import { getContext } from 'svelte';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { toast } from 'svelte-sonner';
  import { enhance } from '$app/forms';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  type Link = inferRouterOutputs<AppRouter>['integrationLinks']['list'][number];
  type Site = inferRouterOutputs<AppRouter>['sites']['list'][number];

  // MS_CAPABILITIES is not exported from v2 shared — define locally
  const MS_CAPABILITIES: Record<string, { label: string; description: string }> = {
    signInActivity: {
      label: 'Sign-in Activity',
      description: 'Last sign-in timestamps per user',
    },
    conditionalAccess: {
      label: 'Conditional Access',
      description: 'Conditional Access policy retrieval',
    },
    identityProtection: {
      label: 'Identity Protection',
      description: 'Risky user detection via Azure AD Identity Protection',
    },
  };

  const {
    selectedLink,
    domainSiteMap,
    assignedSiteIds,
    unavailableSiteTenants,
    dbSites,
    deselect,
    onSaveMappings,
  }: {
    selectedLink: Link;
    domainSiteMap: Map<string, string>;
    assignedSiteIds: string[];
    unavailableSiteTenants: Map<string, string>;
    dbSites: Site[];
    deselect?: () => void;
    onSaveMappings?: () => void;
  } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const updateLinkMut = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.integrationLinks.update.mutate>[0]) =>
      trpc.integrationLinks.update.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrationLinks.list'] });
    },
  }));

  const syncMappingsMut = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.integrationLinks.syncM365SiteMappings.mutate>[0]) =>
      trpc.integrationLinks.syncM365SiteMappings.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrationLinks.list'] });
      void queryClient.invalidateQueries({ queryKey: ['integrationLinks.m365SiteMappings'] });
    },
  }));

  const mappings = $derived<Record<string, string | null>>(
    Object.fromEntries(domainSiteMap.entries())
  );
  const siteOptions = $derived(
    dbSites.map((site) => {
      const assignedTenant = unavailableSiteTenants.get(site.id);
      return {
        label: site.name,
        value: site.id,
        disabled: !!assignedTenant,
        subLabel: assignedTenant ? `Already assigned to ${assignedTenant}` : undefined,
      };
    })
  );
  const metaDomains = $derived(
    ((selectedLink.meta as Record<string, unknown>)?.domains as string[] | undefined) ?? []
  );
  let localMappings = $state<Record<string, string | null>>({});
  let localSiteIds = $state<string[]>([]);
  let mappingsChanged = $state(false);
  let saving = $state(false);
  let editingName = $state(false);
  let nameValue = $state('');
  let refreshing = $state(false);
  let refreshingInfo = $state(false);

  $effect(() => {
    localMappings = { ...mappings };
    localSiteIds = [...assignedSiteIds];
    mappingsChanged = false;
  });

  const onMappingChange = (domain: string, v: string | null) => {
    localMappings[domain] = v;
    mappingsChanged = Object.keys(localMappings).some(
      (d) => (domainSiteMap.get(d) ?? null) !== localMappings[d]
    );
  };

  const onAssignedSitesChange = (siteIds: string[]) => {
    localSiteIds = siteIds;
    for (const [domain, siteId] of Object.entries(localMappings)) {
      if (siteId && !siteIds.includes(siteId)) localMappings[domain] = null;
    }
    mappingsChanged = true;
  };

  const handleSaveMappings = async () => {
    saving = true;
    try {
      const domainMappings: Array<{ domain: string; siteId: string }> = [];
      for (const [domain, siteId] of Object.entries(localMappings)) {
        if (!siteId) continue;
        domainMappings.push({ domain, siteId });
      }

      await syncMappingsMut.mutateAsync({
        linkId: selectedLink.id,
        siteIds: localSiteIds,
        domainMappings,
      });

      onSaveMappings?.();
      toast.info('Successfully saved mappings!');
    } catch {
      toast.error('Failed to process mapping changes');
    } finally {
      saving = false;
    }
  };

  async function saveName() {
    if (!nameValue.trim()) {
      editingName = false;
      return;
    }
    try {
      await updateLinkMut.mutateAsync({
        id: selectedLink.id,
        name: nameValue.trim(),
      });
      toast.info('Name updated');
      onSaveMappings?.();
    } catch {
      toast.error('Failed to update name');
    } finally {
      editingName = false;
    }
  }

  function startEditName() {
    nameValue = selectedLink.name ?? '';
    editingName = true;
  }
</script>

<div class="flex-1 flex flex-col overflow-hidden border rounded bg-card/70">
  <!-- Tenant header -->
  <div class="flex items-start justify-between px-4 py-3 border-b shrink-0">
    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
      {#if editingName}
        <div class="flex items-center gap-1">
          <Input
            class="h-7 text-sm font-semibold"
            bind:value={nameValue}
            onkeydown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') editingName = false;
            }}
            autofocus
          />
          <Button variant="ghost" size="sm" class="h-7 px-2" onclick={saveName}>
            <Check class="size-3" />
          </Button>
          <Button variant="ghost" size="sm" class="h-7 px-2" onclick={() => (editingName = false)}>
            <X class="size-3" />
          </Button>
        </div>
      {:else}
        <div class="flex items-center gap-1.5">
          <span class="font-semibold text-sm truncate">
            {selectedLink.name ?? selectedLink.externalId}
          </span>
          {#if authStore.isAllowed('Integrations.Write')}
            <Button variant="ghost" class="h-5 w-5 p-0 shrink-0" onclick={startEditName}>
              <Pencil class="size-3" />
            </Button>
          {/if}
        </div>
      {/if}
      <span class="text-xs text-muted-foreground font-mono">Tenant: {selectedLink.externalId}</span>
    </div>
    <Button variant="ghost" onclick={() => deselect?.()} class="h-fit p-1.5! shrink-0">
      <X class="size-4" />
    </Button>
  </div>

  {#if selectedLink.status === 'active'}
    {@const needsConsent =
      (selectedLink.meta as Record<string, unknown>)?.consentVersion !== CONSENT_VERSION}
    {#if needsConsent}
      <div
        class="flex items-center justify-between gap-3 mx-4 mt-3 px-3 py-2 rounded bg-warning/10 text-warning border border-warning/30 shrink-0"
      >
        <div class="flex items-center gap-2">
          <TriangleAlert class="size-4 shrink-0" />
          <span class="text-xs">Consent is outdated — re-consent to restore full access.</span>
        </div>
        <form method="POST" action="?/gdapConsent" use:enhance>
          <input name="gdapTenantId" value={selectedLink.externalId} hidden />
          <Button
            size="sm"
            variant="outline"
            class="text-warning border-warning/40 hover:bg-warning/10 shrink-0"
            type="submit"
          >
            Re-consent
          </Button>
        </form>
      </div>
    {/if}

    <Tabs.Root value="domains" class="flex flex-col flex-1 overflow-hidden">
      <Tabs.List class="mx-4 mt-3 shrink-0">
        <Tabs.Trigger value="domains">Domains</Tabs.Trigger>
        <Tabs.Trigger value="capabilities">Capabilities</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="domains" class="flex flex-col overflow-y-auto p-4 gap-4">
        <div class="relative flex flex-col gap-4">
          <div class="absolute left-4 top-8 bottom-8 w-px bg-border" aria-hidden="true"></div>
          <section class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
            <div class="flex size-8 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
              <Network class="size-4" />
            </div>
            <div class="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/[0.035] p-3">
              <div class="flex items-baseline justify-between gap-3">
                <div>
                  <h3 class="text-sm font-semibold">Assign sites</h3>
                  <p class="mt-0.5 text-xs text-muted-foreground">This tenant can be used by these sites. A site can belong to one Microsoft 365 tenant.</p>
                </div>
                <span class="shrink-0 font-mono text-xs text-primary">{localSiteIds.length} assigned</span>
              </div>
              <MultiSelect
                options={siteOptions}
                selected={localSiteIds}
                placeholder="Choose sites for this tenant..."
                maxDisplay={2}
                onchange={onAssignedSitesChange}
                disabled={!authStore.isAllowed('Integrations.Write')}
              />
            </div>
          </section>
          <section class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
            <div class="flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
              <MapPin class="size-4" />
            </div>
            <div class="flex min-h-0 flex-col gap-3 rounded-lg border bg-card p-3">
              <div>
                <h3 class="text-sm font-semibold">Map domains</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">Domains attribute Microsoft 365 identities to one of the sites assigned above.</p>
              </div>
              {#if !metaDomains.length}
                <div class="flex flex-col items-center justify-center gap-2 rounded border border-dashed py-7 text-muted-foreground">
                  <Globe class="size-6 opacity-40" />
                  <span class="text-sm">No domains cached</span>
                </div>
              {:else if localSiteIds.length === 0}
                <div class="rounded border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                  Assign at least one site before mapping domains.
                </div>
              {:else}
                <div class="flex flex-col gap-2 overflow-auto">
                  <div class="grid grid-cols-[minmax(0,1fr)_minmax(11rem,1fr)] gap-3 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Tenant domain</span>
                    <span>Identity site</span>
                  </div>
                  {#each metaDomains as domain}
                    {@const mappedSiteId =
                      localMappings[domain as string] ?? domainSiteMap.get(domain as string)}
                    <div class="grid grid-cols-[minmax(0,1fr)_minmax(11rem,1fr)] items-center gap-3 rounded-md border border-transparent px-1.5 py-1 transition-colors hover:border-border hover:bg-muted/30">
                      <span class="truncate font-mono text-sm">{domain}</span>
                      <SingleSelect
                        options={dbSites
                          .filter((site) => localSiteIds.includes(site.id))
                          .map((site) => ({ label: site.name, value: site.id }))}
                        selected={mappedSiteId}
                        placeholder="No identity site"
                        onchange={(v) => onMappingChange(domain as string, v.length ? v : null)}
                        disabled={!authStore.isAllowed('Integrations.Write')}
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </section>
        </div>
        <div class="flex h-fit pt-4 gap-2">
          <Button
            size="sm"
            disabled={!mappingsChanged || saving || !authStore.isAllowed('Integrations.Write')}
            onclick={handleSaveMappings}
          >
            Save Mappings
          </Button>
          <form
            method="POST"
            action="?/refreshLinkInfo"
            use:enhance={() => {
              refreshingInfo = true;
              return async ({ result }) => {
                refreshingInfo = false;
                if (result.type === 'failure') {
                  toast.error(
                    ((result.data as Record<string, unknown>)?.error as string) ??
                      'Failed to refresh link info'
                  );
                } else {
                  toast.info('Refreshed tenant info!');
                }
              };
            }}
          >
            <input name="linkId" value={selectedLink.id} hidden />
            <input name="externalId" value={selectedLink.externalId} hidden />
            <Button
              size="sm"
              variant="outline"
              type="submit"
              disabled={!authStore.isAllowed('Integrations.Write') || refreshingInfo}
            >
              {#if refreshingInfo}
                <LoaderCircle class="size-4 animate-spin" />
              {:else}
                <Activity class="size-4 mr-1.5" />
              {/if}
              Refresh Info
            </Button>
          </form>
          <form method="POST" action="?/gdapConsent" use:enhance>
            <input name="gdapTenantId" value={selectedLink.externalId} hidden />
            <Button size="sm" variant="outline" type="submit">Re-consent</Button>
          </form>
        </div>
      </Tabs.Content>

      <Tabs.Content value="capabilities" class="flex-1 overflow-y-auto px-4 pb-4 mt-3">
        <div class="flex flex-col gap-4">
          <div class="flex items-center justify-between">
            <span class="font-medium text-sm">Tenant Capabilities</span>
            <form
              method="POST"
              action="?/refreshCapabilities"
              use:enhance={() => {
                refreshing = true;

                return async ({ result }) => {
                  refreshing = false;
                  if (result.type === 'failure') {
                    toast.error(
                      ((result.data as Record<string, unknown>)?.error as string) ??
                        'Failed to refresh capabilities'
                    );
                  } else {
                    toast.info('Refreshed capabilities!');
                  }
                };
              }}
            >
              <input name="externalId" value={selectedLink.externalId} hidden />
              <input name="linkId" value={selectedLink.id} hidden />
              <Button
                size="sm"
                variant="outline"
                type="submit"
                disabled={!authStore.isAllowed('Integrations.Write') || refreshing}
              >
                {#if refreshing}
                  <LoaderCircle class="size-4 animate-spin" />
                {:else}
                  <Activity class="size-4 mr-1.5" />
                {/if}
                Refresh Capabilities
              </Button>
            </form>
          </div>
          <div class="flex flex-col gap-2">
            {#each Object.entries(MS_CAPABILITIES) as [key, cap]}
              {@const capsMeta = (selectedLink.meta as Record<string, unknown>)?.capabilities as
                | Record<string, boolean>
                | undefined}
              {@const hasCapability = capsMeta?.[key] as boolean | undefined}
              <div class="flex items-start gap-3 p-3 rounded border bg-muted/30">
                {#if hasCapability === true}
                  <CircleCheck class="size-4 text-primary mt-0.5 shrink-0" />
                {:else if hasCapability === undefined}
                  <CircleHelp class="size-4 text-amber-500 mt-0.5 shrink-0" />
                {:else}
                  <CircleAlert class="size-4 text-red-500 mt-0.5 shrink-0" />
                {/if}
                <div class="flex flex-col gap-0.5">
                  <span class="text-sm font-medium">{cap.label}</span>
                  <span class="text-xs text-muted-foreground">{cap.description}</span>
                  {#if hasCapability === undefined}
                    <span class="text-xs text-muted-foreground/60 italic">not yet checked</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </Tabs.Content>
    </Tabs.Root>
  {:else}
    <div class="flex flex-col size-full p-4 items-center justify-center">
      <div class="flex flex-col h-fit justify-center items-center w-full gap-2">
        <span class="text-sm text-muted-foreground"
          >Process consent flow to activate this tenant.</span
        >
        {#if authStore.isAllowed('Integrations.Write')}
          <form method="POST" action="?/gdapConsent" use:enhance>
            <input name="gdapTenantId" value={selectedLink.externalId} hidden />
            <Button type="submit">Consent</Button>
          </form>
        {:else}
          <span class="text-warning text-sm">You are not permitted to perform this action.</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
