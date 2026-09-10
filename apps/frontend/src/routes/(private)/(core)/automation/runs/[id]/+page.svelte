<script lang="ts">
  import '../../workspace.css';
  import { fieldLabel } from '$lib/utils/label';
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
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import { toUserMessage } from '$lib/utils/errors';
  import {
    CheckCircle2,
    AlertTriangle,
    Activity,
    ArrowLeft,
    Clock,
    DollarSign,
    RotateCcw,
    ShieldAlert,
    Eye,
    UserRound,
    CornerDownRight,
    ArrowUpRight,
    Trash2,
  } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canRun = $derived(authStore.isAllowed('Packages.Run'));
  const canDelete = $derived(authStore.isAllowed('Packages.Delete'));

  // Terminal runs can be permanently removed — useful when a package's
  // capabilities have been renamed and the historical run is unrepresentable
  // in the current schema. In-flight runs must be canceled first.
  const TERMINAL_RUN_STATUSES = new Set([
    'completed',
    'succeeded',
    'failed',
    'halted',
    'partial',
    'canceled',
  ]);

  let deleteDialogOpen = $state(false);
  const deleteRun = createMutation(() => ({
    mutationFn: () => trpc.packageRuns.delete.mutate({ runId }),
    onSuccess: () => {
      toast.success('Run deleted');
      deleteDialogOpen = false;
      void queryClient.invalidateQueries({ queryKey: ['packageRuns.list'] });
      void queryClient.invalidateQueries({ queryKey: ['packages.list'] });
      goto('/automation/runs');
    },
    onError: (err) => toast.error(toUserMessage(err, 'Failed to delete run')),
  }));

  const runId = $derived(page.params.id!);

  const detail = createQuery(() => ({
    queryKey: ['packageRuns.get', runId],
    queryFn: () => trpc.packageRuns.get.query({ id: runId }),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'queued' || status === 'running' || status === 'pending' ? 2_000 : false;
    },
  }));

  // Direct child runs of this run — indexed below by triggerRef.parentPosition
  // so each sub-package step row can link to the child run it spawned. The
  // query refreshes on the same cadence as the parent when it's live.
  const children = createQuery(() => ({
    queryKey: ['packageRuns.listChildren', runId],
    queryFn: () => trpc.packageRuns.listChildren.query({ parentRunId: runId }),
    refetchInterval: (query) => {
      const parentStatus = detail.data?.run.status;
      return parentStatus === 'queued' || parentStatus === 'running' || parentStatus === 'pending'
        ? 2_000
        : false;
    },
  }));
  const fanoutTargets = createQuery(() => ({
    queryKey: ['packageRuns.listFanoutTargets', runId],
    queryFn: () => trpc.packageRuns.listFanoutTargets.query({ fanoutParentId: runId }),
    enabled: (detail.data?.run.triggerRef as { kind?: string } | null)?.kind === 'fanout',
    refetchInterval: () => {
      const status = detail.data?.run.status;
      return ['pending', 'queued', 'running'].includes(status ?? '') ? 2_000 : false;
    },
  }));
  const childrenByPosition = $derived.by(() => {
    const map = new Map<
      number,
      Array<{ id: string; status: string; packageName: string | null }>
    >();
    for (const child of children.data ?? []) {
      const pos = (child.triggerRef as { parentPosition?: number } | null)?.parentPosition;
      if (typeof pos !== 'number') continue;
      const arr = map.get(pos) ?? [];
      arr.push({ id: child.id, status: child.status, packageName: child.packageName });
      map.set(pos, arr);
    }
    return map;
  });

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
    onSuccess: () => {
      toast.success('Retry queued in this run');
      void queryClient.invalidateQueries({ queryKey: ['packageRuns.get', runId] });
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
        class: 'border-[var(--success)] text-[var(--success)]',
      };
    if (status === 'running' || status === 'queued' || status === 'pending')
      return {
        variant: 'outline',
        label: status,
        class: 'border-primary text-primary',
      };
    if (status === 'halted' || status === 'partial')
      return {
        variant: 'outline',
        label: status,
        class: 'border-[var(--warning)] text-[var(--warning)]',
      };
    return {
      variant: 'outline',
      label: status,
      class: 'border-[var(--warning)] text-[var(--warning)]',
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

  function runSource(run: { triggerSourceLabel: string | null; triggerType: string }): string {
    if (run.triggerSourceLabel) return run.triggerSourceLabel;
    if (run.triggerType === 'finding') return 'Finding automation';
    if (run.triggerType === 'scheduled') return 'Scheduled automation';
    if (run.triggerType === 'api') return 'API';
    return 'Manual run';
  }
</script>

<div class="au-detail">
  <div class="au-backbar">
    <button
      type="button"
      class="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      onclick={() => goto('/automation/runs')}
    >
      <ArrowLeft class="size-3.5" />
      All runs
    </button>
    {#if detail.data?.run.parentRunId || detail.data?.run.fanoutParentId}
      <span class="text-muted-foreground/40">·</span>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onclick={() =>
          goto(
            `/automation/runs/${detail.data!.run.parentRunId ?? detail.data!.run.fanoutParentId}`
          )}
      >
        <CornerDownRight class="size-3.5" />
        {detail.data?.run.fanoutParentId ? 'Batch run' : 'Parent run'}
      </button>
    {/if}
  </div>

  <div class="flex-1 overflow-auto">
    <div class="au-detail-body">
      {#if detail.isLoading}
        <Loader />
      {:else if detail.error || !detail.data}
        <div class="au-error" role="alert">
          <h2>We couldn’t load this run</h2>
          <p>Try again, or return to run history to find another run.</p>
          <Button onclick={() => detail.refetch()}>Try again</Button>
        </div>
      {:else}
        {@const run = detail.data.run}
        {@const steps = detail.data.steps}
        {@const purged = !!run.sensitiveOutputsPurgedAt}
        {@const snapshot = run.packageSnapshot as {
          name?: string;
          steps?: Array<{ label?: string; capabilityId: string }>;
          outcomeSteps?: {
            onSuccess?: Array<{ label?: string; capabilityId: string }>;
            onFailure?: Array<{ label?: string; capabilityId: string }>;
          };
        }}
        {@const badge = runStatusBadge(run.status)}
        {@const totalDuration = formatDuration(run.startedAt, run.finishedAt)}
        {@const isFanout = (run.triggerRef as { kind?: string } | null)?.kind === 'fanout'}

        <header class="space-y-5">
          <div class="au-heading">
            <div class="space-y-1">
              <div
                class="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"
              >
                <span>Run report</span>
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
            <div class="au-heading-actions">
              {#if run.packageId}<Button
                  variant="outline"
                  size="sm"
                  href={`/automation/packages/${run.packageId}`}>Open package</Button
                >{/if}
              <Badge variant="outline" class={badge.class + ' capitalize'}>{badge.label}</Badge>
              {#if canDelete && TERMINAL_RUN_STATUSES.has(run.status)}
                <Button
                  variant="outline"
                  size="sm"
                  class="gap-1.5 text-destructive hover:text-destructive"
                  onclick={() => (deleteDialogOpen = true)}
                >
                  <Trash2 class="size-3.5" />
                  Delete run
                </Button>
              {/if}
            </div>
          </div>

          <div class="au-run-facts">
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
              <UserRound class="size-3.5" />
              <span>{runSource(run)}</span>
            </div>
            {#if run.executionAttempt > 0}
              <span class="rounded-full border px-2 py-0.5 text-xs tabular-nums">
                Attempt {run.executionAttempt + 1}
              </span>
            {/if}
            <div class="flex items-center gap-1.5">
              {#if purged}
                <ShieldAlert class="size-3.5" />
                <span>Sensitive results expired</span>
              {:else}
                <Eye class="size-3.5" />
                <span>
                  Sensitive results available until {formatRelativeDate(run.outputsExpiresAt)}
                </span>
              {/if}
            </div>
          </div>
        </header>

        {@const failedStep = steps.find((step) => step.status === 'fail')}
        {@const needsAttention = ['failed', 'halted', 'partial'].includes(run.status)}
        <section
          class="au-notice"
          class:au-attention={needsAttention}
          class:au-success={run.status === 'completed'}
          aria-label="Run outcome"
        >
          {#if needsAttention}<AlertTriangle
              size={23}
            />{:else if run.status === 'completed'}<CheckCircle2 size={23} />{:else}<Activity
              size={23}
              class="au-info"
            />{/if}
          <div>
            <strong
              >{run.status === 'completed'
                ? 'This package finished successfully'
                : needsAttention
                  ? 'This run needs your attention'
                  : run.status === 'canceled'
                    ? 'This run was canceled'
                    : run.status === 'running'
                      ? 'Your automation is running'
                      : 'Waiting to start'}</strong
            >
            <p>
              {needsAttention
                ? 'Review the action results below before deciding whether to retry. A retry can repeat changes made by later actions.'
                : run.status === 'completed'
                  ? 'Review each action’s results below, including any follow-ups.'
                  : run.status === 'canceled'
                    ? 'Review the recorded actions to see what finished before cancellation.'
                    : 'This report updates automatically while the run is active.'}
            </p>
          </div>
          {#if failedStep}<a
              class="inline-flex items-center gap-1 text-xs text-primary"
              href={`#run-step-${failedStep.id}`}>View failed action <ArrowUpRight size={14} /></a
            >{/if}
        </section>
        {#if purged && needsAttention}<p class="text-xs text-muted-foreground">
            Sensitive results have expired. Retrying a later action may be unavailable because it
            needs those results.
          </p>{/if}

        {#if isFanout}
          {@const targets = fanoutTargets.data ?? []}
          {@const completedTargets = targets.filter(
            (target) => target.status === 'completed'
          ).length}
          {@const failedTargets = targets.filter((target) =>
            ['failed', 'halted', 'partial', 'canceled'].includes(target.status)
          ).length}
          <section class="space-y-3">
            <div class="flex items-baseline justify-between gap-3">
              <div>
                <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Target runs
                </h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  {completedTargets} completed{failedTargets
                    ? ` · ${failedTargets} need attention`
                    : ''} · {targets.length} total
                </p>
              </div>
            </div>
            <div class="divide-y rounded-lg border">
              {#each targets as target (target.id)}
                {@const targetInfo = (
                  target.triggerRef as { target?: { label?: string; id?: string } } | null
                )?.target}
                {@const targetBadge = runStatusBadge(target.status)}
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  onclick={() => goto(`/automation/runs/${target.id}`)}
                >
                  <span class="min-w-0 truncate text-sm font-medium"
                    >{targetInfo?.label ?? targetInfo?.id ?? 'Identity'}</span
                  >
                  <Badge variant="outline" class={targetBadge.class + ' shrink-0 capitalize'}
                    >{targetBadge.label}</Badge
                  >
                </button>
              {:else}
                <div class="px-4 py-3 text-sm text-muted-foreground">Preparing target runs…</div>
              {/each}
            </div>
          </section>
          <Separator />
        {/if}

        {#if !isFanout}
          <div>
            <div class="mb-4 flex items-baseline justify-between">
              <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Action results
              </h2>
              <span class="text-xs tabular-nums text-muted-foreground">
                {steps.filter((s) => s.status === 'success').length} of {steps.length} succeeded
              </span>
            </div>

            <div class="space-y-0">
              {#each steps as step, index (step.id)}
                {@const stepDuration = formatDuration(step.startedAt, step.finishedAt)}
                {@const lane = step.lane ?? 'main'}
                {@const snapshotStep =
                  lane === 'on_success'
                    ? snapshot?.outcomeSteps?.onSuccess?.[step.position]
                    : lane === 'on_failure'
                      ? snapshot?.outcomeSteps?.onFailure?.[step.position]
                      : snapshot?.steps?.[step.position]}
                {@const outputs = (step.outputs ?? {}) as Record<string, unknown>}
                {@const inputs = (step.resolvedInputs ?? {}) as Record<string, unknown>}
                {@const isLast = index === steps.length - 1}
                {@const isSubpackageStep = step.capabilityId.startsWith('subpackage:')}
                {@const childRuns =
                  isSubpackageStep && lane === 'main'
                    ? (childrenByPosition.get(step.position) ?? [])
                    : []}
                <div class="grid grid-cols-[36px_1fr] gap-4">
                  <div class="flex flex-col items-center">
                    <StepNode status={stepStatus(step.status)} number={step.position + 1} />
                    {#if !isLast}
                      <div class="w-px flex-1 bg-border"></div>
                    {/if}
                  </div>
                  <div class={isLast ? 'pb-2' : 'pb-6'}>
                    <div class="au-result-card" id={`run-step-${step.id}`}>
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="space-y-0.5">
                          <div class="flex items-center gap-2">
                            <div class="font-medium">
                              {snapshotStep?.label ??
                                fieldLabel(step.capabilityId.split('.').pop() ?? step.capabilityId)}
                            </div>
                            {#if isSubpackageStep}
                              <span
                                class="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary"
                              >
                                Included package
                              </span>
                            {/if}
                            {#if lane !== 'main'}
                              <span
                                class="rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide {lane ===
                                'on_success'
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'}"
                              >
                                {lane === 'on_success' ? 'On success' : 'On failure'}
                              </span>
                            {/if}
                          </div>
                          <span class="au-cell-detail"
                            >{(
                              {
                                success: 'Completed',
                                fail: 'Failed',
                                skip: 'Skipped',
                                running: 'Running',
                                pending: 'Waiting',
                              } as Record<string, string>
                            )[step.status] ?? step.status}</span
                          >
                        </div>
                        <div class="flex items-center gap-3 text-xs text-muted-foreground">
                          {#if stepDuration}<span>{stepDuration}</span>{/if}
                          {#if childRuns.length > 0}
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              onclick={() => goto(`/automation/runs/${childRuns[0]!.id}`)}
                              title={childRuns[0]!.packageName ?? undefined}
                            >
                              View included run
                              <ArrowUpRight class="size-3" />
                            </button>
                          {/if}
                          {#if lane === 'main' && canRun && canRetry(run.status, purged, step.position)}
                            <Button
                              variant="outline"
                              size="sm"
                              class="gap-1.5"
                              disabled={retry.isPending}
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
                        <div class="au-step-error">
                          <strong>{fieldLabel(step.errorClass ?? 'Action failed')}</strong>
                          <p>{step.errorMessage}</p>
                        </div>
                      {/if}
                      {#if step.skipReason}
                        <div class="mt-3 text-sm text-muted-foreground">
                          Skipped — {step.skipReason}
                        </div>
                      {/if}

                      {#if Object.keys(inputs).length > 0 || Object.keys(outputs).length > 0}
                        <details class="au-step-record">
                          <summary
                            >Values used and results <span class="ml-2"
                              >{Object.keys(inputs).length} inputs · {Object.keys(outputs).length} results</span
                            ></summary
                          >
                          <p class="mt-3 text-xs text-muted-foreground">
                            Action identifier: <code>{step.capabilityId}</code>
                          </p>
                          <div class="mt-4 grid gap-4 sm:grid-cols-2">
                            {#if Object.keys(inputs).length > 0}
                              <div>
                                <div
                                  class="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground"
                                >
                                  Values used
                                </div>
                                <dl class="space-y-1 text-sm">
                                  {#each Object.entries(inputs) as [name, value]}
                                    <div class="flex items-baseline justify-between gap-3">
                                      <dt class="text-xs text-muted-foreground">
                                        {fieldLabel(name)}
                                      </dt>
                                      <dd class="text-xs">
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
                                  Results
                                </div>
                                <dl class="space-y-1 text-sm">
                                  {#each Object.entries(outputs) as [name, value]}
                                    {@const key = `${step.id}:${name}`}
                                    <div class="flex items-baseline justify-between gap-3">
                                      <dt class="text-xs text-muted-foreground">
                                        {fieldLabel(name)}
                                      </dt>
                                      <dd class="text-right text-xs">
                                        {#if isSensitiveShape(value)}
                                          {#if revealed[key] !== undefined}
                                            {String(revealed[key])}
                                          {:else if purged}
                                            <span class="text-muted-foreground">purged</span>
                                          {:else if canRun}
                                            <button
                                              type="button"
                                              class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted"
                                              disabled={reveal.isPending}
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
                        </details>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<AlertDialog.Root open={deleteDialogOpen} onOpenChange={(o) => (deleteDialogOpen = o)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this run?</AlertDialog.Title>
      <AlertDialog.Description>
        Removes the run and all of its recorded step outputs. This can't be undone. The parent
        package and other runs are not affected.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleteRun.isPending}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
        disabled={deleteRun.isPending}
        onclick={() => deleteRun.mutate()}
      >
        {deleteRun.isPending ? 'Deleting…' : 'Delete'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
