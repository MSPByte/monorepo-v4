<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { formatRelativeDate } from '$lib/utils/format';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import Loader from '$lib/components/transition/loader.svelte';
  import StepNode, { type StepStatus } from '$lib/components/domain/step-node.svelte';
  import { toast } from 'svelte-sonner';
  import { ArrowLeft, Clock, DollarSign, RotateCcw, ShieldAlert, Eye } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canRun = $derived(authStore.isAllowed('Packages.Run'));

  const runId = $derived(page.params.id!);

  const detail = createQuery(() => ({
    queryKey: ['packageRuns.get', runId],
    queryFn: () => trpc.packageRuns.get.query({ id: runId }),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'queued' || status === 'running' || status === 'pending' ? 2_000 : false;
    },
  }));

  const revealed = $state<Record<string, unknown>>({});

  const reveal = createMutation(() => ({
    mutationFn: (args: { runStepId: string; outputPath: string }) =>
      trpc.packageRuns.revealOutput.mutate(args),
    onSuccess: (result, args) => {
      revealed[`${args.runStepId}:${args.outputPath}`] = result.value;
    },
    onError: (err) => toast.error(err.message ?? 'Failed to reveal output'),
  }));

  const retry = createMutation(() => ({
    mutationFn: (args: { runId: string; stepPosition: number }) =>
      trpc.packageRuns.retryFromStep.mutate({ ...args, overrideRuntimeInputs: {} }),
    onSuccess: (result) => {
      toast.success('Retry started', {
        action: {
          label: 'View',
          onClick: () => goto(`/automation/runs/${result.packageRunId}`),
        },
      });
      void queryClient.invalidateQueries({ queryKey: ['packageRuns.list'] });
    },
    onError: (err) => toast.error(err.message ?? 'Failed to retry'),
  }));

  function runStatusBadge(status: string): {
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    label: string;
    class: string;
  } {
    if (status === 'completed')
      return {
        variant: 'outline',
        label: 'Completed',
        class: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
      };
    if (status === 'running' || status === 'queued' || status === 'pending')
      return {
        variant: 'outline',
        label: status,
        class: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
      };
    if (status === 'halted' || status === 'partial')
      return {
        variant: 'outline',
        label: status,
        class: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
      };
    return {
      variant: 'outline',
      label: status,
      class: 'border-rose-500/40 text-rose-600 dark:text-rose-400',
    };
  }

  function canRetry(runStatus: string, purged: boolean, stepPosition: number): boolean {
    if (!['halted', 'failed', 'partial'].includes(runStatus)) return false;
    if (stepPosition > 0 && purged) return false;
    return true;
  }

  function stepStatus(status: string): StepStatus {
    if (
      status === 'success' ||
      status === 'fail' ||
      status === 'skip' ||
      status === 'running' ||
      status === 'pending'
    ) {
      return status as StepStatus;
    }
    return 'pending';
  }

  function isSensitiveShape(value: unknown): value is string {
    return typeof value === 'string' && value.split(':').length === 3;
  }

  function formatDuration(startedAt?: string | null, finishedAt?: string | null): string | null {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }
</script>

<div class="flex size-full flex-col overflow-hidden">
  <div class="border-b px-6 py-4">
    <button
      type="button"
      class="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      onclick={() => goto('/automation/runs')}
    >
      <ArrowLeft class="size-3.5" />
      All runs
    </button>
  </div>

  <div class="flex-1 overflow-auto">
    <div class="flex flex-col gap-8 p-6">
      {#if detail.isLoading}
        <Loader />
      {:else if detail.error || !detail.data}
        <p class="text-sm text-rose-500">Failed to load run.</p>
      {:else}
        {@const run = detail.data.run}
        {@const steps = detail.data.steps}
        {@const purged = !!run.sensitiveOutputsPurgedAt}
        {@const snapshot = run.packageSnapshot as {
          name?: string;
          steps?: Array<{ label?: string; capabilityId: string }>;
        }}
        {@const badge = runStatusBadge(run.status)}
        {@const totalDuration = formatDuration(run.startedAt, run.finishedAt)}

        <header class="space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="space-y-1">
              <div
                class="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"
              >
                <span>Package run</span>
                <span>·</span>
                <span class="capitalize">{run.triggerType}</span>
              </div>
              <h1 class="text-2xl font-semibold tracking-tight">
                {snapshot?.name ?? 'Untitled package'}
              </h1>
              <p class="text-sm text-muted-foreground">
                Version {run.packageVersion}
                {#if run.startedAt}· started {formatRelativeDate(run.startedAt)}{/if}
              </p>
            </div>
            <Badge variant="outline" class={badge.class + ' capitalize'}>{badge.label}</Badge>
          </div>

          <div class="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
            {#if totalDuration}
              <div class="flex items-center gap-1.5">
                <Clock class="size-3.5" />
                <span>{totalDuration}</span>
              </div>
            {/if}
            <div class="flex items-center gap-1.5">
              <DollarSign class="size-3.5" />
              <span class="tabular-nums">${Number(run.billingTotal ?? 0).toFixed(4)}</span>
            </div>
            <div class="flex items-center gap-1.5">
              {#if purged}
                <ShieldAlert class="size-3.5" />
                <span>Sensitive outputs purged</span>
              {:else}
                <Eye class="size-3.5" />
                <span>
                  Sensitive outputs available until {formatRelativeDate(run.outputsExpiresAt)}
                </span>
              {/if}
            </div>
          </div>
        </header>

        <Separator />

        <div>
          <div class="mb-4 flex items-baseline justify-between">
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">Steps</h2>
            <span class="text-xs tabular-nums text-muted-foreground">
              {steps.filter((s) => s.status === 'success').length} of {steps.length} succeeded
            </span>
          </div>

          <div class="space-y-0">
            {#each steps as step, index (step.id)}
              {@const stepDuration = formatDuration(step.startedAt, step.finishedAt)}
              {@const snapshotStep = snapshot?.steps?.[step.position]}
              {@const outputs = (step.outputs ?? {}) as Record<string, unknown>}
              {@const inputs = (step.resolvedInputs ?? {}) as Record<string, unknown>}
              {@const isLast = index === steps.length - 1}
              <div class="grid grid-cols-[36px_1fr] gap-4">
                <div class="flex flex-col items-center">
                  <StepNode status={stepStatus(step.status)} number={step.position + 1} />
                  {#if !isLast}
                    <div class="w-px flex-1 bg-border"></div>
                  {/if}
                </div>
                <div class={isLast ? 'pb-2' : 'pb-6'}>
                  <div class="rounded-lg border bg-card p-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="space-y-0.5">
                        <div class="font-medium">
                          {snapshotStep?.label ?? step.capabilityId}
                        </div>
                        <div class="font-mono text-xs text-muted-foreground">
                          {step.capabilityId}
                        </div>
                      </div>
                      <div class="flex items-center gap-3 text-xs text-muted-foreground">
                        {#if stepDuration}<span>{stepDuration}</span>{/if}
                        {#if canRun && canRetry(run.status, purged, step.position)}
                          <Button
                            variant="outline"
                            size="sm"
                            class="gap-1.5"
                            onclick={() =>
                              retry.mutate({ runId: run.id, stepPosition: step.position })}
                          >
                            <RotateCcw class="size-3" />
                            Retry from here
                          </Button>
                        {/if}
                      </div>
                    </div>

                    {#if step.errorMessage}
                      <div
                        class="mt-3 rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-sm"
                      >
                        <div class="font-medium text-rose-600 dark:text-rose-400">
                          {step.errorClass}
                        </div>
                        <div class="mt-1 font-mono text-xs text-rose-500/80">
                          {step.errorMessage}
                        </div>
                      </div>
                    {/if}
                    {#if step.skipReason}
                      <div class="mt-3 text-sm text-muted-foreground">
                        Skipped — {step.skipReason}
                      </div>
                    {/if}

                    {#if Object.keys(inputs).length > 0 || Object.keys(outputs).length > 0}
                      <div class="mt-4 grid gap-4 sm:grid-cols-2">
                        {#if Object.keys(inputs).length > 0}
                          <div>
                            <div
                              class="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground"
                            >
                              Inputs
                            </div>
                            <dl class="space-y-1 text-sm">
                              {#each Object.entries(inputs) as [name, value]}
                                <div class="flex items-baseline justify-between gap-3">
                                  <dt class="font-mono text-xs text-muted-foreground">{name}</dt>
                                  <dd class="truncate font-mono text-xs">
                                    {isSensitiveShape(value) ? '•••••' : String(value ?? '')}
                                  </dd>
                                </div>
                              {/each}
                            </dl>
                          </div>
                        {/if}
                        {#if Object.keys(outputs).length > 0}
                          <div>
                            <div
                              class="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground"
                            >
                              Outputs
                            </div>
                            <dl class="space-y-1 text-sm">
                              {#each Object.entries(outputs) as [name, value]}
                                {@const key = `${step.id}:${name}`}
                                <div class="flex items-baseline justify-between gap-3">
                                  <dt class="font-mono text-xs text-muted-foreground">{name}</dt>
                                  <dd class="truncate text-right font-mono text-xs">
                                    {#if isSensitiveShape(value)}
                                      {#if revealed[key] !== undefined}
                                        {String(revealed[key])}
                                      {:else if purged}
                                        <span class="text-muted-foreground">purged</span>
                                      {:else if canRun}
                                        <button
                                          type="button"
                                          class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted"
                                          onclick={() =>
                                            reveal.mutate({
                                              runStepId: step.id,
                                              outputPath: name,
                                            })}
                                        >
                                          <Eye class="size-3" />
                                          Reveal
                                        </button>
                                      {:else}
                                        <span class="text-muted-foreground">restricted</span>
                                      {/if}
                                    {:else}
                                      {String(value ?? '')}
                                    {/if}
                                  </dd>
                                </div>
                              {/each}
                            </dl>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
