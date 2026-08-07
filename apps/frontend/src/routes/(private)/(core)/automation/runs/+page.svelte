<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { formatRelativeDate } from '$lib/utils/format';
  import Button from '$lib/components/ui/button/button.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { Play, Workflow, ChevronRight } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const runs = createQuery(() => ({
    queryKey: ['packageRuns.list'],
    queryFn: () => trpc.packageRuns.list.query({ limit: 100 }),
    refetchInterval: 5_000,
  }));

  let runDialogOpen = $state(false);

  function statusPill(status: string): { dot: string; label: string; text: string } {
    if (status === 'completed')
      return { dot: 'bg-emerald-500', label: 'Completed', text: 'text-emerald-600 dark:text-emerald-400' };
    if (status === 'running')
      return { dot: 'bg-sky-500 animate-pulse', label: 'Running', text: 'text-sky-600 dark:text-sky-400' };
    if (status === 'queued' || status === 'pending')
      return { dot: 'bg-sky-500/50', label: status, text: 'text-sky-600 dark:text-sky-400' };
    if (status === 'halted' || status === 'partial')
      return { dot: 'bg-amber-500', label: status, text: 'text-amber-600 dark:text-amber-400' };
    return { dot: 'bg-rose-500', label: status, text: 'text-rose-600 dark:text-rose-400' };
  }
</script>

<div class="flex size-full flex-col gap-6 overflow-hidden p-6">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">Runs</h1>
      <p class="text-sm text-muted-foreground">
        Every package execution. Click a run to trace what happened at each step.
      </p>
    </div>
    <Button class="gap-2" onclick={() => (runDialogOpen = true)}>
      <Play class="size-4" />
      Run a package
    </Button>
  </header>

  <RunPackageDialog bind:open={runDialogOpen} onOpenChange={(o) => (runDialogOpen = o)} />

  <div class="flex-1 overflow-auto">
    {#if runs.isLoading}
      <Loader />
    {:else if runs.error}
      <div
        class="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
      >
        Failed to load runs.
      </div>
    {:else if (runs.data ?? []).length === 0}
      <div class="rounded-lg border border-dashed p-16 text-center">
        <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <Workflow class="size-5 text-muted-foreground" />
        </div>
        <h2 class="mt-4 text-base font-medium">No runs yet</h2>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Trigger a package to see execution history here. Runs record every step,
          every input, every output — with a 48-hour window for anything sensitive.
        </p>
        <Button class="mt-6 gap-2" onclick={() => (runDialogOpen = true)}>
          <Play class="size-4" />
          Run a package
        </Button>
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border">
        <div class="grid grid-cols-[130px_1fr_auto_auto] gap-4 border-b bg-muted/30 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <div>Status</div>
          <div>Package</div>
          <div class="hidden text-right sm:block">Cost</div>
          <div class="w-4"></div>
        </div>
        <div class="divide-y">
          {#each runs.data ?? [] as run (run.id)}
            {@const pill = statusPill(run.status)}
            <button
              type="button"
              class="group grid w-full grid-cols-[130px_1fr_auto_auto] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/30"
              onclick={() => goto(`/automation/runs/${run.id}`)}
            >
              <div class="flex items-center gap-2">
                <span class={`size-2 rounded-full ${pill.dot}`}></span>
                <span class={`text-xs capitalize ${pill.text}`}>{pill.label}</span>
              </div>
              <div class="min-w-0">
                <div class="truncate font-medium">{run.packageName ?? 'Unknown package'}</div>
                <div class="text-xs text-muted-foreground">
                  v{run.packageVersion} · <span class="capitalize">{run.triggerType}</span>
                  {#if run.startedAt}· {formatRelativeDate(run.startedAt)}{/if}
                </div>
              </div>
              <div class="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                ${Number(run.billingTotal ?? 0).toFixed(4)}
              </div>
              <ChevronRight
                class="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
