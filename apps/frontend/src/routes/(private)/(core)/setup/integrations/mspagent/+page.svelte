<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { createTrpcClient } from '$lib/trpc';
  import IntegrationHeader from '../_helpers/integration-header.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import {
    Settings,
    TriangleAlert,
    Building2,
    ArrowRight,
    CircleCheck,
    CircleX,
    CircleDot,
    ServerCog,
    KeyRound,
    Copy,
    Check,
    Palette,
    Plus,
    Trash2,
  } from '@lucide/svelte';
  import { enhance } from '$app/forms';
  import { toast } from 'svelte-sonner';
  import { toUserMessage, logError } from '$lib/utils/errors';
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
  const queryClient = useQueryClient();
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

  const canManageTokens = $derived(authStore.isAllowed('Agents.Write'));

  const tokenListQuery = createQuery(() => ({
    queryKey: ['agents.enrollmentToken.list'],
    queryFn: () => trpc.agents.enrollmentToken.list.query(),
    enabled: canManageTokens,
  }));

  // Keyed by site_id for O(1) lookup in the site list.
  const tokenBySite = $derived(
    new Map((tokenListQuery.data ?? []).map((t) => [t.siteId, t]))
  );

  let tokenDialogSite = $state<{ id: string; name: string } | null>(null);
  let newToken = $state<string | null>(null);
  let copied = $state(false);
  let generatingToken = $state(false);

  const regenerateTokenMutation = createMutation(() => ({
    mutationFn: (siteId: string) => trpc.agents.enrollmentToken.regenerate.mutate({ siteId }),
  }));

  async function handleGenerateToken(siteId: string) {
    generatingToken = true;
    newToken = null;
    copied = false;
    try {
      const data = await regenerateTokenMutation.mutateAsync(siteId);
      newToken = data.token;
      queryClient.invalidateQueries({ queryKey: ['agents.enrollmentToken.list'] });
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to generate enrollment token'));
    } finally {
      generatingToken = false;
    }
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  // Bundle / branding editor
  type TrayItem = { id: string; label: string; action: 'open_support' };
  let bundleDialogSite = $state<{ id: string; name: string } | null>(null);
  let bundleCompanyName = $state('');
  let bundleAccentColor = $state('#3b82f6');
  let bundleShowTray = $state(true);
  let bundleTrayItems = $state<TrayItem[]>([{ id: 'support', label: 'Request Support', action: 'open_support' }]);
  let savingBundle = $state(false);

  function addTrayItem() {
    bundleTrayItems = [...bundleTrayItems, { id: crypto.randomUUID(), label: '', action: 'open_support' }];
  }
  function removeTrayItem(idx: number) {
    bundleTrayItems = bundleTrayItems.filter((_, i) => i !== idx);
  }
  function updateTrayLabel(idx: number, label: string) {
    bundleTrayItems = bundleTrayItems.map((item, i) => (i === idx ? { ...item, label } : item));
  }

  const bundleQuery = createQuery(() => ({
    queryKey: ['agents.bundle.get', bundleDialogSite?.id ?? ''],
    queryFn: () => trpc.agents.bundle.get.query({ siteId: bundleDialogSite!.id }),
    enabled: !!bundleDialogSite && canManageTokens,
  }));

  $effect(() => {
    if (!bundleDialogSite) return;
    const raw = bundleQuery.data;
    if (raw) {
      const d = raw.data as {
        branding?: { companyName?: string; accentColor?: string };
        tray?: { showTray?: boolean; items?: TrayItem[] };
      };
      bundleCompanyName = d?.branding?.companyName ?? '';
      bundleAccentColor = d?.branding?.accentColor ?? '#3b82f6';
      bundleShowTray = d?.tray?.showTray ?? true;
      bundleTrayItems = d?.tray?.items?.length
        ? d.tray.items
        : [{ id: 'support', label: 'Request Support', action: 'open_support' }];
    } else if (raw === null) {
      bundleCompanyName = '';
      bundleAccentColor = '#3b82f6';
      bundleShowTray = true;
      bundleTrayItems = [{ id: 'support', label: 'Request Support', action: 'open_support' }];
    }
  });

  const upsertBundleMutation = createMutation(() => ({
    mutationFn: ({ siteId, data }: { siteId: string; data: Record<string, unknown> }) =>
      trpc.agents.bundle.upsert.mutate({ siteId, data }),
  }));

  async function handleSaveBundle() {
    if (!bundleDialogSite) return;
    savingBundle = true;
    try {
      const validItems = bundleTrayItems.filter((item) => item.label.trim());
      await upsertBundleMutation.mutateAsync({
        siteId: bundleDialogSite.id,
        data: {
          branding: {
            ...(bundleCompanyName ? { companyName: bundleCompanyName } : {}),
            accentColor: bundleAccentColor,
          },
          tray: {
            showTray: bundleShowTray,
            items: validItems,
          },
        },
      });
      queryClient.invalidateQueries({ queryKey: ['agents.bundle.get'] });
      bundleDialogSite = null;
      toast.success('Branding saved');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to save branding'));
    } finally {
      savingBundle = false;
    }
  }

  let siteSearch = $state('');
  let activeFilter = $state<'All' | 'Linked' | 'Unlinked' | 'Mismatched' | 'Missing'>('All');
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
        if (activeFilter === 'Mismatched') return getVarStatus(s.id)?.status === 'mismatch';
        if (activeFilter === 'Missing') return getVarStatus(s.id)?.status === 'missing';
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
          const raw = result.data?.error;
          logError(raw, 'mspagent:check');
          toast.error(toUserMessage(raw, 'Check failed. Please try again.'));
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
          if (failed > 0) {
            logError(errors, 'mspagent:push:partial');
            toast.warning(`Pushed ${pushed}, failed ${failed}. Check the audit log for details.`);
          } else
            toast.success(
              siteId
                ? 'Variable pushed successfully'
                : `Successfully pushed ${pushed} site variable${pushed !== 1 ? 's' : ''}`
            );
        } else if (result.type === 'failure') {
          const raw = result.data?.error;
          logError(raw, 'mspagent:push');
          toast.error(toUserMessage(raw, 'Push failed. Please try again.'));
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
                  <Input
                    id="mspagent-var-name"
                    name="siteVariableName"
                    type="text"
                    placeholder="MSPSiteCode"
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

<Dialog.Root
  open={!!tokenDialogSite}
  onOpenChange={(open) => {
    if (!open) {
      tokenDialogSite = null;
      newToken = null;
      copied = false;
    }
  }}
>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Enrollment Token</Dialog.Title>
      <Dialog.Description>
        {#if tokenDialogSite}
          {tokenDialogSite.name}
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-2">
      {#if newToken}
        <div class="flex flex-col gap-2">
          <p class="text-sm text-muted-foreground">
            Copy this token and store it in your RMM as a site variable. It will not be shown again.
          </p>
          <div class="flex gap-2 items-center">
            <code class="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono break-all select-all">
              {newToken}
            </code>
            <button
              onclick={copyToken}
              class="shrink-0 p-2 rounded border hover:bg-muted transition-colors"
              title="Copy token"
            >
              {#if copied}
                <Check class="size-4 text-emerald-500" />
              {:else}
                <Copy class="size-4" />
              {/if}
            </button>
          </div>
          <p class="text-xs text-muted-foreground">
            Pass it to the installer via <code class="font-mono">/ENROLLMENT_TOKEN=[token]</code>
          </p>
        </div>
      {:else}
        <p class="text-sm text-muted-foreground">
          {#if tokenDialogSite && tokenBySite.has(tokenDialogSite.id)}
            This site already has an enrollment token. Regenerating will invalidate the existing
            token — update your RMM deployment after generating.
          {:else}
            Generate an enrollment token for this site. Devices use it to self-register on first
            run.
          {/if}
        </p>
        <Button
          onclick={() => tokenDialogSite && handleGenerateToken(tokenDialogSite.id)}
          disabled={generatingToken}
          class="w-full"
        >
          {#if generatingToken}
            Generating...
          {:else if tokenDialogSite && tokenBySite.has(tokenDialogSite.id)}
            Regenerate Token
          {:else}
            Generate Token
          {/if}
        </Button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root
  open={!!bundleDialogSite}
  onOpenChange={(open) => {
    if (!open) bundleDialogSite = null;
  }}
>
  <Dialog.Content class="max-w-sm">
    <Dialog.Header>
      <Dialog.Title>Agent Branding</Dialog.Title>
      <Dialog.Description>
        {#if bundleDialogSite}{bundleDialogSite.name}{/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-2">
      {#if bundleQuery.isLoading}
        <div class="text-sm text-muted-foreground">Loading...</div>
      {:else}
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="bundle-company-name">Company Name</label>
          <input
            id="bundle-company-name"
            type="text"
            bind:value={bundleCompanyName}
            placeholder="Your company name"
            class="px-3 py-1.5 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="bundle-accent-color">Accent Color</label>
          <div class="flex items-center gap-2">
            <input
              id="bundle-accent-color"
              type="color"
              bind:value={bundleAccentColor}
              class="h-8 w-14 rounded border cursor-pointer bg-background"
            />
            <span class="text-sm text-muted-foreground font-mono">{bundleAccentColor}</span>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">Show Tray Icon</span>
          <button
            type="button"
            role="switch"
            aria-label="Toggle tray icon"
            aria-checked={bundleShowTray}
            onclick={() => (bundleShowTray = !bundleShowTray)}
            class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors
              {bundleShowTray ? 'bg-primary' : 'bg-muted-foreground/30'}"
          >
            <span
              class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                {bundleShowTray ? 'translate-x-4.5' : 'translate-x-0.5'}"
            ></span>
          </button>
        </div>

        {#if bundleShowTray}
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">Tray Menu Items</span>
              <button
                type="button"
                onclick={addTrayItem}
                class="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus class="size-3" /> Add item
              </button>
            </div>
            {#each bundleTrayItems as item, idx}
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  value={item.label}
                  oninput={(e) => updateTrayLabel(idx, (e.target as HTMLInputElement).value)}
                  placeholder="Menu item label"
                  class="flex-1 px-2 py-1 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onclick={() => removeTrayItem(idx)}
                  class="text-muted-foreground hover:text-destructive"
                  aria-label="Remove item"
                >
                  <Trash2 class="size-3.5" />
                </button>
              </div>
            {/each}
            {#if bundleTrayItems.length === 0}
              <p class="text-xs text-muted-foreground">No items — tray will show a default item.</p>
            {/if}
          </div>
        {/if}

        <Button onclick={handleSaveBundle} disabled={savingBundle} class="w-full mt-1">
          {savingBundle ? 'Saving...' : 'Save Branding'}
        </Button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

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
        {#each ['All', 'Linked', 'Unlinked', 'Mismatched', 'Missing'] as filter}
          <button
            type="button"
            aria-pressed={activeFilter === filter}
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

                <div class="flex items-center gap-2 justify-end">
                  {#if canManageTokens}
                    {@const hasToken = tokenBySite.has(site.id)}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      class="gap-1.5 text-muted-foreground"
                      onclick={() => { bundleDialogSite = { id: site.id, name: site.name }; }}
                      title="Edit agent branding for this site"
                    >
                      <Palette class="size-3.5" />
                      Branding
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      class="gap-1.5 {hasToken ? 'text-emerald-600' : 'text-muted-foreground'}"
                      onclick={() => { tokenDialogSite = { id: site.id, name: site.name }; newToken = null; }}
                      title={hasToken ? 'Token active — click to regenerate' : 'Generate enrollment token'}
                    >
                      <KeyRound class="size-3.5" />
                      {hasToken ? 'Token' : 'Get Token'}
                    </Button>
                  {/if}

                  {#if isLinked && dattoLink}
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
                  {/if}
                </div>
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
