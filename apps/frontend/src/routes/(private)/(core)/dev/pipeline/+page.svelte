<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import CoverageMeter from '$lib/components/panel/coverage-meter.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import SingleSelect from '$lib/components/single-select.svelte';
  import Play from '@lucide/svelte/icons/play';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Zap from '@lucide/svelte/icons/zap';

  import KpiTile from './_components/kpi-tile.svelte';
  import LiveElapsed from './_components/live-elapsed.svelte';
  import RunDetailSheet from './_components/run-detail-sheet.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  // Live snapshot — active runs, per-integration health, queue depth.
  const activity = createQuery(() => ({
    queryKey: ['pipeline.orgActivity'],
    queryFn: () => trpc.pipeline.orgActivity.query(),
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['pipeline.syncableLinks'],
    queryFn: () => trpc.pipeline.syncableLinks.query(),
  }));

  const recentRuns = createQuery(() => ({
    queryKey: ['pipeline.recentRuns.all'],
    queryFn: () => trpc.pipeline.recentRuns.query({ limit: 50 }),
    refetchInterval: 5_000,
  }));

  // Detail sheet — opens when a run row is clicked.
  let selectedRunId = $state<string | null>(null);
  let sheetOpen = $state(false);
  function openRun(id: string) {
    selectedRunId = id;
    sheetOpen = true;
  }

  // Single-link enqueue form.
  let selectedLinkId = $state('');
  let selectedType = $state('');
  let singleMode = $state<'full' | 'incremental'>('full');
  let singleForce = $state(false);

  const linkOptions = $derived.by(() =>
    (linksQuery.data ?? []).map((link) => ({
      label: `${link.integrationName} · ${link.siteName ?? link.name ?? 'unnamed'}`,
      value: link.id,
    }))
  );

  const selectedLink = $derived.by(() => {
    if (!selectedLinkId) return undefined;
    return linksQuery.data?.find((l) => l.id === selectedLinkId);
  });

  $effect(() => {
    if (selectedLink && !(selectedLink.facets as string[]).includes(selectedType)) {
      selectedType = selectedLink.facets[0] ?? '';
    }
  });

  const enqueueSingle = createMutation(() => ({
    mutationFn: () =>
      trpc.pipeline.enqueueSync.mutate({
        linkId: selectedLinkId,
        type: selectedType,
        mode: singleMode,
        force: singleForce,
      }),
    onSuccess: (result) => {
      toast.success(`Queued · ${result.syncRunId.slice(0, 8)}`);
      qc.invalidateQueries({ queryKey: ['pipeline.orgActivity'] });
      qc.invalidateQueries({ queryKey: ['pipeline.recentRuns.all'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to enqueue'),
  }));

  // Integration-wide enqueue — behind a confirmation dialog because a
  // full-mode run against all sites is a heavy hammer.
  let confirmIntegrationId = $state<string | null>(null);
  let confirmMode = $state<'full' | 'incremental'>('full');
  let confirmForce = $state(false);
  const confirmName = $derived(
    activity.data?.integrationStats.find((s) => s.integrationId === confirmIntegrationId)
      ?.integrationName ?? confirmIntegrationId ?? ''
  );

  const enqueueIntegration = createMutation(() => ({
    mutationFn: (input: { integrationId: string; mode: 'full' | 'incremental'; force: boolean }) =>
      trpc.pipeline.enqueueIntegrationSync.mutate(input),
    onSuccess: (result) => {
      const parts = [
        `${result.queued.length} queued across ${result.linkCount} link${result.linkCount === 1 ? '' : 's'}`,
      ];
      if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);
      toast.success(parts.join(' · '));
      qc.invalidateQueries({ queryKey: ['pipeline.orgActivity'] });
      qc.invalidateQueries({ queryKey: ['pipeline.recentRuns.all'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to enqueue'),
  }));

  function askIntegration(integrationId: string, mode: 'full' | 'incremental') {
    confirmIntegrationId = integrationId;
    confirmMode = mode;
    confirmForce = false;
  }

  function runIntegration() {
    if (!confirmIntegrationId) return;
    enqueueIntegration.mutate({
      integrationId: confirmIntegrationId,
      mode: confirmMode,
      force: confirmForce,
    });
    confirmIntegrationId = null;
  }

  function statusTone(status: string) {
    if (status === 'succeeded' || status === 'completed') return 'text-success';
    if (status === 'failed' || status === 'enqueue_failed') return 'text-destructive';
    if (status === 'running' || status === 'queued' || status === 'pending') return 'text-warning';
    return 'text-muted-foreground';
  }

  function fmtTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString();
  }

  function fmtDuration(ms: number | null | undefined): string {
    if (ms == null || ms < 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${(s % 60).toString().padStart(2, '0')}`;
    return `${Math.floor(m / 60)}h${(m % 60).toString().padStart(2, '0')}m`;
  }

  function runDuration(started: string | null, finished: string | null): string {
    if (!started || !finished) return '—';
    return fmtDuration(new Date(finished).getTime() - new Date(started).getTime());
  }
</script>

<div class="size-full overflow-auto">
<div class="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        PIPELINE / DIAGNOSTIC CONSOLE
      </span>
      <span class="text-foreground/40">·</span>
      <span class="text-sm text-muted-foreground">
        watch, run, and diagnose ingestion for the active org
      </span>
    </div>
    <div class="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      <span class="inline-flex items-center gap-1.5">
        <span class="size-1.5 rounded-full bg-success animate-pulse"></span>
        auto-refresh 3s
      </span>
      <button
        type="button"
        class="inline-flex items-center gap-1 hover:text-foreground"
        onclick={() => {
          activity.refetch();
          recentRuns.refetch();
        }}
      >
        <RefreshCw class="size-3" /> refresh now
      </button>
    </div>
  </div>

  <!-- KPI STRIP -->
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <KpiTile
      label="ACTIVE RUNS"
      value={activity.data?.kpis.activeRuns ?? '—'}
      detail={activity.data
        ? `${activity.data.kpis.runningRuns} running · ${activity.data.kpis.queuedRuns} queued`
        : undefined}
      tone={activity.data && activity.data.kpis.activeRuns > 0 ? 'warning' : 'neutral'}
    />
    <KpiTile
      label="QUEUE DEPTH"
      value={activity.data?.queueDepth
        ? activity.data.queueDepth.waiting + activity.data.queueDepth.active
        : '—'}
      detail={activity.data?.queueDepth
        ? `${activity.data.queueDepth.waiting} wait · ${activity.data.queueDepth.active} act · ${activity.data.queueDepth.delayed} delay`
        : 'redis not connected'}
    />
    <KpiTile
      label="COMPLETED / 1H"
      value={activity.data?.kpis.succeededLastHour ?? '—'}
      detail="successful runs, last hour"
      tone="success"
    />
    <KpiTile
      label="FAILED / 1H"
      value={activity.data?.kpis.failedLastHour ?? '—'}
      detail="failed runs, last hour"
      tone={activity.data && activity.data.kpis.failedLastHour > 0 ? 'danger' : 'neutral'}
    />
  </div>

  <!-- IN FLIGHT -->
  <SectionPanel code="A" title="IN FLIGHT">
    {#snippet aside()}
      {#if activity.data}
        <span>{activity.data.activeRuns.length} run{activity.data.activeRuns.length === 1 ? '' : 's'}</span>
      {/if}
    {/snippet}

    {#if activity.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !activity.data || activity.data.activeRuns.length === 0}
      <div class="py-6 text-center text-sm text-muted-foreground">
        Queue is quiet — nothing in flight right now.
      </div>
    {:else}
      <div
        class="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,0.7fr)] items-center gap-3 border-b border-border/40 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 md:grid"
      >
        <div>Integration</div>
        <div>Site · facet</div>
        <div>Stage</div>
        <div>Mode</div>
        <div>Status</div>
        <div>Records (in / out)</div>
        <div class="text-right">Elapsed</div>
      </div>
      {#each activity.data.activeRuns as run (run.id)}
        <button
          type="button"
          onclick={() => openRun(run.id)}
          class="grid w-full grid-cols-1 gap-1 border-b border-border/40 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/30 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,0.7fr)] md:items-center md:gap-3"
        >
          <div class="min-w-0 truncate text-xs">{run.integrationName}</div>
          <div class="min-w-0 truncate font-mono text-xs">
            <span class="text-foreground/90">{run.siteName}</span>
            <span class="text-muted-foreground/70"> · {run.type}</span>
          </div>
          <div class="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {run.stage ? `${run.stage.name} · ${run.stage.status}` : '—'}
          </div>
          <div class="font-mono text-[11px] uppercase text-muted-foreground">{run.mode}</div>
          <div class={`font-mono text-[11px] uppercase ${statusTone(run.status)}`}>{run.status}</div>
          <div class="font-mono text-[11px] tabular-nums text-muted-foreground">
            {#if run.stage}
              {run.stage.recordsIn} / {run.stage.recordsOut}
              {#if run.stage.failedCt > 0}
                <span class="text-destructive"> · ✕{run.stage.failedCt}</span>
              {/if}
            {:else}
              —
            {/if}
          </div>
          <div class="text-right">
            <LiveElapsed
              startedAt={run.startedAt}
              baseElapsedMs={run.elapsedMs}
              class="font-mono text-xs"
            />
          </div>
        </button>
      {/each}
    {/if}
  </SectionPanel>

  <!-- INTEGRATION HEALTH -->
  <SectionPanel code="H" title="INTEGRATION HEALTH">
    {#if activity.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !activity.data || activity.data.integrationStats.length === 0}
      <div class="py-6 text-center text-sm text-muted-foreground">
        No integrations with syncable links.
      </div>
    {:else}
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {#each activity.data.integrationStats as stat (stat.integrationId)}
          {@const total = stat.succeededLastHour + stat.failedLastHour}
          {@const successRatio = total > 0 ? stat.succeededLastHour / total : 1}
          <div class="border border-border/70 bg-card p-3 space-y-2.5">
            <div class="flex items-baseline justify-between gap-2">
              <div class="font-mono text-xs uppercase tracking-wider">{stat.integrationName}</div>
              <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {stat.linkCount} link{stat.linkCount === 1 ? '' : 's'}
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2 font-mono text-[11px]">
              <div>
                <div class="text-muted-foreground/70 text-[10px] uppercase tracking-wider">active</div>
                <div class={`tabular-nums ${stat.activeCount > 0 ? 'text-warning' : ''}`}>{stat.activeCount}</div>
              </div>
              <div>
                <div class="text-muted-foreground/70 text-[10px] uppercase tracking-wider">ok / 1h</div>
                <div class="tabular-nums text-success">{stat.succeededLastHour}</div>
              </div>
              <div>
                <div class="text-muted-foreground/70 text-[10px] uppercase tracking-wider">fail / 1h</div>
                <div class={`tabular-nums ${stat.failedLastHour > 0 ? 'text-destructive' : ''}`}>{stat.failedLastHour}</div>
              </div>
            </div>

            {#if total > 0}
              <CoverageMeter value={Math.round(successRatio * 100)} />
            {:else}
              <div class="h-1.5 bg-foreground/5"></div>
            {/if}

            <div class="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                class="flex-1 gap-1.5 font-mono text-[11px] uppercase tracking-wider"
                onclick={() => askIntegration(stat.integrationId, 'full')}
              >
                <Zap class="size-3" /> full
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="flex-1 gap-1.5 font-mono text-[11px] uppercase tracking-wider"
                onclick={() => askIntegration(stat.integrationId, 'incremental')}
              >
                <Play class="size-3" /> incr
              </Button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </SectionPanel>

  <!-- FACET LATENCY -->
  <SectionPanel code="L" title="FACET LATENCY">
    {#snippet aside()}
      <span>slowest p95 first · last hour</span>
    {/snippet}

    {#if activity.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !activity.data || activity.data.facetStats.length === 0}
      <div class="py-6 text-center text-sm text-muted-foreground">
        No facet activity in the last hour.
      </div>
    {:else}
      <div
        class="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] items-center gap-3 border-b border-border/40 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 md:grid"
      >
        <div>Integration</div>
        <div>Facet</div>
        <div class="text-right">Active</div>
        <div class="text-right">OK</div>
        <div class="text-right">Fail</div>
        <div class="text-right">p50</div>
        <div class="text-right">p95</div>
        <div class="text-right">Max</div>
      </div>
      {#each activity.data.facetStats as row (row.integrationId + row.facet)}
        {@const slowP95 =
          row.p95DurationMs != null && row.p95DurationMs > 60_000}
        <div
          class="grid grid-cols-1 gap-1 border-b border-border/40 py-1.5 text-sm last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] md:items-center md:gap-3"
        >
          <div class="min-w-0 truncate text-xs">{row.integrationName}</div>
          <div class="min-w-0 truncate font-mono text-xs">{row.facet}</div>
          <div class={`text-right font-mono text-[11px] tabular-nums ${row.activeCount > 0 ? 'text-warning' : 'text-muted-foreground/70'}`}>
            {row.activeCount || '·'}
          </div>
          <div class={`text-right font-mono text-[11px] tabular-nums ${row.succeededLastHour > 0 ? 'text-success' : 'text-muted-foreground/70'}`}>
            {row.succeededLastHour || '·'}
          </div>
          <div class={`text-right font-mono text-[11px] tabular-nums ${row.failedLastHour > 0 ? 'text-destructive' : 'text-muted-foreground/70'}`}>
            {row.failedLastHour || '·'}
          </div>
          <div class="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {fmtDuration(row.p50DurationMs)}
          </div>
          <div class={`text-right font-mono text-[11px] tabular-nums ${slowP95 ? 'text-warning' : 'text-muted-foreground'}`}>
            {fmtDuration(row.p95DurationMs)}
          </div>
          <div class="text-right font-mono text-[11px] tabular-nums text-muted-foreground/80">
            {fmtDuration(row.maxDurationMs)}
          </div>
        </div>
      {/each}
    {/if}
  </SectionPanel>

  <!-- ENQUEUE SINGLE -->
  <SectionPanel code="Q" title="ENQUEUE ONE LINK">
    {#if linksQuery.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !linksQuery.data?.length}
      <div class="py-6 text-center text-sm text-muted-foreground">
        No syncable links. Configure one under Setup / Integrations first.
      </div>
    {:else}
      <div class="grid gap-4 md:grid-cols-4">
        <div class="space-y-2 md:col-span-2">
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
            bind:value={singleMode}
          >
            <option value="full">Full</option>
            <option value="incremental">Incremental</option>
          </select>
        </div>
      </div>

      <div class="mt-3 flex items-center justify-between">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={singleForce} />
          Force (skip active-run check)
        </label>
        <Button
          class="gap-2"
          disabled={!selectedLinkId || !selectedType || enqueueSingle.isPending}
          onclick={() => enqueueSingle.mutate()}
        >
          <Play class="size-4" />
          {enqueueSingle.isPending ? 'Queueing…' : 'Enqueue sync'}
        </Button>
      </div>
    {/if}
  </SectionPanel>

  <!-- RECENT RUNS -->
  <SectionPanel code="R" title="RECENT RUNS">
    {#snippet aside()}
      <span>last {recentRuns.data?.length ?? 0}</span>
    {/snippet}

    {#if recentRuns.isLoading}
      <div class="py-6"><Loader /></div>
    {:else if !recentRuns.data?.length}
      <div class="py-6 text-center text-sm text-muted-foreground">No runs recorded.</div>
    {:else}
      <div
        class="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] items-center gap-3 border-b border-border/40 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 md:grid"
      >
        <div>Integration</div>
        <div>Facet</div>
        <div>Mode</div>
        <div>Status</div>
        <div>Started</div>
        <div>Duration</div>
        <div>Run</div>
      </div>
      {#each recentRuns.data as run (run.id)}
        <button
          type="button"
          onclick={() => openRun(run.id)}
          class="grid w-full grid-cols-1 gap-1 border-b border-border/40 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/30 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] md:items-center md:gap-3"
        >
          <div class="min-w-0 truncate font-mono text-xs">{run.integrationId}</div>
          <div class="min-w-0 truncate font-mono text-xs">{run.type}</div>
          <div class="font-mono text-[11px] uppercase text-muted-foreground">{run.mode}</div>
          <div class={`font-mono text-[11px] uppercase ${statusTone(run.status)}`}>{run.status}</div>
          <div class="font-mono text-[11px] text-muted-foreground">{fmtTime(run.startedAt)}</div>
          <div class="font-mono text-[11px] tabular-nums text-muted-foreground">
            {runDuration(run.startedAt, run.finishedAt)}
          </div>
          <div class="font-mono text-[11px] text-muted-foreground">{run.id.slice(0, 8)}</div>
        </button>
      {/each}
    {/if}
  </SectionPanel>
</div>
</div>

<RunDetailSheet runId={selectedRunId} bind:open={sheetOpen} />

<AlertDialog.Root
  open={confirmIntegrationId !== null}
  onOpenChange={(open) => {
    if (!open) confirmIntegrationId = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>
        Run {confirmMode} sync — {confirmName}
      </AlertDialog.Title>
      <AlertDialog.Description>
        This queues an ingestion job for every active link and supported facet on
        <span class="font-mono">{confirmName}</span>.
        {#if confirmMode === 'full'}
          Full mode re-fetches everything and can be heavy.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={confirmForce} />
      Force — skip active-run check
    </label>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={runIntegration}>
        Queue {confirmMode}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
