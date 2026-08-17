<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Sheet from '$lib/components/ui/sheet';
  import Loader from '$lib/components/transition/loader.svelte';
  import LiveElapsed from './live-elapsed.svelte';

  let {
    runId,
    open = $bindable(false),
  }: {
    runId: string | null;
    open: boolean;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const detail = createQuery(() => ({
    queryKey: ['pipeline.runDetail', runId],
    queryFn: () => trpc.pipeline.runDetail.query({ syncRunId: runId! }),
    enabled: Boolean(runId) && open,
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      if (status && (status === 'pending' || status === 'queued' || status === 'running')) {
        return 2_000;
      }
      return false;
    },
  }));

  function statusTone(status: string) {
    if (status === 'succeeded' || status === 'completed') return 'text-success';
    if (status === 'failed' || status === 'enqueue_failed') return 'text-destructive';
    if (status === 'running' || status === 'queued' || status === 'pending') return 'text-warning';
    return 'text-muted-foreground';
  }

  function fmtTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString();
  }

  function fmtDuration(startedAt: string | null, finishedAt: string | null): string {
    if (!startedAt || !finishedAt) return '—';
    const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}.${Math.floor((ms % 1000) / 100)}s`;
    const m = Math.floor(s / 60);
    return `${m}m${(s % 60).toString().padStart(2, '0')}s`;
  }

  const runIsLive = $derived.by(() => {
    const status = detail.data?.run.status;
    return status === 'pending' || status === 'queued' || status === 'running';
  });
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="w-full sm:max-w-xl overflow-y-auto p-0">
    <Sheet.Header class="border-b border-border/70 bg-muted/40 px-5 py-3 space-y-1">
      <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        SYNC RUN
      </div>
      <Sheet.Title class="font-mono text-sm">
        {runId ? runId.slice(0, 8) : '—'}
      </Sheet.Title>
    </Sheet.Header>

    <div class="px-5 py-4 space-y-6">
      {#if !runId}
        <div class="py-10 text-center text-sm text-muted-foreground">No run selected.</div>
      {:else if detail.isLoading}
        <div class="py-10"><Loader /></div>
      {:else if detail.data}
        {@const run = detail.data.run}
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Integration</div>
            <div class="mt-0.5 text-sm">{detail.data.integrationName}</div>
          </div>
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Site</div>
            <div class="mt-0.5 text-sm">{detail.data.link?.siteName ?? '—'}</div>
          </div>
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Facet</div>
            <div class="mt-0.5 font-mono text-xs">{run.type}</div>
          </div>
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mode</div>
            <div class="mt-0.5 font-mono text-xs">{run.mode}</div>
          </div>
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Status</div>
            <div class={`mt-0.5 font-mono text-xs uppercase ${statusTone(run.status)}`}>{run.status}</div>
          </div>
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Elapsed</div>
            <div class="mt-0.5 font-mono text-xs">
              {#if runIsLive}
                <LiveElapsed startedAt={run.startedAt ?? run.createdAt} />
              {:else}
                {fmtDuration(run.startedAt, run.finishedAt)}
              {/if}
            </div>
          </div>
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Started</div>
            <div class="mt-0.5 font-mono text-xs text-muted-foreground">{fmtTime(run.startedAt)}</div>
          </div>
          <div>
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Finished</div>
            <div class="mt-0.5 font-mono text-xs text-muted-foreground">{fmtTime(run.finishedAt)}</div>
          </div>
        </div>

        <div>
          <div class="border-b border-border/40 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Stages · {detail.data.stages.length}
          </div>
          {#if detail.data.stages.length === 0}
            <div class="py-4 text-center text-xs text-muted-foreground">No stages recorded yet.</div>
          {:else}
            <div class="divide-y divide-border/40">
              {#each detail.data.stages as stage (stage.id)}
                <div class="py-2.5 space-y-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <div class="font-mono text-xs">{stage.stage}</div>
                    <div class={`font-mono text-[10px] uppercase tracking-wider ${statusTone(stage.status)}`}>
                      {stage.status} · {fmtDuration(stage.startedAt, stage.finishedAt)}
                    </div>
                  </div>
                  <div class="font-mono text-[11px] text-muted-foreground tabular-nums">
                    in {stage.recordsIn} · out {stage.recordsOut}
                    · +{stage.createdCt} / ~{stage.updatedCt} / ✕{stage.failedCt}
                  </div>
                  {#if stage.error}
                    <div class="mt-1 border-l-2 border-destructive/70 bg-destructive/5 px-2 py-1 font-mono text-[11px] text-destructive break-words">
                      {stage.error}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if detail.data.context}
          {@const c = detail.data.context}
          <div>
            <div class="border-b border-border/40 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Facet context
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 font-mono text-[11px]">
              <div>
                <span class="text-muted-foreground/80">last full </span>
                <span class="tabular-nums">{c.fullSyncAt ? new Date(c.fullSyncAt).toLocaleString() : '—'}</span>
              </div>
              <div>
                <span class="text-muted-foreground/80">last incr </span>
                <span class="tabular-nums">{c.incrementalSyncAt ? new Date(c.incrementalSyncAt).toLocaleString() : '—'}</span>
              </div>
              <div>
                <span class="text-muted-foreground/80">last ok </span>
                <span class="tabular-nums">{c.lastSuccessAt ? new Date(c.lastSuccessAt).toLocaleString() : '—'}</span>
              </div>
              <div>
                <span class="text-muted-foreground/80">last fail </span>
                <span class="tabular-nums">{c.lastFailureAt ? new Date(c.lastFailureAt).toLocaleString() : '—'}</span>
              </div>
              <div>
                <span class="text-muted-foreground/80">consec fails </span>
                <span class="tabular-nums">{c.consecutiveFailures}</span>
              </div>
              <div>
                <span class="text-muted-foreground/80">cursor </span>
                <span class="tabular-nums break-all">{c.cursor ?? '—'}</span>
              </div>
            </div>
            {#if c.lastErrorMessage}
              <div class="mt-2 border-l-2 border-destructive/70 bg-destructive/5 px-2 py-1 font-mono text-[11px] text-destructive break-words">
                {c.lastErrorClass ?? 'error'} · {c.lastErrorMessage}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
