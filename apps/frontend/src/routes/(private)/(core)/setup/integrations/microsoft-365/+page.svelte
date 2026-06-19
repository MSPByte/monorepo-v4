<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { INTEGRATIONS, CONSENT_VERSION } from '@mspbyte/shared';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import {
    Settings,
    TriangleAlert,
    Users,
    Globe,
    CircleCheck,
    CircleX,
    LoaderCircle,
    Plus,
  } from '@lucide/svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import SelectedLink from './_selected-link.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  type Link = inferRouterOutputs<AppRouter>['integrationLinks']['list'][number];

  // MS_CAPABILITIES not in v2 shared — define locally
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

  const integration = INTEGRATIONS['microsoft-365'];
  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const integrationQuery = createQuery(() => ({
    queryKey: ['integrations.get', 'microsoft-365'],
    queryFn: () => trpc.integrations.get.query({ id: 'microsoft-365' }),
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'microsoft-365', 'setup'],
    queryFn: () => trpc.integrationLinks.list.query({ integrationId: 'microsoft-365' }),
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const dbIntegration = $derived(integrationQuery.data ?? null);
  const loading = $derived(integrationQuery.isLoading || linksQuery.isLoading);

  const tenantLinks = $derived((linksQuery.data ?? []).filter((l) => !l.siteId));
  const siteLinks = $derived((linksQuery.data ?? []).filter((l) => !!l.siteId));
  const dbSites = $derived(sitesQuery.data ?? []);

  const activeLinks = $derived(tenantLinks.filter((l) => l.status === 'active'));

  const metrics = $derived({
    total: tenantLinks.length,
    active: activeLinks.length,
    withIssues: activeLinks.filter(
      (l) => (l.meta as Record<string, unknown>)?.consentVersion !== CONSENT_VERSION
    ).length,
    totalUnmapped: activeLinks.reduce((acc, al) => {
      const mapped = siteLinks
        .filter((sl) => sl.externalId === al.externalId)
        .reduce(
          (dacc, sl) =>
            dacc + (((sl.meta as Record<string, unknown>)?.domains as unknown[]) ?? []).length,
          0
        );
      return (
        acc + (((al.meta as Record<string, unknown>)?.domains as unknown[]) ?? []).length - mapped
      );
    }, 0),
    isConfigured: !!(dbIntegration && !dbIntegration.deletedAt),
  });

  let selectedLinkId = $state<string | null>(null);
  let connectionSearch = $state('');
  let activeFilter = $state<
    'All' | 'Active' | 'Manual' | 'Needs Consent' | 'Has Unmapped' | 'Missing Capabilities'
  >('All');
  let configSheetOpen = $state(false);
  let addTenantOpen = $state(false);
  let showDeleteConfirm = $state(false);
  let syncing = $state(false);
  let addingTenant = $state(false);

  const selectedLink = $derived(tenantLinks.find((l) => l.id === selectedLinkId) ?? null);

  const domainSiteMap = $derived.by(() => {
    const map = new Map<string, string>();
    if (!selectedLink) return map;
    for (const sl of siteLinks) {
      if (sl.externalId !== selectedLink.externalId) continue;
      const slDomains = ((sl.meta as Record<string, unknown>)?.domains as string[]) ?? [];
      const tlDomains = ((selectedLink.meta as Record<string, unknown>)?.domains as string[]) ?? [];
      for (const domain of slDomains) {
        if (!tlDomains.includes(domain)) continue;
        if (sl.siteId) map.set(domain, sl.siteId);
      }
    }
    return map;
  });

  const missingCapsCount = (link: Link): number =>
    Object.keys(MS_CAPABILITIES).filter(
      (key) =>
        (
          (link.meta as Record<string, unknown>)?.capabilities as
            | Record<string, boolean>
            | undefined
        )?.[key] === false
    ).length;

  const evaluateLinkFilter = (active: typeof activeFilter, link: Link) => {
    switch (active) {
      case 'All':
        return true;
      case 'Manual':
        return (link.meta as Record<string, unknown> | null)?.source === 'manual';
      case 'Has Unmapped': {
        if (link.status !== 'active') return false;
        const domainCount = siteLinks
          .filter((sl) => sl.externalId === link.externalId)
          .reduce(
            (acc, sl) =>
              acc + (((sl.meta as Record<string, unknown>)?.domains as unknown[]) ?? []).length,
            0
          );
        return (
          domainCount <
          (((link.meta as Record<string, unknown>)?.domains as unknown[]) ?? []).length
        );
      }
      case 'Active':
        return link.status === 'active';
      case 'Needs Consent':
        return (
          (link.meta as Record<string, unknown>)?.consentVersion !== CONSENT_VERSION &&
          link.status === 'active'
        );
      case 'Missing Capabilities':
        return link.status === 'active' && missingCapsCount(link) > 0;
      default:
        return true;
    }
  };

  const filteredLinks = $derived(
    tenantLinks
      .filter((l) =>
        (l.name ?? l.externalId ?? '').toLowerCase().includes(connectionSearch.toLowerCase())
      )
      .filter((l) => evaluateLinkFilter(activeFilter, l))
      .sort((a, b) => (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase()))
  );

  // URL param toasts
  $effect(() => {
    const error = page.url.searchParams.get('error');
    const initialConsent = page.url.searchParams.get('initialConsent');
    const consentedTenant = page.url.searchParams.get('consentedTenant');

    if (initialConsent) {
      toast.info('Microsoft 365 consent successful!');
    } else if (consentedTenant) {
      const link = tenantLinks.find((l) => l.externalId === consentedTenant);
      if (link) {
        toast.info(`Successfully consented for tenant ${link.name ?? link.externalId}`);
        selectedLinkId = link.id;
      }
    } else if (error) {
      toast.error(`Failed to complete the consent flow: ${error}`);
    }

    if (error || initialConsent || consentedTenant) {
      goto('?', { replaceState: true });
    }
  });
</script>

<!-- Delete integration confirm -->
<AlertDialog.Root bind:open={showDeleteConfirm}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete Microsoft 365 Integration?</AlertDialog.Title>
      <AlertDialog.Description>
        This will remove the Microsoft 365 integration from your account. All associated data
        (tenants, identities, domains) will be permanently deleted after 30 days. This action can be
        undone before that window expires.
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
          class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
        >
          Delete Integration
        </AlertDialog.Action>
      </form>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- Add manual tenant dialog -->
{#if authStore.isAllowed('Integrations.Write')}
  <Dialog.Root bind:open={addTenantOpen}>
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>Add Microsoft 365 Tenant</Dialog.Title>
        <Dialog.Description>
          Add a tenant that is not returned by GDAP. It will stay in the tenant list during GDAP
          resyncs.
        </Dialog.Description>
      </Dialog.Header>
      <form
        method="POST"
        action="?/addTenant"
        class="flex flex-col gap-4"
        use:enhance={({ formElement }) => {
          addingTenant = true;
          return async ({ result }) => {
            addingTenant = false;
            if (result.type === 'failure') {
              toast.error(
                ((result.data as Record<string, unknown>)?.error as string) ??
                  'Failed to add tenant'
              );
            } else if (result.type === 'success') {
              const data = result.data as
                | { created?: boolean; link?: Link; links?: Link[] }
                | undefined;
              if (data?.links) {
                queryClient.setQueryData(['integrationLinks.list', 'microsoft-365'], data.links);
              } else {
                void queryClient.invalidateQueries({
                  queryKey: ['integrationLinks.list', 'microsoft-365'],
                });
              }
              if (data?.link) selectedLinkId = data.link.id;
              addTenantOpen = false;
              formElement.reset();
              toast.success(data?.created === false ? 'Tenant already exists' : 'Tenant added');
            }
          };
        }}
      >
        <div class="flex flex-col gap-2">
          <label for="tenantId" class="text-sm font-medium">Tenant ID or domain</label>
          <Input
            id="tenantId"
            name="tenantId"
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="tenantName" class="text-sm font-medium">Display name</label>
          <Input id="tenantName" name="name" placeholder="Contoso" />
        </div>
        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (addTenantOpen = false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={addingTenant}>
            {#if addingTenant}
              <LoaderCircle class="size-4 animate-spin" />
            {:else}
              <Plus class="size-4" />
            {/if}
            Add Tenant
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- Configuration Sheet -->
{#if authStore.isAllowed('Integrations.Write')}
  <Sheet.Root bind:open={configSheetOpen}>
    <Sheet.Portal>
      <Sheet.Overlay />
      <Sheet.Content side="right" class="flex w-105 flex-col gap-0 p-0">
        <Sheet.Header class="border-b p-4">
          <Sheet.Title>Configure Microsoft 365</Sheet.Title>
          <Sheet.Description>Set up your M365 integration credentials.</Sheet.Description>
        </Sheet.Header>

        <div class="flex flex-1 flex-col overflow-y-auto p-4">
          <Card.Root class="border-primary/20 bg-primary/5">
            <Card.Header class="pb-2">
              <Card.Title class="text-base">GDAP Partner Connection</Card.Title>
            </Card.Header>
            <Card.Content>
              <p class="mb-4 text-sm text-muted-foreground">
                Connect MSPByte as a partner application through Microsoft's Granular Delegated
                Admin Privileges (GDAP) framework. This allows managing multiple customer tenants
                without requiring per-tenant credentials.
              </p>
              <form method="POST" action="?/initialConsent" use:enhance>
                <Button variant="outline" size="sm" type="submit">Connect MSPByte</Button>
              </form>
            </Card.Content>
          </Card.Root>
        </div>

        <Sheet.Footer class="border-t p-4">
          {#if metrics.isConfigured}
            <Button
              variant="destructive"
              onclick={() => {
                configSheetOpen = false;
                showDeleteConfirm = true;
              }}
            >
              Delete Integration
            </Button>
          {/if}
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Portal>
  </Sheet.Root>
{/if}

<!-- TODO: Make header helper for all integrations -->
<!-- Main Layout -->
<div class="flex size-full flex-col gap-4 overflow-hidden p-4">
  <!-- Header -->
  <div class="flex shrink-0 items-start justify-between">
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center gap-2">
        <h1 class="text-lg font-semibold">{integration.name}</h1>
        <Badge
          variant="outline"
          class="{metrics.isConfigured
            ? 'border-success/30 bg-success/15 text-success'
            : 'bg-muted text-muted-foreground'} text-xs"
        >
          {metrics.isConfigured ? 'Configured' : 'Not configured'}
        </Badge>
      </div>
      <p class="text-xs text-muted-foreground">
        Manage Microsoft 365 tenant connections.
      </p>
    </div>
    <div class="flex gap-2">
      {#if authStore.isAllowed('Integrations.Write')}
        <Button
          variant="outline"
          size="sm"
          onclick={() => (addTenantOpen = true)}
          class="gap-2"
          disabled={!metrics.isConfigured}
        >
          <Plus class="size-4" />
          Add Tenant
        </Button>
        <form
          method="POST"
          action="?/gdapSync"
          use:enhance={() => {
            syncing = true;
            return async ({ result }) => {
              syncing = false;
              if (result.type === 'failure') {
                toast.error(
                  ((result.data as Record<string, unknown>)?.error as string) ?? 'GDAP sync failed'
                );
              } else if (result.type === 'success') {
                const data = result.data as
                  | { inserted?: number; removed?: number; links?: Link[] }
                  | undefined;
                if (data?.links) {
                  queryClient.setQueryData(['integrationLinks.list', 'microsoft-365'], data.links);
                } else {
                  void queryClient.invalidateQueries({
                    queryKey: ['integrationLinks.list', 'microsoft-365'],
                  });
                }
                toast.success(
                  `GDAP sync complete — ${data?.inserted ?? 0} added, ${data?.removed ?? 0} removed`
                );
              }
            };
          }}
        >
          <Button variant="outline" size="sm" type="submit" disabled={syncing} class="gap-2">
            <LoaderCircle class="size-4 {syncing ? 'animate-spin' : ''}" />
            Resync GDAP
          </Button>
        </form>
        <Button variant="outline" size="sm" onclick={() => (configSheetOpen = true)} class="gap-2">
          <Settings class="size-4" />
          Configure
        </Button>
      {/if}
    </div>
  </div>

  {#if metrics.isConfigured}
    <Tabs.Root value="connections" class="flex flex-1 flex-col gap-3 overflow-hidden">
      <Tabs.List class="w-fit shrink-0">
        <Tabs.Trigger value="connections">Connections</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="connections" class="mt-0 flex flex-1 flex-col gap-4 overflow-hidden">
        <!-- Metrics strip -->
        <div class="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Card.Root class="p-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">Total Tenants</span>
              <span class="text-2xl font-bold">{loading ? '—' : metrics.total}</span>
            </div>
          </Card.Root>
          <Card.Root class="p-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">Active</span>
              <span class="text-2xl font-bold text-primary">{loading ? '—' : metrics.active}</span>
            </div>
          </Card.Root>
          <Card.Root class="p-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">Needs Action</span>
              <span class="text-2xl font-bold text-warning"
                >{loading ? '—' : metrics.withIssues}</span
              >
            </div>
          </Card.Root>
          <Card.Root class="p-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">Unmapped</span>
              <span class="text-2xl font-bold text-destructive"
                >{loading ? '—' : metrics.totalUnmapped}</span
              >
            </div>
          </Card.Root>
          <Card.Root class="p-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">Config Health</span>
              {#if loading}
                <span class="text-2xl font-bold">—</span>
              {:else if metrics.isConfigured}
                <span class="flex items-center gap-1 text-sm font-medium text-primary">
                  <CircleCheck class="size-4" /> Healthy
                </span>
              {:else}
                <span class="flex items-center gap-1 text-sm font-medium text-destructive">
                  <CircleX class="size-4" /> Not set up
                </span>
              {/if}
            </div>
          </Card.Root>
        </div>

        {#if !loading && !metrics.isConfigured}
          <div
            class="flex shrink-0 items-center gap-3 rounded border border-warning/30 bg-warning/10 px-4 py-3 text-warning"
          >
            <TriangleAlert class="size-4 shrink-0" />
            <span class="text-sm">
              Microsoft 365 is not configured yet. Click <strong>Configure</strong> to set up your credentials.
            </span>
          </div>
        {/if}

        <!-- Search + filters -->
        <div class="flex w-full shrink-0 items-center gap-2">
          <div class="w-80">
            <Input bind:value={connectionSearch} placeholder="Search tenants..." class="h-8" />
          </div>
          <div class="flex shrink-0 flex-wrap gap-1.5">
            {#each ['All', 'Active', 'Manual', 'Needs Consent', 'Has Unmapped', 'Missing Capabilities'] as filter}
              <button
                class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors
                {activeFilter === filter
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-foreground/30'}"
                onclick={() => (activeFilter = filter as typeof activeFilter)}
              >
                {filter}
              </button>
            {/each}
          </div>
        </div>

        <!-- Tenant list + selected panel -->
        <FadeIn class="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <div
            class="flex flex-col gap-4 overflow-hidden transition-all duration-200 {selectedLinkId
              ? 'w-96'
              : 'flex-1'}"
          >
            <div class="flex-1 overflow-y-auto pr-1">
              {#if loading}
                <Loader />
              {:else if filteredLinks.length === 0}
                <div
                  class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
                >
                  <Globe class="size-8 opacity-40" />
                  <span class="text-sm">No tenants found</span>
                </div>
              {:else}
                <div
                  class="grid gap-3 {selectedLinkId
                    ? 'grid-cols-1'
                    : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}"
                >
                  {#each filteredLinks as link (link.id)}
                    {@const missing = missingCapsCount(link)}
                    <button
                      class="w-full text-left"
                      onclick={() => (selectedLinkId = selectedLinkId === link.id ? null : link.id)}
                    >
                      <Card.Root
                        class="h-24 cursor-pointer p-3 transition-colors hover:border-primary/50 {selectedLinkId ===
                        link.id
                          ? 'border-primary bg-primary/10'
                          : 'bg-card/70'}"
                      >
                        <div class="flex h-full flex-col justify-between gap-2">
                          <div class="flex items-start justify-between gap-2">
                            <span class="min-w-0 truncate text-sm leading-tight font-medium">
                              {link.name ?? link.externalId}
                            </span>
                            <div class="flex shrink-0 items-center gap-1">
                              <Badge
                                class="shrink-0 text-xs {link.status === 'active'
                                  ? 'border-success/30 bg-success/15 text-success'
                                  : 'border-muted-foreground/30 bg-muted-foreground/15 text-muted-foreground'}"
                                variant="outline"
                              >
                                {link.status?.toUpperCase() ?? 'UNKNOWN'}
                              </Badge>
                              {#if (link.meta as Record<string, unknown> | null)?.source === 'manual'}
                                <Badge
                                  class="shrink-0 border-blue-500/20 bg-blue-500/10 text-xs text-blue-700"
                                  variant="outline"
                                >
                                  MANUAL
                                </Badge>
                              {/if}
                            </div>
                          </div>
                          <div class="flex items-center gap-3 text-xs text-muted-foreground">
                            <span class="flex items-center gap-1">
                              <Globe class="size-3" />
                              {(
                                ((link.meta as Record<string, unknown>)?.domains as unknown[]) ?? []
                              ).length} domains
                            </span>
                            <span class="flex items-center gap-1">
                              <Users class="size-3" />
                              {(link.meta as Record<string, unknown>)?.userCount ?? 0} users
                            </span>
                            {#if missing > 0}
                              <span class="flex items-center gap-1 text-warning">
                                <TriangleAlert class="size-3 text-amber-500" />
                                {missing} missing
                              </span>
                            {/if}
                          </div>
                        </div>
                      </Card.Root>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

          {#if selectedLink}
            <SelectedLink
              {selectedLink}
              {domainSiteMap}
              {dbSites}
              {siteLinks}
              deselect={() => (selectedLinkId = null)}
            />
          {/if}
        </FadeIn>
      </Tabs.Content>
    </Tabs.Root>
  {:else if loading}
    <Loader />
  {:else}
    <div class="flex size-full flex-col items-center justify-center">
      <div
        class="flex w-fit items-center gap-3 rounded border border-warning/30 bg-warning/10 px-4 py-3 text-warning"
      >
        <TriangleAlert class="size-4" />
        <span class="text-sm">
          Microsoft 365 is not configured yet. Click <strong>Configure</strong> to set up your credentials.
        </span>
      </div>
    </div>
  {/if}
</div>
