<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import Play from '@lucide/svelte/icons/play';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import SingleSelect from '$lib/components/single-select.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const linksQuery = createQuery(() => ({
    queryKey: ['pipeline.syncableLinks'],
    queryFn: () => trpc.pipeline.syncableLinks.query(),
  }));

  let selectedLinkId = $state('');
  let selectedType = $state('');
  let mode = $state<'full' | 'incremental'>('full');
  let force = $state(false);

  let selectedIntegrationId = $state('');
  let integrationMode = $state<'full' | 'incremental'>('full');
  let integrationForce = $state(false);

  const linkOptions = $derived.by(() => {
    return (
      linksQuery.data?.map((link) => ({
        label: `${link.integrationName} · ${link.siteName ?? link.name ?? 'unnamed'} · ${link.status}`,
        value: link.id,
      })) || []
    );
  });

  const integrationOptions = $derived.by(() => {
    const map = new Map<string, { id: string; name: string; linkCount: number }>();
    for (const link of linksQuery.data ?? []) {
      const existing = map.get(link.integrationId);
      if (existing) existing.linkCount += 1;
      else
        map.set(link.integrationId, {
          id: link.integrationId,
          name: link.integrationName,
          linkCount: 1,
        });
    }
    return Array.from(map.values()).map((integration) => ({
      label: `${integration.name} (${integration.linkCount} link${integration.linkCount === 1 ? '' : 's'})`,
      value: integration.id,
    }));
  });

  const selectedLink = $derived.by(() => {
    if (!selectedLinkId) return undefined;
    return linksQuery.data?.find((l) => l.id === selectedLinkId);
  });

  $effect(() => {
    if (selectedLink && !(selectedLink.facets as string[]).includes(selectedType)) {
      selectedType = selectedLink.facets[0] ?? '';
    }
  });

  const runsQuery = createQuery(() => ({
    queryKey: ['pipeline.recentRuns', selectedLinkId],
    queryFn: () =>
      trpc.pipeline.recentRuns.query({
        linkId: selectedLinkId || undefined,
        limit: 20,
      }),
    refetchInterval: 3_000,
    enabled: Boolean(selectedLinkId),
  }));

  const enqueue = createMutation(() => ({
    mutationFn: () =>
      trpc.pipeline.enqueueSync.mutate({
        linkId: selectedLinkId,
        type: selectedType,
        mode,
        force,
      }),
    onSuccess: (result) => {
      toast.success(`Sync queued (run ${result.syncRunId.slice(0, 8)})`);
      qc.invalidateQueries({ queryKey: ['pipeline.recentRuns', selectedLinkId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to enqueue sync'),
  }));

  const enqueueIntegration = createMutation(() => ({
    mutationFn: () =>
      trpc.pipeline.enqueueIntegrationSync.mutate({
        integrationId: selectedIntegrationId,
        mode: integrationMode,
        force: integrationForce,
      }),
    onSuccess: (result) => {
      const queuedCount = result.queued.length;
      const skippedCount = result.skipped.length;
      const parts = [`${queuedCount} queued across ${result.linkCount} link${result.linkCount === 1 ? '' : 's'}`];
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      toast.success(parts.join(' · '));
      qc.invalidateQueries({ queryKey: ['pipeline.recentRuns'] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Failed to enqueue integration'),
  }));

  function statusClass(status: string) {
    if (status === 'succeeded' || status === 'completed') return 'text-success';
    if (status === 'failed' || status === 'enqueue_failed') return 'text-destructive';
    if (status === 'running' || status === 'queued' || status === 'pending') return 'text-warning';
    return 'text-muted-foreground';
  }

  function fmtTime(value: string | null) {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString();
  }
</script>

<div class="mx-auto max-w-[1200px] space-y-4 p-4 lg:p-6">
  <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      PIPELINE / DEV CONSOLE
    </span>
    <span class="text-foreground/40">·</span>
    <span class="text-sm text-muted-foreground">
      queue ingestion jobs against the current org's active integration links
    </span>
  </div>

  <SectionPanel code="Q" title="ENQUEUE INGESTION">
    {#if linksQuery.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !linksQuery.data?.length}
      <div class="py-6 text-center text-sm text-muted-foreground">
        No active integration links with syncable facets. Configure one under Setup / Integrations
        first.
      </div>
    {:else}
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <Label for="link">Integration link</Label>
          <SingleSelect options={linkOptions} bind:selected={selectedLinkId} />
        </div>

        <div class="space-y-2">
          <Label for="facet">Facet</Label>
          <select
            id="facet"
            class="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50"
            bind:value={selectedType}
            disabled={!selectedLink}
          >
            {#each selectedLink?.facets ?? [] as facet}
              <option value={facet}>{facet}</option>
            {/each}
          </select>
        </div>

        <div class="space-y-2">
          <Label for="mode">Mode</Label>
          <select
            id="mode"
            class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            bind:value={mode}
          >
            <option value="full">Full</option>
            <option value="incremental">Incremental</option>
          </select>
        </div>

        <div class="flex items-end gap-3">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={force} />
            Force (skip active-run check)
          </label>
        </div>
      </div>

      <div class="mt-4 flex justify-end">
        <Button
          class="gap-2"
          disabled={!selectedLinkId || !selectedType || enqueue.isPending}
          onclick={() => enqueue.mutate()}
        >
          <Play class="size-4" />
          {enqueue.isPending ? 'Queueing…' : 'Enqueue sync'}
        </Button>
      </div>
    {/if}
  </SectionPanel>

  <SectionPanel code="I" title="ENQUEUE INTEGRATION">
    {#if linksQuery.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !integrationOptions.length}
      <div class="py-6 text-center text-sm text-muted-foreground">
        No integrations with syncable links available.
      </div>
    {:else}
      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2">
          <Label for="integration">Integration</Label>
          <SingleSelect options={integrationOptions} bind:selected={selectedIntegrationId} />
        </div>

        <div class="space-y-2">
          <Label for="integration-mode">Mode</Label>
          <select
            id="integration-mode"
            class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            bind:value={integrationMode}
          >
            <option value="full">Full</option>
            <option value="incremental">Incremental</option>
          </select>
        </div>

        <div class="flex items-end gap-3">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={integrationForce} />
            Force (skip active-run check)
          </label>
        </div>
      </div>

      <div class="mt-4 flex justify-end">
        <Button
          class="gap-2"
          disabled={!selectedIntegrationId || enqueueIntegration.isPending}
          onclick={() => enqueueIntegration.mutate()}
        >
          <Play class="size-4" />
          {enqueueIntegration.isPending ? 'Queueing…' : 'Enqueue all links & facets'}
        </Button>
      </div>
    {/if}
  </SectionPanel>

  <SectionPanel code="R" title="RECENT RUNS">
    {#snippet aside()}
      <button
        type="button"
        class="inline-flex items-center gap-1 hover:text-foreground"
        onclick={() => runsQuery.refetch()}
      >
        <RefreshCw class="size-3" /> refresh
      </button>
    {/snippet}

    {#if !selectedLinkId}
      <div class="py-6 text-center text-sm text-muted-foreground">
        Select a link to see its recent runs.
      </div>
    {:else if runsQuery.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !runsQuery.data?.length}
      <div class="py-6 text-center text-sm text-muted-foreground">No runs yet for this link.</div>
    {:else}
      <div
        class="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-border/40 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 md:grid"
      >
        <div>Facet</div>
        <div>Mode</div>
        <div>Status</div>
        <div>Started</div>
        <div>Finished</div>
        <div>Run ID</div>
      </div>
      {#each runsQuery.data as run (run.id)}
        <div
          class="grid grid-cols-1 gap-1 border-b border-border/40 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-3"
        >
          <div class="min-w-0 truncate font-mono text-xs">{run.type}</div>
          <div class="min-w-0 truncate font-mono text-xs text-muted-foreground">{run.mode}</div>
          <div class={`font-mono text-xs uppercase ${statusClass(run.status)}`}>{run.status}</div>
          <div class="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {fmtTime(run.startedAt)}
          </div>
          <div class="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {fmtTime(run.finishedAt)}
          </div>
          <div class="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {run.id.slice(0, 8)}
          </div>
        </div>
      {/each}
    {/if}
  </SectionPanel>
</div>
