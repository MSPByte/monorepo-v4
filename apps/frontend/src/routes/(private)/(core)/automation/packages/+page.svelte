<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Card from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { Play, Pencil, Archive, Plus } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const list = createQuery(() => ({
    queryKey: ['packages.list'],
    queryFn: () => trpc.packages.list.query(),
  }));

  let runDialogOpen = $state(false);
  let runDialogPackageId = $state<string | undefined>(undefined);

  const archive = createMutation(() => ({
    mutationFn: (id: string) => trpc.packages.archive.mutate({ id }),
    onSuccess: () => {
      toast.success('Package archived');
      void queryClient.invalidateQueries({ queryKey: ['packages.list'] });
    },
    onError: (err) => toast.error(err.message ?? 'Failed to archive'),
  }));

  function stepCount(pkg: NonNullable<typeof list.data>[number]): number {
    const steps = pkg.steps as unknown;
    return Array.isArray(steps) ? steps.length : 0;
  }

  function statusColor(status: string): string {
    if (status === 'active') return 'text-emerald-500';
    if (status === 'archived') return 'text-muted-foreground line-through';
    return 'text-amber-500';
  }
</script>

<div class="flex size-full flex-col gap-4 overflow-auto p-6">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Packages</h1>
      <p class="text-sm text-muted-foreground">
        Author linear compositions of managed capabilities. Draft, activate, run.
      </p>
    </div>
    <Button class="gap-2" onclick={() => goto('/automation/packages/new')}>
      <Plus class="size-4" />
      New package
    </Button>
  </div>

  <RunPackageDialog
    bind:open={runDialogOpen}
    onOpenChange={(o) => (runDialogOpen = o)}
    packageId={runDialogPackageId}
  />

  {#if list.isLoading}
    <Loader />
  {:else if list.error}
    <Card.Root><Card.Content><p class="text-sm text-rose-500">Failed to load.</p></Card.Content></Card.Root>
  {:else if (list.data ?? []).length === 0}
    <Card.Root>
      <Card.Content>
        <p class="text-sm text-muted-foreground">
          No packages yet. Create one to get started.
        </p>
      </Card.Content>
    </Card.Root>
  {:else}
    <div class="rounded-md border">
      <table class="w-full text-sm">
        <thead class="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th class="p-3 text-left">Name</th>
            <th class="p-3 text-left">Status</th>
            <th class="p-3 text-right">Steps</th>
            <th class="p-3 text-left">Version</th>
            <th class="p-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each list.data ?? [] as pkg (pkg.id)}
            <tr class="border-b">
              <td class="p-3">
                <div class="font-medium">{pkg.name}</div>
                {#if pkg.description}
                  <div class="text-xs text-muted-foreground">{pkg.description}</div>
                {/if}
              </td>
              <td class="p-3 capitalize">
                <span class={statusColor(pkg.status)}>{pkg.status}</span>
              </td>
              <td class="p-3 text-right tabular-nums">{stepCount(pkg)}</td>
              <td class="p-3 tabular-nums">v{pkg.version}</td>
              <td class="p-3">
                <div class="flex justify-end gap-2">
                  {#if pkg.status === 'active'}
                    <Button
                      variant="outline"
                      size="sm"
                      class="gap-1"
                      onclick={() => {
                        runDialogPackageId = pkg.id;
                        runDialogOpen = true;
                      }}
                    >
                      <Play class="size-4" />
                      Run
                    </Button>
                  {/if}
                  <Button
                    variant="outline"
                    size="sm"
                    class="gap-1"
                    onclick={() => goto(`/automation/packages/${pkg.id}`)}
                  >
                    <Pencil class="size-4" />
                    Edit
                  </Button>
                  {#if pkg.status !== 'archived'}
                    <Button
                      variant="ghost"
                      size="sm"
                      class="gap-1 text-rose-500"
                      onclick={() => archive.mutate(pkg.id)}
                      disabled={archive.isPending}
                    >
                      <Archive class="size-4" />
                    </Button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
