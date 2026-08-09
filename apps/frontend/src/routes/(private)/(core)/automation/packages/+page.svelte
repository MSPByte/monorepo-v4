<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import Loader from '$lib/components/transition/loader.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { toUserMessage } from '$lib/utils/errors';
  import {
    Play,
    Pencil,
    Archive,
    Plus,
    Boxes,
    Search,
    MoreHorizontal,
    Copy,
    Trash2,
    ArrowUpDown,
  } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  type Status = 'draft' | 'active' | 'archived';
  type Row = {
    id: string;
    name: string;
    description: string | null;
    status: string;
    version: number;
    steps: unknown;
    updatedAt: string | null;
    createdAt: string | null;
  };

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
  let search = $state('');
  let statusFilter = $state<'all' | Status>('all');
  let sortKey = $state<'updated' | 'name' | 'steps'>('updated');
  let deleteTarget = $state<Row | null>(null);
  let deleteConfirmName = $state('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['packages.list'] });

  const archive = createMutation(() => ({
    mutationFn: (id: string) => trpc.packages.archive.mutate({ id }),
    onSuccess: () => {
      toast.success('Package archived');
      void invalidate();
    },
    onError: (err) => toast.error(toUserMessage(err, 'Failed to archive')),
  }));

  const duplicate = createMutation(() => ({
    mutationFn: (id: string) => trpc.packages.duplicate.mutate({ id }),
    onSuccess: () => {
      toast.success('Duplicated');
      void invalidate();
    },
    onError: (err) => toast.error(toUserMessage(err, 'Failed to duplicate')),
  }));

  const remove = createMutation(() => ({
    mutationFn: (id: string) => trpc.packages.delete.mutate({ id }),
    onSuccess: () => {
      toast.success('Package deleted');
      deleteTarget = null;
      deleteConfirmName = '';
      void invalidate();
    },
    onError: (err) => toast.error(toUserMessage(err, 'Failed to delete')),
  }));

  const counts = $derived.by(() => {
    const rows = (list.data ?? []) as Row[];
    return {
      all: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      draft: rows.filter((r) => r.status === 'draft').length,
      archived: rows.filter((r) => r.status === 'archived').length,
    };
  });

  function stepCount(r: Row): number {
    return Array.isArray(r.steps) ? r.steps.length : 0;
  }

  const filtered = $derived.by(() => {
    const rows = ((list.data ?? []) as Row[]).slice();
    const q = search.trim().toLowerCase();
    const scoped = rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      if (r.name.toLowerCase().includes(q)) return true;
      if ((r.description ?? '').toLowerCase().includes(q)) return true;
      return false;
    });
    scoped.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'steps') return stepCount(b) - stepCount(a);
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });
    return scoped;
  });

  const capMap = $derived(new Map((capabilities.data ?? []).map((c) => [c.id, c])));

  function stepPreview(r: Row): string {
    const steps = Array.isArray(r.steps)
      ? (r.steps as Array<{ capabilityId: string; label?: string }>)
      : [];
    const names = steps.map((s) => s.label ?? capMap.get(s.capabilityId)?.name ?? s.capabilityId);
    if (names.length === 0) return '';
    if (names.length <= 3) return names.join(' → ');
    return `${names.slice(0, 3).join(' → ')} +${names.length - 3}`;
  }

  function statusDotClass(status: string): string {
    if (status === 'active') return 'bg-emerald-500';
    if (status === 'archived') return 'bg-muted-foreground/40';
    return 'bg-amber-500';
  }

  function statusLabelClass(status: string): string {
    if (status === 'active') return 'text-emerald-700 dark:text-emerald-400';
    if (status === 'archived') return 'text-muted-foreground';
    return 'text-amber-700 dark:text-amber-500';
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function relTime(iso: string | null): string {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const m = Math.round(diff / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return rtf.format(-m, 'minute');
    const h = Math.round(m / 60);
    if (h < 24) return rtf.format(-h, 'hour');
    const d = Math.round(h / 24);
    if (d < 30) return rtf.format(-d, 'day');
    const mo = Math.round(d / 30);
    if (mo < 12) return rtf.format(-mo, 'month');
    return rtf.format(-Math.round(mo / 12), 'year');
  }

  function toggleSort(key: 'updated' | 'name' | 'steps') {
    sortKey = key;
  }

  const canConfirmDelete = $derived(
    deleteTarget !== null && deleteConfirmName.trim() === deleteTarget.name,
  );
</script>

<div class="flex size-full flex-col gap-5 overflow-hidden p-6">
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">Packages</h1>
      <p class="text-sm text-muted-foreground">
        Compose managed capabilities into runs you can execute against any tenant.
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

  {#if list.data && list.data.length > 0}
    <div class="flex flex-wrap items-center gap-3">
      <div
        role="tablist"
        aria-label="Filter by status"
        class="inline-flex items-center rounded-md border bg-muted/40 p-0.5 text-sm"
      >
        {#each [
          { key: 'all', label: 'All', count: counts.all },
          { key: 'active', label: 'Active', count: counts.active },
          { key: 'draft', label: 'Draft', count: counts.draft },
          { key: 'archived', label: 'Archived', count: counts.archived },
        ] as tab (tab.key)}
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.key}
            onclick={() => (statusFilter = tab.key as typeof statusFilter)}
            class="rounded-[5px] px-3 py-1 font-medium transition-colors {statusFilter === tab.key
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {tab.label}
            <span class="ml-1.5 text-xs tabular-nums opacity-70">{tab.count}</span>
          </button>
        {/each}
      </div>

      <div class="relative min-w-[220px] flex-1 sm:max-w-sm">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input placeholder="Search packages" bind:value={search} class="pl-9" />
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowUpDown class="size-3.5" />
              Sort:
              <span class="text-foreground">
                {sortKey === 'updated'
                  ? 'Recently updated'
                  : sortKey === 'name'
                    ? 'Name'
                    : 'Step count'}
              </span>
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-52">
          <DropdownMenu.Item onclick={() => toggleSort('updated')}>
            Recently updated
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => toggleSort('name')}>Name</DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => toggleSort('steps')}>Step count</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  {/if}

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
          A package is a linear sequence of managed capabilities — create user, assign license,
          store creds — that you can run against any tenant.
        </p>
        <Button class="mt-6 gap-2" onclick={() => goto('/automation/packages/new')}>
          <Plus class="size-4" />
          New package
        </Button>
      </div>
    {:else if filtered.length === 0}
      <div class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No packages match your filters.
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border">
        <table class="w-full text-sm">
          <thead
            class="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"
          >
            <tr>
              <th class="w-[36%] px-4 py-2.5 text-left font-medium">Package</th>
              <th class="px-4 py-2.5 text-left font-medium">Status</th>
              <th class="px-4 py-2.5 text-left font-medium">Steps</th>
              <th class="px-4 py-2.5 text-left font-medium">Version</th>
              <th class="px-4 py-2.5 text-left font-medium">Updated</th>
              <th class="w-16 px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y">
            {#each filtered as pkg (pkg.id)}
              {@const preview = stepPreview(pkg)}
              <tr
                class="group cursor-pointer transition-colors hover:bg-muted/40"
                onclick={() => goto(`/automation/packages/${pkg.id}`)}
              >
                <td class="px-4 py-3">
                  <div class="flex flex-col gap-0.5">
                    <span class="font-medium text-foreground">{pkg.name}</span>
                    {#if pkg.description}
                      <span class="line-clamp-1 text-xs text-muted-foreground">
                        {pkg.description}
                      </span>
                    {/if}
                    {#if preview}
                      <span
                        class="mt-1 line-clamp-1 font-mono text-[11px] text-muted-foreground/80"
                      >
                        {preview}
                      </span>
                    {/if}
                  </div>
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center gap-1.5 text-xs {statusLabelClass(pkg.status)}">
                    <span class="size-1.5 rounded-full {statusDotClass(pkg.status)}"></span>
                    <span class="capitalize">{pkg.status}</span>
                  </span>
                </td>
                <td class="px-4 py-3 tabular-nums text-muted-foreground">
                  {stepCount(pkg)}
                </td>
                <td class="px-4 py-3 tabular-nums text-muted-foreground">
                  v{pkg.version}
                </td>
                <td class="px-4 py-3 text-muted-foreground">
                  {relTime(pkg.updatedAt)}
                </td>
                <td class="px-2 py-2 text-right" onclick={(e) => e.stopPropagation()}>
                  <div class="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            aria-label="More actions"
                            class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <MoreHorizontal class="size-4" />
                          </button>
                        {/snippet}
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="end" class="w-44">
                        <DropdownMenu.Item
                          class="gap-2"
                          onclick={() => goto(`/automation/packages/${pkg.id}`)}
                        >
                          <Pencil class="size-3.5" /> Edit
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          class="gap-2"
                          onclick={() => duplicate.mutate(pkg.id)}
                          disabled={duplicate.isPending}
                        >
                          <Copy class="size-3.5" /> Duplicate
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        {#if pkg.status !== 'archived'}
                          <DropdownMenu.Item
                            class="gap-2"
                            onclick={() => archive.mutate(pkg.id)}
                            disabled={archive.isPending}
                          >
                            <Archive class="size-3.5" /> Archive
                          </DropdownMenu.Item>
                        {/if}
                        <DropdownMenu.Item
                          class="gap-2 text-destructive focus:text-destructive"
                          onclick={() => {
                            deleteTarget = pkg;
                            deleteConfirmName = '';
                          }}
                        >
                          <Trash2 class="size-3.5" /> Delete…
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<AlertDialog.Root
  open={deleteTarget !== null}
  onOpenChange={(o) => {
    if (!o) {
      deleteTarget = null;
      deleteConfirmName = '';
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this package?</AlertDialog.Title>
      <AlertDialog.Description>
        Removes the package permanently. Runs that reference it will block the delete — archive
        the package instead if you need to keep history.
      </AlertDialog.Description>
    </AlertDialog.Header>

    {#if deleteTarget}
      <div class="grid gap-2 py-2">
        <Label for="package-delete-confirm">
          Type <span class="font-mono text-foreground">{deleteTarget.name}</span> to confirm
        </Label>
        <Input
          id="package-delete-confirm"
          bind:value={deleteConfirmName}
          placeholder={deleteTarget.name}
          autocomplete="off"
        />
      </div>
    {/if}

    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={remove.isPending}>Cancel</AlertDialog.Cancel>
      <Button
        variant="destructive"
        disabled={!canConfirmDelete || remove.isPending}
        onclick={() => deleteTarget && remove.mutate(deleteTarget.id)}
      >
        {remove.isPending ? 'Deleting…' : 'Delete package'}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
