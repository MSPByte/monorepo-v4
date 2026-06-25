<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { toast } from 'svelte-sonner';
  import {
    Building2,
    CircleCheck,
    CircleX,
    Wand2,
    Save,
    MessageSquare,
    Search,
    Plus,
    LoaderCircle,
  } from '@lucide/svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';

  export type ExternalOption = {
    id: string;
    name: string;
    meta?: Record<string, unknown>;
  };

  type DispositionType = 'third_party' | 'not_managed';
  type FilterType = 'All' | 'Linked' | 'Unlinked' | 'Dispositioned';

  let {
    integration,
    externalLabel,
    externalOptions,
    loadingExternal,
    canWrite,
    isConfigured,
  }: {
    integration: string;
    externalLabel: string;
    externalOptions: ExternalOption[];
    loadingExternal: boolean;
    canWrite: boolean;
    isConfigured: boolean;
  } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();
  const canWriteSites = $derived(authStore.isAllowed('Sites.Write'));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', integration],
    queryFn: () =>
      trpc.integrationLinks.list.query({ integrationId: integration, status: 'active' }),
    enabled: isConfigured,
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const createLinkMutation = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.integrationLinks.create.mutate>[0]) =>
      trpc.integrationLinks.create.mutate(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['integrationLinks.list', integration] }),
  }));

  const saveSiteLinksMutation = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.integrationLinks.saveSiteLinks.mutate>[0]) =>
      trpc.integrationLinks.saveSiteLinks.mutate(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['integrationLinks.list', integration] }),
  }));

  const dbSites = $derived(sitesQuery.data ?? []);
  const dbLinks = $derived(linksQuery.data ?? []);
  const loading = $derived(linksQuery.isLoading || sitesQuery.isLoading);

  const committedMappings = $derived(
    Object.fromEntries(
      dbLinks
        .filter((l) => !!l.siteId && !!l.externalId)
        .map((l) => [l.siteId as string, l.externalId])
    )
  );
  const committedDispositions = $derived(
    Object.fromEntries(
      dbLinks
        .filter((l) => !!l.siteId && !!l.disposition)
        .map((l) => [l.siteId as string, l.disposition as DispositionType])
    )
  );
  const committedNotes = $derived(
    Object.fromEntries(
      dbLinks.filter((l) => !!l.siteId && !!l.note).map((l) => [l.siteId as string, l.note!])
    )
  );

  let pendingMappings = $state<Record<string, string | undefined>>({});
  let pendingDispositions = $state<Record<string, DispositionType | null>>({});
  let pendingNotes = $state<Record<string, string | undefined>>({});
  let initialized = $state(false);
  let saving = $state(false);
  let siteSearch = $state('');
  let unmappedSearch = $state('');
  let activeFilter = $state<FilterType>('All');
  let creatingFromVendor = $state<string | null>(null);

  function initFromCommitted() {
    const nextM: Record<string, string | undefined> = {};
    const nextD: Record<string, DispositionType | null> = {};
    const nextN: Record<string, string | undefined> = {};
    for (const site of dbSites) {
      nextM[site.id] = committedMappings[site.id] ?? undefined;
      nextD[site.id] = (committedDispositions[site.id] as DispositionType) ?? null;
      nextN[site.id] = committedNotes[site.id] ?? undefined;
    }
    pendingMappings = nextM;
    pendingDispositions = nextD;
    pendingNotes = nextN;
  }

  $effect(() => {
    if (!initialized && !loading) {
      initFromCommitted();
      initialized = true;
    }
  });

  const linkedSiteIds = $derived(
    new Set(Object.keys(pendingMappings).filter((k) => !!pendingMappings[k]))
  );
  const dispositionedSiteIds = $derived(
    new Set(Object.keys(pendingDispositions).filter((k) => !!pendingDispositions[k]))
  );

  const isDirty = $derived(
    dbSites.some((s) => {
      const mappingDiff = (pendingMappings[s.id] ?? null) !== (committedMappings[s.id] ?? null);
      const dispositionDiff =
        (pendingDispositions[s.id] ?? null) !== (committedDispositions[s.id] ?? null);
      const noteDiff = (pendingNotes[s.id] || null) !== (committedNotes[s.id] || null);
      return mappingDiff || dispositionDiff || noteDiff;
    })
  );

  const metrics = $derived({
    total: dbSites.length,
    linked: linkedSiteIds.size,
    dispositioned: dispositionedSiteIds.size,
    unlinked: dbSites.length - linkedSiteIds.size - dispositionedSiteIds.size,
  });

  const filteredSites = $derived(
    dbSites
      .filter((s) => s.name.toLowerCase().includes(siteSearch.toLowerCase()))
      .filter((s) => {
        if (activeFilter === 'Linked') return linkedSiteIds.has(s.id);
        if (activeFilter === 'Unlinked')
          return !linkedSiteIds.has(s.id) && !dispositionedSiteIds.has(s.id);
        if (activeFilter === 'Dispositioned') return dispositionedSiteIds.has(s.id);
        return true;
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  );

  const mappedExternalIds = $derived(
    new Set(Object.values(pendingMappings).filter(Boolean) as string[])
  );
  const unmappedExternal = $derived(
    externalOptions
      .filter((o) => !mappedExternalIds.has(o.id))
      .filter((o) => o.name.toLowerCase().includes(unmappedSearch.toLowerCase()))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  );

  function setMapping(siteId: string, externalId: string | undefined) {
    pendingMappings[siteId] = externalId || undefined;
    if (externalId) pendingDispositions[siteId] = null;
  }

  function setDisposition(siteId: string, value: DispositionType | null) {
    pendingDispositions[siteId] = value;
    if (value) pendingMappings[siteId] = undefined;
  }

  function normalize(s: string): string[] {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  function jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(normalize(a));
    const setB = new Set(normalize(b));
    if (setA.size === 0 && setB.size === 0) return 1;
    const intersection = [...setA].filter((w) => setB.has(w)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
  }

  function runAutoMap() {
    const taken = new Set(Object.values(pendingMappings).filter(Boolean) as string[]);
    const next = { ...pendingMappings };
    for (const site of dbSites) {
      if (next[site.id] || pendingDispositions[site.id]) continue;
      let bestScore = 0.3;
      let bestId: string | undefined;
      for (const opt of externalOptions) {
        if (taken.has(opt.id)) continue;
        const score = jaccardSimilarity(site.name, opt.name);
        if (score > bestScore) {
          bestScore = score;
          bestId = opt.id;
        }
      }
      if (bestId) {
        next[site.id] = bestId;
        taken.add(bestId);
      }
    }
    pendingMappings = next;
  }

  async function handleSave() {
    saving = true;
    try {
      const changes = dbSites.filter((s) => {
        const mappingDiff = (pendingMappings[s.id] ?? null) !== (committedMappings[s.id] ?? null);
        const dispositionDiff =
          (pendingDispositions[s.id] ?? null) !== (committedDispositions[s.id] ?? null);
        const noteDiff = (pendingNotes[s.id] || null) !== (committedNotes[s.id] || null);
        return mappingDiff || dispositionDiff || noteDiff;
      });

      await saveSiteLinksMutation.mutateAsync({
        integrationId: integration,
        changes: changes.map((s) => {
          const externalId = pendingMappings[s.id] || undefined;
          const external = externalOptions.find((o) => o.id === externalId);

          return {
            siteId: s.id,
            externalId: externalId ?? null,
            name: external?.name ?? s.name,
            disposition: externalId ? null : (pendingDispositions[s.id] ?? null),
            note: pendingNotes[s.id] || null,
            meta: external?.meta ?? null,
          };
        }),
      });

      toast.success('Mappings saved!');
      initialized = false;
    } catch (err) {
      toast.error(`Failed to save: ${err}`);
    } finally {
      saving = false;
    }
  }

  async function createSiteFromVendor(opt: ExternalOption) {
    if (!canWriteSites) {
      toast.error('Sites.Write permission required');
      return;
    }
    creatingFromVendor = opt.id;
    try {
      const site = await trpc.sites.create.mutate({ name: opt.name });
      await createLinkMutation.mutateAsync({
        integrationId: integration,
        siteId: site.id,
        externalId: opt.id,
        name: opt.name,
        status: 'active',
        meta: opt.meta,
      });
      toast.success(`Site "${opt.name}" created and linked!`);
      await queryClient.invalidateQueries({ queryKey: ['sites.list'] });
    } catch (err) {
      toast.error(`Failed to create site: ${err}`);
    } finally {
      creatingFromVendor = null;
    }
  }

  const FILTERS: FilterType[] = ['All', 'Linked', 'Unlinked', 'Dispositioned'];
</script>

<!-- Metrics strip -->
<div class="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
  <Card.Root class="p-4">
    <div class="flex flex-col gap-1">
      <span class="text-xs text-muted-foreground">Total Sites</span>
      <span class="text-2xl font-bold">{loading ? '—' : metrics.total}</span>
    </div>
  </Card.Root>
  <Card.Root class="p-4">
    <div class="flex flex-col gap-1">
      <span class="text-xs text-muted-foreground">Linked</span>
      <span class="text-2xl font-bold text-primary">{loading ? '—' : metrics.linked}</span>
    </div>
  </Card.Root>
  <Card.Root class="p-4">
    <div class="flex flex-col gap-1">
      <span class="text-xs text-muted-foreground">Dispositioned</span>
      <span class="text-2xl font-bold text-warning">{loading ? '—' : metrics.dispositioned}</span>
    </div>
  </Card.Root>
  <Card.Root class="p-4">
    <div class="flex flex-col gap-1">
      <span class="text-xs text-muted-foreground">Unlinked</span>
      <span class="text-2xl font-bold text-destructive">{loading ? '—' : metrics.unlinked}</span>
    </div>
  </Card.Root>
  <Card.Root class="p-4">
    <div class="flex flex-col gap-1">
      <span class="text-xs text-muted-foreground">Connection Health</span>
      {#if loading}
        <span class="text-2xl font-bold">—</span>
      {:else if isConfigured}
        <span class="text-sm font-medium text-primary flex items-center gap-1">
          <CircleCheck class="size-4" /> Connected
        </span>
      {:else}
        <span class="text-sm font-medium text-destructive flex items-center gap-1">
          <CircleX class="size-4" /> Not set up
        </span>
      {/if}
    </div>
  </Card.Root>
</div>

<!-- Toolbar -->
<div class="flex gap-2 items-center shrink-0 w-full">
  <div class="relative w-72">
    <Search
      class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none"
    />
    <Input bind:value={siteSearch} placeholder="Search sites..." class="h-8 pl-8" />
  </div>
  <div class="flex gap-1.5 shrink-0">
    {#each FILTERS as filter}
      <button
        class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
          {activeFilter === filter
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:border-foreground/30'}"
        onclick={() => (activeFilter = filter)}
      >
        {filter}
      </button>
    {/each}
  </div>
  {#if canWrite}
    <div class="flex gap-2 ml-auto shrink-0">
      <Button
        variant="outline"
        size="sm"
        class="gap-2"
        disabled={loadingExternal || externalOptions.length === 0}
        onclick={runAutoMap}
      >
        <Wand2 class="size-4" />
        AutoMap
      </Button>
      <Button size="sm" class="gap-2" disabled={!isDirty || saving} onclick={handleSave}>
        {#if saving}
          <LoaderCircle class="size-4 animate-spin" />
          Saving...
        {:else}
          <Save class="size-4" />
          Save
        {/if}
      </Button>
    </div>
  {/if}
</div>

{#if loadingExternal}
  <Loader />
{:else}
  <FadeIn class="flex-1 overflow-hidden flex flex-col min-h-0 border rounded-md">
    {#if loading}
      <Loader />
    {:else if filteredSites.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <Building2 class="size-8 opacity-40" />
        <span class="text-sm">No sites found</span>
      </div>
    {:else}
      <div
        class="grid grid-cols-[1fr_1fr_11rem] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30 shrink-0"
      >
        <span>Site</span>
        <span>{externalLabel}</span>
        <span>Disposition / Note</span>
      </div>
      <div class="flex-1 overflow-y-auto divide-y">
        {#each filteredSites as site (site.id)}
          {@const isLinked = !!pendingMappings[site.id]}
          {@const isDispositioned = !!pendingDispositions[site.id]}
          {@const disposition = pendingDispositions[site.id]}
          {@const hasNote = !!pendingNotes[site.id]}
          {@const takenByOthers = new Set(
            Object.entries(pendingMappings)
              .filter(([k, v]) => k !== site.id && !!v)
              .map(([, v]) => v as string)
          )}
          {@const rowOptions = externalOptions
            .filter((o) => !takenByOthers.has(o.id))
            .map((o) => ({ label: o.name, value: o.id }))}
          <div
            class="grid grid-cols-[1fr_1fr_11rem] gap-4 px-4 py-3 items-center hover:bg-muted/20 transition-colors"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="font-medium text-sm truncate">{site.name}</span>
              {#if isLinked}
                <Badge
                  class="text-xs shrink-0 bg-primary/15 text-primary border-primary/30"
                  variant="outline"
                >
                  LINKED
                </Badge>
              {:else if isDispositioned}
                <Badge
                  class="text-xs shrink-0 bg-warning/15 text-warning border-warning/30"
                  variant="outline"
                >
                  {disposition === 'third_party' ? 'THIRD PARTY' : 'NOT MANAGED'}
                </Badge>
              {:else}
                <Badge
                  class="text-xs shrink-0 bg-muted-foreground/15 text-muted-foreground border-muted-foreground/30"
                  variant="outline"
                >
                  UNLINKED
                </Badge>
              {/if}
            </div>

            <SingleSelect
              selected={pendingMappings[site.id] ?? ''}
              onchange={(e) => setMapping(site.id, e || undefined)}
              disabled={loadingExternal || !canWrite || isDispositioned}
              options={rowOptions}
            />

            <div class="flex items-center gap-1">
              <select
                value={pendingDispositions[site.id] ?? ''}
                onchange={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  setDisposition(site.id, val ? (val as DispositionType) : null);
                }}
                disabled={!canWrite || isLinked}
                class="flex-1 min-w-0 h-7 text-xs rounded border bg-background px-2 appearance-none
                text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed
                focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">—</option>
                <option value="third_party">Third Party</option>
                <option value="not_managed">Not Managed</option>
              </select>

              <Popover.Root>
                <Popover.Trigger
                  class="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted/50
                  {hasNote ? 'text-primary' : 'text-muted-foreground'}"
                  aria-label="Edit note"
                >
                  <MessageSquare class="size-3.5 {hasNote ? 'fill-primary/20' : ''}" />
                </Popover.Trigger>
                <Popover.Content align="end" class="w-64 p-3 flex flex-col gap-2">
                  <span class="text-xs font-medium text-muted-foreground">Note</span>
                  <Textarea
                    value={pendingNotes[site.id] ?? ''}
                    oninput={(e) => {
                      pendingNotes[site.id] = (e.target as HTMLTextAreaElement).value || undefined;
                    }}
                    placeholder="Add a note..."
                    class="text-sm resize-none min-h-20"
                    disabled={!canWrite}
                  />
                  <span class="text-xs text-muted-foreground">Saved with the Save button.</span>
                </Popover.Content>
              </Popover.Root>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </FadeIn>
{/if}

{#if !loadingExternal && unmappedExternal.length > 0}
  <FadeIn class="shrink-0 flex flex-col border rounded-md overflow-hidden max-h-70">
    <div
      class="flex items-center justify-between px-4 py-2.5 bg-warning/5 border-b border-warning/20 shrink-0"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-warning">
          {unmappedExternal.length} unmapped {externalLabel}{unmappedExternal.length !== 1
            ? 's'
            : ''}
        </span>
        <span class="text-xs text-muted-foreground">not linked to any site</span>
      </div>
      <div class="relative w-52">
        <Search
          class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none"
        />
        <Input
          bind:value={unmappedSearch}
          placeholder="Search unmapped..."
          class="h-7 pl-7 text-xs"
        />
      </div>
    </div>

    <div class="overflow-y-auto divide-y flex-1">
      {#each unmappedExternal as opt (opt.id)}
        <div
          class="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors"
        >
          <div class="flex flex-col gap-0.5 min-w-0 mr-3">
            <span class="text-sm font-medium truncate">{opt.name}</span>
            <span class="text-xs text-muted-foreground font-mono truncate">{opt.id}</span>
          </div>
          {#if canWrite && canWriteSites}
            <Button
              variant="outline"
              size="sm"
              class="gap-1.5 shrink-0 text-xs h-7"
              disabled={creatingFromVendor === opt.id}
              onclick={() => createSiteFromVendor(opt)}
            >
              {#if creatingFromVendor === opt.id}
                <LoaderCircle class="size-3 animate-spin" />
              {:else}
                <Plus class="size-3" />
              {/if}
              Create Site
            </Button>
          {/if}
        </div>
      {/each}
    </div>
  </FadeIn>
{/if}
