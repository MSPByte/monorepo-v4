<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { createTrpcClient } from '$lib/trpc';
  import IntegrationHeader from '../_helpers/integration-header.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
    Settings,
    TriangleAlert,
    Building2,
    ArrowRight,
    CircleCheck,
    CircleX,
    CircleDot,
    ServerCog,
  } from '@lucide/svelte';
  import { enhance } from '$app/forms';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  type MSPAgentConfig = {
    primaryPsa?: string;
    siteVariableName?: string;
  };

  type MSPAgentLinkMeta = {
    rmm: 'dattormm';
    variableName: string;
    variableStatus: 'ok' | 'missing' | 'mismatch' | null;
    lastCheckedAt: string | null;
  };

  type CheckResult = { status: 'ok' | 'missing' | 'mismatch'; currentValue: string | null };

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const integration = INTEGRATIONS['mspagent'];

  const integrationQuery = createQuery(() => ({
    queryKey: ['integrations.get', 'mspagent'],
    queryFn: () => trpc.integrations.get.query({ id: 'mspagent' }),
  }));

  const allIntegrationsQuery = createQuery(() => ({
    queryKey: ['integrations.list'],
    queryFn: () => trpc.integrations.list.query(),
  }));

  const dattoLinksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'dattormm'],
    queryFn: () => trpc.integrationLinks.list.query({ integrationId: 'dattormm' }),
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const dbIntegration = $derived(integrationQuery.data ?? null);
  const isConfigured = $derived(!!(dbIntegration && !dbIntegration.deletedAt));
  const existingConfig = $derived((dbIntegration?.config as MSPAgentConfig) ?? null);
  const dattoLinks = $derived(dattoLinksQuery.data ?? []);
  const allSites = $derived(sitesQuery.data ?? []);
  const isLoading = $derived(
    integrationQuery.isLoading || sitesQuery.isLoading || dattoLinksQuery.isLoading
  );

  const psaOptions = $derived(
    (allIntegrationsQuery.data ?? [])
      .filter(
        (i) => !i.deletedAt && INTEGRATIONS[i.id as keyof typeof INTEGRATIONS]?.category === 'psa'
      )
      .map((i) => ({
        label: INTEGRATIONS[i.id as keyof typeof INTEGRATIONS]?.name ?? i.id,
        value: i.id,
      }))
  );

  const linkedSiteIds = $derived(
    new Set(dattoLinks.filter((l) => l.siteId).map((l) => l.siteId as string))
  );

  const persistedStatus = $derived(
    new Map(
      dattoLinks
        .filter((l) => l.siteId && l.meta)
        .map((l) => {
          const meta = l.meta as MSPAgentLinkMeta;
          return [
            l.siteId as string,
            { status: meta.variableStatus, lastCheckedAt: meta.lastCheckedAt },
          ];
        })
    )
  );

  let siteSearch = $state('');
  let activeFilter = $state<'All' | 'Linked' | 'Unlinked'>('All');
  let configSheetOpen = $state(false);
  let savingConfig = $state(false);
  let showDeleteConfirm = $state(false);
  let selectedPsa = $state('');
  let checkResults = $state<Map<string, CheckResult>>(new Map());
  let checking = $state<Set<string>>(new Set());
  let pushing = $state<Set<string>>(new Set());
  let checkingAll = $state(false);
  let pushingAll = $state(false);

  $effect(() => {
    selectedPsa = existingConfig?.primaryPsa ?? '';
  });

  const filteredSites = $derived(
    allSites
      .filter((s) => s.name.toLowerCase().includes(siteSearch.toLowerCase()))
      .filter((s) => {
        if (activeFilter === 'Linked') return linkedSiteIds.has(s.id);
        if (activeFilter === 'Unlinked') return !linkedSiteIds.has(s.id);
        return true;
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  );

  const allLinkedSiteIds = $derived([...linkedSiteIds]);

  function getVarStatus(siteId: string): CheckResult | null {
    const sessionResult = checkResults.get(siteId);
    if (sessionResult) return sessionResult;
    const persisted = persistedStatus.get(siteId);
    if (persisted?.status) return { status: persisted.status, currentValue: null };
    return null;
  }

  function makeCheckEnhance(siteId?: string) {
    return () => {
      if (siteId) checking = new Set([...checking, siteId]);
      else checkingAll = true;

      return async ({ result }: { result: any }) => {
        if (siteId) {
          const next = new Set(checking);
          next.delete(siteId);
          checking = next;
        } else {
          checkingAll = false;
        }

        if (result.type === 'success' && result.data?.checkResult) {
          const nextMap = new Map(checkResults);
          for (const item of result.data.checkResult) {
            nextMap.set(item.siteId, { status: item.status, currentValue: item.currentValue });
          }
          checkResults = nextMap;
          if (!siteId) {
            const ok = result.data.checkResult.filter((i: any) => i.status === 'ok').length;
            toast.success(`Check complete: ${ok}/${result.data.checkResult.length} sites OK`);
          }
        } else if (result.type === 'failure') {
          toast.error(result.data?.error ?? 'Check failed');
        }
      };
    };
  }

  function makePushEnhance(siteId?: string) {
    return () => {
      if (siteId) pushing = new Set([...pushing, siteId]);
      else pushingAll = true;

      return async ({ result }: { result: any }) => {
        if (siteId) {
          const next = new Set(pushing);
          next.delete(siteId);
          pushing = next;
        } else {
          pushingAll = false;
        }

        if (result.type === 'success') {
          const { pushed, failed, errors } = result.data ?? {};
          if (failed > 0) toast.error(`Pushed ${pushed}, failed ${failed}: ${errors?.join(', ')}`);
          else
            toast.success(
              siteId
                ? 'Variable pushed successfully'
                : `Successfully pushed ${pushed} site variable${pushed !== 1 ? 's' : ''}`
            );
        } else if (result.type === 'failure') {
          toast.error(result.data?.error ?? 'Push failed');
        }
      };
    };
  }
</script>

<AlertDialog.Root bind:open={showDeleteConfirm}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete MSPAgent Integration?</AlertDialog.Title>
      <AlertDialog.Description>
        This will remove the MSPAgent integration configuration. This action can be undone within 30
        days.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <form
        method="POST"
        action="?/deleteIntegration"
        use:enhance={() => {
          return async ({ result }) => {
            showDeleteConfirm = false;
            if (result.type === 'redirect') goto(result.location);
          };
        }}
      >
        <AlertDialog.Action
          type="submit"
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          Delete Integration
        </AlertDialog.Action>
      </form>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

{#if authStore.isAllowed('Integrations.Write')}
  <Sheet.Root bind:open={configSheetOpen}>
    <Sheet.Portal>
      <Sheet.Overlay />
      <Sheet.Content side="right" class="w-105 flex flex-col gap-0 p-0">
        <Sheet.Header class="p-4 border-b">
          <Sheet.Title>Configure MSPAgent</Sheet.Title>
          <Sheet.Description>Set up your MSPAgent integration settings.</Sheet.Description>
        </Sheet.Header>

        <form
          method="POST"
          action="?/save"
          class="flex flex-col flex-1 overflow-hidden"
          use:enhance={() => {
            savingConfig = true;
            return async ({ result }) => {
              savingConfig = false;
              if (result.type === 'success') {
                configSheetOpen = false;
                toast.success('Settings saved successfully!');
              } else if (result.type === 'failure') {
                toast.error(`Save failed: ${(result.data as any)?.error}`);
              }
            };
          }}
        >
          <div class="flex flex-col p-4 flex-1 overflow-y-auto gap-4">
            <Card.Root class="bg-primary/5 border-primary/20">
              <Card.Header class="pb-2">
                <Card.Title class="text-base">Configuration</Card.Title>
              </Card.Header>
              <Card.Content class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium" for="mspagent-psa">Primary PSA</label>
                  <Select.Root
                    type="single"
                    value={selectedPsa}
                    onValueChange={(v) => (selectedPsa = v)}
                  >
                    <Select.Trigger class="w-full">
                      {#if selectedPsa}
                        {psaOptions.find((o) => o.value === selectedPsa)?.label ?? selectedPsa}
                      {:else}
                        <span class="text-muted-foreground">Select a PSA integration...</span>
                      {/if}
                    </Select.Trigger>
                    <Select.Content>
                      {#each psaOptions as opt}
                        <Select.Item value={opt.value}>{opt.label}</Select.Item>
                      {/each}
                      {#if psaOptions.length === 0}
                        <div class="px-3 py-2 text-sm text-muted-foreground">
                          No PSA integrations configured
                        </div>
                      {/if}
                    </Select.Content>
                  </Select.Root>
                  <input type="hidden" name="primaryPsa" value={selectedPsa} />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium" for="mspagent-var-name">
                    Site Variable Name
                  </label>
                  <input
                    id="mspagent-var-name"
                    name="siteVariableName"
                    type="text"
                    placeholder="MSPSiteCode"
                    class="w-full px-3 py-2 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    value={existingConfig?.siteVariableName ?? ''}
                  />
                </div>
              </Card.Content>
            </Card.Root>
          </div>

          <Sheet.Footer class="flex justify-between p-4 border-t gap-2">
            {#if isConfigured}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onclick={() => {
                  configSheetOpen = false;
                  showDeleteConfirm = true;
                }}
              >
                Delete Integration
              </Button>
            {:else}
              <div></div>
            {/if}
            <Button size="sm" type="submit" disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save'}
            </Button>
          </Sheet.Footer>
        </form>
      </Sheet.Content>
    </Sheet.Portal>
  </Sheet.Root>
{/if}

<div class="flex flex-col size-full p-4 gap-4 overflow-hidden">
  <div class="flex items-start justify-between shrink-0">
    <IntegrationHeader {integration} active={isConfigured} loading={integrationQuery.isLoading} />
    {#if authStore.isAllowed('Integrations.Write')}
      <Button variant="outline" size="sm" onclick={() => (configSheetOpen = true)} class="gap-2">
        <Settings class="size-4" />
        Configure
      </Button>
    {/if}
  </div>

  {#if isLoading}
    <Loader />
  {:else if isConfigured}
    <div
      class="flex items-center gap-2 px-3 py-2 rounded border bg-primary/5 border-primary/20 w-fit text-sm shrink-0"
    >
      <ServerCog class="size-4 text-primary shrink-0" />
      <span class="font-medium text-primary">MSPAgent</span>
      <ArrowRight class="size-3.5 text-muted-foreground shrink-0" />
      <span class="font-medium">DattoRMM</span>
      <span class="text-muted-foreground text-xs ml-1">— site variable sync</span>
    </div>

    <div class="flex gap-2 items-center shrink-0 w-full">
      <div class="flex w-96!">
        <input
          type="text"
          placeholder="Search sites..."
          bind:value={siteSearch}
          class="w-full px-3 py-1.5 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div class="flex gap-1.5 shrink-0">
        {#each ['All', 'Linked', 'Unlinked'] as filter}
          <button
            class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
              {activeFilter === filter
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:border-foreground/30'}"
            onclick={() => (activeFilter = filter as typeof activeFilter)}
          >
            {filter}
          </button>
        {/each}
      </div>
      <div class="flex gap-2 ml-auto shrink-0">
        <form method="POST" action="?/checkVars" use:enhance={makeCheckEnhance()}>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={checkingAll || allLinkedSiteIds.length === 0}
            class="gap-2"
          >
            <CircleDot class="size-4" />
            {checkingAll ? 'Checking...' : 'Check All'}
          </Button>
        </form>

        {#if authStore.isAllowed('Integrations.Write')}
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              {#snippet child({ props })}
                <Button
                  type="button"
                  size="sm"
                  disabled={pushingAll || allLinkedSiteIds.length === 0}
                  {...props}
                >
                  {pushingAll ? 'Pushing...' : 'Push All'}
                </Button>
              {/snippet}
            </AlertDialog.Trigger>
            <AlertDialog.Content>
              <AlertDialog.Header>
                <AlertDialog.Title>Push Variables to All Sites?</AlertDialog.Title>
                <AlertDialog.Description>
                  This will push the site variable to all {allLinkedSiteIds.length} linked DattoRMM site{allLinkedSiteIds.length !==
                  1
                    ? 's'
                    : ''}.
                </AlertDialog.Description>
              </AlertDialog.Header>
              <AlertDialog.Footer>
                <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                <form method="POST" action="?/pushVars" use:enhance={makePushEnhance()}>
                  <AlertDialog.Action type="submit" disabled={pushingAll}>
                    Push All
                  </AlertDialog.Action>
                </form>
              </AlertDialog.Footer>
            </AlertDialog.Content>
          </AlertDialog.Root>
        {/if}
      </div>
    </div>

    <div class="flex-1 overflow-hidden flex flex-col min-h-0">
      {#if filteredSites.length === 0}
        <div class="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
          <Building2 class="size-8 opacity-40" />
          <span class="text-sm">No sites found</span>
        </div>
      {:else}
        <div class="flex-1 overflow-y-auto">
          <div class="flex flex-col divide-y">
            {#each filteredSites as site (site.id)}
              {@const dattoLink = dattoLinks.find((l) => l.siteId === site.id)}
              {@const isLinked = !!dattoLink}
              {@const isPushing = pushing.has(site.id)}
              {@const isChecking = checking.has(site.id)}
              {@const varStatus = getVarStatus(site.id)}
              <div class="flex justify-between p-2 items-center hover:bg-muted/30">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-medium text-sm truncate">{site.name}</span>
                    {#if isLinked}
                      <Badge
                        class="text-xs shrink-0 bg-primary/15 text-primary border-primary/30"
                        variant="outline"
                      >
                        LINKED
                      </Badge>
                    {:else}
                      <Badge
                        class="text-xs shrink-0 bg-muted-foreground/15 text-muted-foreground border-muted-foreground/30"
                        variant="outline"
                      >
                        NOT LINKED
                      </Badge>
                    {/if}
                  </div>

                  <div class="flex items-center gap-2 min-w-0">
                    {#if isLinked && dattoLink}
                      <span class="text-sm text-muted-foreground truncate"
                        >{dattoLink.name ?? dattoLink.externalId}</span
                      >
                    {:else}
                      <span class="text-sm text-muted-foreground/50">No DattoRMM link</span>
                    {/if}

                    <div class="flex items-center">
                      {#if !isLinked}
                        <span class="text-xs text-muted-foreground/40">—</span>
                      {:else if isChecking}
                        <span class="text-xs text-muted-foreground animate-pulse">Checking...</span>
                      {:else if varStatus?.status === 'ok'}
                        <span
                          class="inline-flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full"
                        >
                          <CircleCheck class="size-3" /> OK
                        </span>
                      {:else if varStatus?.status === 'mismatch'}
                        <span
                          class="inline-flex items-center gap-1 text-xs font-medium text-amber-500 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full"
                        >
                          <CircleX class="size-3" /> Mismatch
                        </span>
                      {:else if varStatus?.status === 'missing'}
                        <span
                          class="inline-flex items-center gap-1 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/30 px-2 py-0.5 rounded-full"
                        >
                          <CircleX class="size-3" /> Missing
                        </span>
                      {:else}
                        <span class="text-xs text-muted-foreground/40">Not checked</span>
                      {/if}
                    </div>
                  </div>
                </div>

                {#if isLinked && dattoLink}
                  <div class="flex items-center gap-2 justify-end">
                    <form
                      method="POST"
                      action="?/checkVars"
                      use:enhance={makeCheckEnhance(site.id)}
                    >
                      <input type="hidden" name="siteId" value={site.id} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        disabled={isChecking || checkingAll}
                        class="gap-1.5"
                      >
                        <CircleDot class="size-3.5" />
                        {isChecking ? '...' : 'Check'}
                      </Button>
                    </form>

                    {#if authStore.isAllowed('Integrations.Write')}
                      <form
                        method="POST"
                        action="?/pushVars"
                        use:enhance={makePushEnhance(site.id)}
                      >
                        <input type="hidden" name="siteId" value={site.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={isPushing || pushingAll}
                        >
                          {isPushing ? 'Pushing...' : 'Push'}
                        </Button>
                      </form>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col size-full justify-center items-center">
      <div
        class="flex items-center gap-3 px-4 py-3 w-fit rounded bg-warning/10 text-warning border border-warning/30"
      >
        <TriangleAlert class="size-4" />
        <span class="text-sm">
          MSPAgent is not configured yet. Click <strong>Configure</strong> to set up your settings.
        </span>
      </div>
    </div>
  {/if}
</div>
