<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { formatRelativeDate } from '$lib/utils/format';
  import * as Card from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { toast } from 'svelte-sonner';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const runId = $derived(page.params.id!);

  const detail = createQuery(() => ({
    queryKey: ['packageRuns.get', runId],
    queryFn: () => trpc.packageRuns.get.query({ id: runId }),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'queued' || status === 'running' || status === 'pending' ? 2_000 : false;
    },
  }));

  // One reveal at a time — the reveal is audited, so we don't want to bulk-fire.
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

  function canRetry(runStatus: string, purged: boolean, stepPosition: number): boolean {
    if (!['halted', 'failed', 'partial'].includes(runStatus)) return false;
    if (stepPosition > 0 && purged) return false;
    return true;
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'success':
        return 'text-emerald-500';
      case 'skip':
        return 'text-muted-foreground';
      case 'fail':
        return 'text-rose-500';
      case 'running':
      case 'pending':
        return 'text-sky-500';
      default:
        return '';
    }
  }
</script>

<div class="flex size-full flex-col gap-6 overflow-auto p-6">
  {#if detail.isLoading}
    <Loader />
  {:else if detail.error || !detail.data}
    <p class="text-sm text-rose-500">Failed to load run.</p>
  {:else}
    {@const run = detail.data.run}
    {@const steps = detail.data.steps}
    {@const purged = !!run.sensitiveOutputsPurgedAt}

    <Card.Root>
      <Card.Header>
        <Card.Title class="text-xl">Package run</Card.Title>
        <Card.Description>
          Trigger: <span class="capitalize">{run.triggerType}</span> · Status: <span
            class={statusColor(run.status)}>{run.status}</span
          >
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="grid gap-4 text-sm sm:grid-cols-2 md:grid-cols-4">
          <div>
            <div class="text-xs uppercase text-muted-foreground">Started</div>
            <div>{run.startedAt ? formatRelativeDate(run.startedAt) : '—'}</div>
          </div>
          <div>
            <div class="text-xs uppercase text-muted-foreground">Finished</div>
            <div>{run.finishedAt ? formatRelativeDate(run.finishedAt) : '—'}</div>
          </div>
          <div>
            <div class="text-xs uppercase text-muted-foreground">Billing total</div>
            <div class="tabular-nums">${Number(run.billingTotal ?? 0).toFixed(4)}</div>
          </div>
          <div>
            <div class="text-xs uppercase text-muted-foreground">Sensitive outputs</div>
            <div class={purged ? 'text-muted-foreground' : ''}>
              {purged
                ? 'Purged'
                : `Available until ${formatRelativeDate(run.outputsExpiresAt)}`}
            </div>
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Steps</h2>
      {#each steps as step (step.id)}
        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center justify-between gap-3 text-base">
              <span>Step {step.position + 1} · {step.capabilityId}</span>
              <div class="flex items-center gap-3">
                <span class={statusColor(step.status)}>{step.status}</span>
                {#if canRetry(run.status, purged, step.position)}
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={() => retry.mutate({ runId: run.id, stepPosition: step.position })}
                  >
                    Retry from here
                  </Button>
                {/if}
              </div>
            </Card.Title>
            {#if step.errorMessage}
              <Card.Description class="text-rose-500">
                {step.errorClass}: {step.errorMessage}
              </Card.Description>
            {/if}
            {#if step.skipReason}
              <Card.Description>Skipped: {step.skipReason}</Card.Description>
            {/if}
          </Card.Header>
          <Card.Content class="space-y-3 text-sm">
            {#if step.outputs && Object.keys(step.outputs as Record<string, unknown>).length}
              <div>
                <div class="mb-2 text-xs uppercase text-muted-foreground">Outputs</div>
                <div class="space-y-1">
                  {#each Object.entries(step.outputs as Record<string, unknown>) as [name, value]}
                    <div class="flex items-center justify-between gap-3 border-b py-1">
                      <span class="font-mono text-xs">{name}</span>
                      {#if typeof value === 'string' && value.includes(':') && value.split(':').length === 3}
                        {@const key = `${step.id}:${name}`}
                        {#if revealed[key] !== undefined}
                          <span class="font-mono text-xs">{String(revealed[key])}</span>
                        {:else if purged}
                          <span class="text-xs text-muted-foreground">Purged</span>
                        {:else}
                          <Button
                            variant="outline"
                            size="sm"
                            onclick={() =>
                              reveal.mutate({ runStepId: step.id, outputPath: name })}
                          >
                            Reveal
                          </Button>
                        {/if}
                      {:else}
                        <span class="font-mono text-xs">{String(value)}</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
