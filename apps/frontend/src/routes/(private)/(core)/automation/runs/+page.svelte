<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { formatRelativeDate } from '$lib/utils/format';
  import * as Card from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { Play } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const runs = createQuery(() => ({
    queryKey: ['packageRuns.list'],
    queryFn: () => trpc.packageRuns.list.query({ limit: 100 }),
    refetchInterval: 5_000,
  }));

  let runDialogOpen = $state(false);

  function statusClass(status: string): string {
    switch (status) {
      case 'completed':
        return 'text-emerald-500';
      case 'running':
      case 'queued':
      case 'pending':
        return 'text-sky-500';
      case 'halted':
      case 'failed':
      case 'partial':
        return 'text-rose-500';
      default:
        return 'text-muted-foreground';
    }
  }
</script>

<div class="flex size-full flex-col gap-4 overflow-auto p-6">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Automation runs</h1>
      <p class="text-sm text-muted-foreground">
        History of package executions — click a row to see per-step outcomes and outputs.
      </p>
    </div>
    <Button class="gap-2" onclick={() => (runDialogOpen = true)}>
      <Play class="size-4" />
      Run a package
    </Button>
  </div>

  <RunPackageDialog bind:open={runDialogOpen} onOpenChange={(o) => (runDialogOpen = o)} />

  {#if runs.isLoading}
    <Loader />
  {:else if runs.error}
    <Card.Root>
      <Card.Content>
        <p class="text-sm text-rose-500">Failed to load runs.</p>
      </Card.Content>
    </Card.Root>
  {:else if (runs.data ?? []).length === 0}
    <Card.Root>
      <Card.Content>
        <p class="text-sm text-muted-foreground">
          No package runs yet. Trigger one from a vendor row action.
        </p>
      </Card.Content>
    </Card.Root>
  {:else}
    <div class="rounded-md border">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th class="p-3 text-left">Package</th>
            <th class="p-3 text-left">Status</th>
            <th class="p-3 text-left">Trigger</th>
            <th class="p-3 text-left">Started</th>
            <th class="p-3 text-right">Billing</th>
          </tr>
        </thead>
        <tbody>
          {#each runs.data ?? [] as run (run.id)}
            <tr
              class="cursor-pointer border-b transition-colors hover:bg-muted/40"
              onclick={() => goto(`/automation/runs/${run.id}`)}
            >
              <td class="p-3">
                <div class="font-medium">{run.packageName ?? 'Unknown package'}</div>
                <div class="text-xs text-muted-foreground">v{run.packageVersion}</div>
              </td>
              <td class="p-3">
                <span class={statusClass(run.status)}>{run.status}</span>
              </td>
              <td class="p-3 capitalize">{run.triggerType}</td>
              <td class="p-3 text-muted-foreground">
                {run.startedAt ? formatRelativeDate(run.startedAt) : '—'}
              </td>
              <td class="p-3 text-right tabular-nums">
                ${Number(run.billingTotal ?? 0).toFixed(4)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
