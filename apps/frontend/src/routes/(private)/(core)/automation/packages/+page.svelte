<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import Loader from '$lib/components/transition/loader.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { Play, Pencil, Archive, Plus, Boxes } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const list = createQuery(() => ({
    queryKey: ['packages.list'],
    queryFn: () => trpc.packages.list.query(),
  }));

  const capabilities = createQuery(() => ({
    queryKey: ['packages.metadata.capabilities'],
    queryFn: () => trpc.packages.capabilities.query(),
    staleTime: 5 * 60_000,
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

  function statusBadgeClass(status: string): string {
    if (status === 'active') return 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400';
    if (status === 'archived') return 'border-muted-foreground/30 text-muted-foreground';
    return 'border-amber-500/40 text-amber-600 dark:text-amber-400';
  }

  function stepLabels(pkg: NonNullable<typeof list.data>[number]): string[] {
    const steps = pkg.steps as Array<{ capabilityId: string; label?: string }> | undefined;
    if (!Array.isArray(steps)) return [];
    const capMap = new Map((capabilities.data ?? []).map((c) => [c.id, c]));
    return steps.map((s) => s.label ?? capMap.get(s.capabilityId)?.name ?? s.capabilityId);
  }
</script>

<div class="flex size-full flex-col gap-6 overflow-hidden p-6">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">Packages</h1>
      <p class="text-sm text-muted-foreground">
        Author linear compositions of managed capabilities. Draft, activate, run.
      </p>
    </div>
    <Button class="gap-2" onclick={() => goto('/automation/packages/new')}>
      <Plus class="size-4" />
      New package
    </Button>
  </header>

  <RunPackageDialog
    bind:open={runDialogOpen}
    onOpenChange={(o) => (runDialogOpen = o)}
    packageId={runDialogPackageId}
  />

  <div class="flex-1 overflow-auto">
    {#if list.isLoading}
      <Loader />
    {:else if list.error}
      <div
        class="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
      >
        Failed to load packages.
      </div>
    {:else if (list.data ?? []).length === 0}
      <div class="rounded-lg border border-dashed p-16 text-center">
        <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <Boxes class="size-5 text-muted-foreground" />
        </div>
        <h2 class="mt-4 text-base font-medium">Build your first package</h2>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          A package is a linear sequence of managed capabilities — create user,
          assign license, store creds — that you can run against any tenant.
        </p>
        <Button class="mt-6 gap-2" onclick={() => goto('/automation/packages/new')}>
          <Plus class="size-4" />
          New package
        </Button>
      </div>
    {:else}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each list.data ?? [] as pkg (pkg.id)}
          {@const labels = stepLabels(pkg)}
          <article
            class="group flex flex-col rounded-lg border bg-card p-5 transition-shadow hover:shadow-sm"
          >
            <header class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1 space-y-1">
                <h2 class="truncate text-base font-medium">{pkg.name}</h2>
                {#if pkg.description}
                  <p class="line-clamp-2 text-sm text-muted-foreground">{pkg.description}</p>
                {/if}
              </div>
              <Badge variant="outline" class={statusBadgeClass(pkg.status) + ' capitalize'}>
                {pkg.status}
              </Badge>
            </header>

            <div class="mt-5 flex-1">
              <div class="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
                {labels.length} step{labels.length === 1 ? '' : 's'}
              </div>
              <ol class="space-y-2">
                {#each labels.slice(0, 4) as label, i}
                  <li class="flex items-center gap-2.5 text-sm">
                    <span
                      class="flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] tabular-nums text-muted-foreground"
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span class="truncate">{label}</span>
                  </li>
                {/each}
                {#if labels.length > 4}
                  <li class="pl-[30px] text-xs text-muted-foreground">
                    +{labels.length - 4} more
                  </li>
                {/if}
              </ol>
            </div>

            <footer
              class="mt-5 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"
            >
              <span class="tabular-nums">v{pkg.version}</span>
              <div class="flex items-center gap-1">
                {#if pkg.status === 'active'}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-8 gap-1.5"
                    onclick={() => {
                      runDialogPackageId = pkg.id;
                      runDialogOpen = true;
                    }}
                  >
                    <Play class="size-3.5" />
                    Run
                  </Button>
                {/if}
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-8 gap-1.5"
                  onclick={() => goto(`/automation/packages/${pkg.id}`)}
                >
                  <Pencil class="size-3.5" />
                  Edit
                </Button>
                {#if pkg.status !== 'archived'}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-8 text-muted-foreground hover:text-rose-500"
                    onclick={() => archive.mutate(pkg.id)}
                    disabled={archive.isPending}
                    aria-label="Archive package"
                  >
                    <Archive class="size-3.5" />
                  </Button>
                {/if}
              </div>
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>
