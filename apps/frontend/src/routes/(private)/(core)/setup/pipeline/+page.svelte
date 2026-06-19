<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { Play, RefreshCw } from '@lucide/svelte';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { ProviderFacet, SyncMode } from '@mspbyte/shared';
  import type { createTrpcClient } from '$lib/trpc';
  import { Button } from '$lib/components/ui/button';
  import SingleSelect from '$lib/components/single-select.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const activeRunStatuses = new Set(['pending', 'queued', 'running']);

  let providerId = $state('microsoft-365');
  let linkId = $state('');
  let selectedFacets = $state<Record<string, boolean>>({});
  let syncMode = $state<Exclude<SyncMode, 'replay'>>('full');
  let includeDependencies = $state(true);
  let force = $state(true);
  let queueing = $state(false);
  let result = $state<{
    syncRunId: string;
    ingestRunId: string;
    facets: ProviderFacet[];
    skipped?: Array<{ facet: ProviderFacet; reason: string }>;
  } | null>(null);
  let error = $state<string | null>(null);

  const providers = $derived(
    Object.values(INTEGRATIONS).filter((i) => i.supportedFacets.length > 0)
  );
  const provider = $derived(INTEGRATIONS[providerId as keyof typeof INTEGRATIONS]);
  const facetConfigs = $derived(provider?.supportedFacets ?? []);
  const facets = $derived(facetConfigs.map((f) => f.facet) ?? []);
  const chosenFacets = $derived(facets.filter((facet) => selectedFacets[facet]));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', providerId],
    queryFn: () =>
      trpc.integrationLinks.list.query({ integrationId: providerId, status: 'active' }),
  }));

  const statusQuery = createQuery(() => ({
    queryKey: ['pipeline.syncStatus', linkId],
    enabled: Boolean(linkId),
    queryFn: () => trpc.pipeline.syncStatus.query({ linkId }),
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActiveRun = data?.recentRuns.some((run) => activeRunStatuses.has(run.status));
      return hasActiveRun || queueing ? 2_000 : false;
    },
    refetchIntervalInBackground: true,
  }));

  const hasActiveRuns = $derived(
    (statusQuery.data?.recentRuns ?? []).some((run) => activeRunStatuses.has(run.status))
  );

  $effect(() => {
    const links = linksQuery.data ?? [];
    if (!links.some((link) => link.id === linkId)) {
      linkId = links[0]?.id ?? '';
    }
  });

  function facetConfig(facet: string) {
    return facetConfigs.find((config) => config.facet === facet);
  }

  function syncContext(facet: string) {
    return statusQuery.data?.contexts.find((context) => context.type === facet);
  }

  function supportsDelta(facet: string) {
    return Boolean(facetConfig(facet)?.sync?.supportsIncremental);
  }

  function canDeltaSync(facet: string) {
    return supportsDelta(facet) && Boolean(syncContext(facet)?.cursor);
  }

  function facetDisabled(facet: ProviderFacet) {
    return syncMode === 'incremental' && !canDeltaSync(facet);
  }

  function facetModeNote(facet: ProviderFacet) {
    if (syncMode === 'full') return null;
    if (!supportsDelta(facet)) return 'Full only';
    if (!syncContext(facet)?.cursor) return 'Needs full sync';
    return 'Delta ready';
  }

  function queueableFacets() {
    return chosenFacets.filter((facet) => !facetDisabled(facet));
  }

  function setSyncMode(mode: Exclude<SyncMode, 'replay'>) {
    syncMode = mode;
    if (mode === 'full') return;

    const nextSelectedFacets = Object.fromEntries(
      Object.entries(selectedFacets).filter(([facet, selected]) => selected && canDeltaSync(facet))
    );
    const currentKeys = Object.keys(selectedFacets).filter((facet) => selectedFacets[facet]);
    const nextKeys = Object.keys(nextSelectedFacets);

    if (
      currentKeys.length !== nextKeys.length ||
      currentKeys.some((facet) => !nextSelectedFacets[facet])
    ) {
      selectedFacets = nextSelectedFacets;
    }
  }

  function toggleFacet(facet: ProviderFacet) {
    if (facetDisabled(facet)) return;
    selectedFacets = { ...selectedFacets, [facet]: !selectedFacets[facet] };
  }

  function selectAll() {
    selectedFacets = Object.fromEntries(
      facets.filter((facet) => !facetDisabled(facet)).map((facet) => [facet, true])
    );
  }

  function clearFacets() {
    selectedFacets = {};
  }

  async function queueRun() {
    const facetsToQueue = queueableFacets();
    if (!linkId || facetsToQueue.length === 0 || queueing) return;

    queueing = true;
    result = null;
    error = null;
    try {
      result = await trpc.pipeline.replay.mutate({
        linkId,
        mode: syncMode,
        facets: facetsToQueue,
        includeDependencies,
        force,
      });
      await statusQuery.refetch();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      queueing = false;
    }
  }

  function formatDate(value: Date | string | null | undefined) {
    if (!value) return 'Never';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  }

  function formatRunId(value: string) {
    return value.slice(0, 8);
  }
</script>

<div class="flex size-full flex-col gap-4 overflow-auto p-4">
  <div class="grid gap-4 xl:grid-cols-[360px_1fr]">
    <section class="rounded-lg border bg-background p-4">
      <div class="grid gap-4">
        <label class="grid gap-1 text-sm font-medium">
          Integration
          <SingleSelect
            options={providers.map((p) => ({ label: p.name, value: p.id }))}
            bind:selected={providerId}
          />
        </label>

        <label class="grid gap-1 text-sm font-medium">
          Link
          <SingleSelect
            options={(linksQuery.data ?? []).map((l) => ({ label: l.name!, value: l.id }))}
            bind:selected={linkId}
          />
        </label>

        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onclick={selectAll}>All</Button>
          <Button variant="outline" size="sm" onclick={clearFacets}>Clear</Button>
          <Button
            variant="outline"
            size="sm"
            onclick={() => statusQuery.refetch()}
            disabled={!linkId || statusQuery.isFetching}
          >
            <RefreshCw class="size-4 {statusQuery.isFetching ? 'animate-spin' : ''}" />
          </Button>
        </div>

        <div class="grid gap-2 text-sm font-medium">
          Sync mode
          <div class="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={syncMode === 'full' ? 'default' : 'outline'}
              size="sm"
              onclick={() => setSyncMode('full')}
            >
              Full
            </Button>
            <Button
              type="button"
              variant={syncMode === 'incremental' ? 'default' : 'outline'}
              size="sm"
              onclick={() => setSyncMode('incremental')}
            >
              Delta
            </Button>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={includeDependencies} />
          Include dependencies
        </label>

        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={force} />
          Force selected facets
        </label>

        <Button
          onclick={queueRun}
          disabled={!linkId || queueableFacets().length === 0 || queueing}
          class="gap-2"
        >
          <Play class="size-4" />
          {queueing ? 'Queueing' : `Queue ${syncMode === 'incremental' ? 'Delta' : 'Full'} Run`}
        </Button>

        {#if syncMode === 'incremental'}
          <div class="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Delta can be queued for facets with a saved cursor from a previous full sync.
          </div>
        {/if}

        {#if result}
          <div
            class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"
          >
            Queued {result.facets.length} facets for run {formatRunId(result.syncRunId)}.
            {#if result.skipped?.length}
              Skipped {result.skipped.length}.
            {/if}
          </div>
        {/if}

        {#if error}
          <div
            class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        {/if}
      </div>
    </section>

    <section class="rounded-lg border bg-background p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold">Facets</h2>
        <div class="text-sm text-muted-foreground">{queueableFacets().length} selected</div>
      </div>

      <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {#each facets as facet}
          {@const note = facetModeNote(facet)}
          <button
            type="button"
            class="flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 {selectedFacets[
              facet
            ]
              ? 'border-primary bg-primary/10'
              : ''}"
            onclick={() => toggleFacet(facet)}
            disabled={facetDisabled(facet)}
          >
            <span class="grid gap-0.5">
              <span class="break-all">{facet}</span>
              {#if note}
                <span class="text-xs text-muted-foreground">{note}</span>
              {/if}
            </span>
            <input type="checkbox" checked={selectedFacets[facet] ?? false} readonly />
          </button>
        {/each}
      </div>
    </section>
  </div>

  <section class="rounded-lg border bg-background">
    <div class="border-b p-4">
      <h2 class="text-base font-semibold">Sync Context</h2>
      {#if hasActiveRuns}
        <p class="mt-1 text-sm text-muted-foreground">Refreshing while runs are active.</p>
      {/if}
    </div>
    <div class="overflow-auto">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/50 text-left">
          <tr>
            <th class="px-4 py-2 font-medium">Facet</th>
            <th class="px-4 py-2 font-medium">Last Success</th>
            <th class="px-4 py-2 font-medium">Full</th>
            <th class="px-4 py-2 font-medium">Delta</th>
            <th class="px-4 py-2 font-medium">Cursor</th>
            <th class="px-4 py-2 font-medium">Failures</th>
            <th class="px-4 py-2 font-medium">Last Error</th>
          </tr>
        </thead>
        <tbody>
          {#each statusQuery.data?.contexts ?? [] as context}
            <tr class="border-b last:border-0">
              <td class="px-4 py-2">{context.type}</td>
              <td class="px-4 py-2">{formatDate(context.lastSuccessAt)}</td>
              <td class="px-4 py-2">{formatDate(context.fullSyncAt)}</td>
              <td class="px-4 py-2">{formatDate(context.incrementalSyncAt)}</td>
              <td class="px-4 py-2">{context.cursor ? 'Saved' : ''}</td>
              <td class="px-4 py-2">{context.consecutiveFailures}</td>
              <td class="max-w-lg truncate px-4 py-2">{context.lastErrorMessage ?? ''}</td>
            </tr>
          {:else}
            <tr>
              <td class="px-4 py-6 text-muted-foreground" colspan="7"
                >No sync context for this link.</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="rounded-lg border bg-background">
    <div class="border-b p-4">
      <h2 class="text-base font-semibold">Recent Runs</h2>
    </div>
    <div class="overflow-auto">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/50 text-left">
          <tr>
            <th class="px-4 py-2 font-medium">Run</th>
            <th class="px-4 py-2 font-medium">Type</th>
            <th class="px-4 py-2 font-medium">Mode</th>
            <th class="px-4 py-2 font-medium">Status</th>
            <th class="px-4 py-2 font-medium">Started</th>
            <th class="px-4 py-2 font-medium">Finished</th>
          </tr>
        </thead>
        <tbody>
          {#each statusQuery.data?.recentRuns ?? [] as run}
            <tr class="border-b last:border-0">
              <td class="px-4 py-2 font-mono">{formatRunId(run.id)}</td>
              <td class="px-4 py-2">{run.type}</td>
              <td class="px-4 py-2">{run.mode}</td>
              <td class="px-4 py-2">{run.status}</td>
              <td class="px-4 py-2">{formatDate(run.startedAt)}</td>
              <td class="px-4 py-2">{formatDate(run.finishedAt)}</td>
            </tr>
          {:else}
            <tr>
              <td class="px-4 py-6 text-muted-foreground" colspan="6">No runs for this link.</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>
