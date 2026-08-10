<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { DataTable } from '$lib/components/data-table';
  import type {
    DataTableColumn,
    PaginationInput,
    RowAction,
  } from '$lib/components/data-table/types';
  import {
    numberColumn,
    relativeDateColumn,
    stateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import Button from '$lib/components/ui/button/button.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { toUserMessage } from '$lib/utils/errors';
  import { Play, Pencil, Archive, Plus, Copy, Trash2, MoreHorizontal } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canRun = $derived(authStore.isAllowed('Packages.Run'));
  const canWrite = $derived(authStore.isAllowed('Packages.Write'));
  const canDelete = $derived(authStore.isAllowed('Packages.Delete'));

  type PackageRow = {
    id: string;
    name: string;
    description: string;
    status: 'draft' | 'active' | 'archived';
    stepCount: number;
    version: number;
    updatedAt: string | null;
    stepPreview: string;
    // "Global" for unscoped packages; otherwise a compact summary like
    // "2 sites" or "1 site · 1 group". Filterable + sortable.
    scope: string;
    // Compact string lists derived from the package's steps. Kept as
    // strings so the DataTable text columns handle sort/filter uniformly.
    vendors: string;
    categories: string;
    // Full-text search haystack — includes capability names + descriptions
    // so global search catches "reset password" even when the step's label
    // was renamed to something opaque.
    searchBlob: string;
    [key: string]: unknown;
  };

  let refreshKey = $state(0);
  let runDialogOpen = $state(false);
  let runDialogPackageId = $state<string | undefined>(undefined);
  let deleteTarget = $state<PackageRow | null>(null);

  const invalidate = () => {
    refreshKey++;
    void queryClient.invalidateQueries({ queryKey: ['packages.list'] });
  };

  async function archiveOne(id: string) {
    try {
      await trpc.packages.archive.mutate({ id });
      toast.success('Package archived');
      invalidate();
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to archive'));
    }
  }

  async function duplicateOne(id: string) {
    try {
      await trpc.packages.duplicate.mutate({ id });
      toast.success('Duplicated');
      invalidate();
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to duplicate'));
    }
  }

  async function deleteConfirmed() {
    if (!deleteTarget) return;
    try {
      await trpc.packages.delete.mutate({ id: deleteTarget.id });
      toast.success('Package deleted');
      deleteTarget = null;
      invalidate();
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to delete'));
    }
  }

  const columns: DataTableColumn<PackageRow>[] = [
    textColumn<PackageRow>('name', 'Name', 'Search name', undefined, {
      width: '240px',
    }),
    textColumn<PackageRow>('description', 'Description', 'Search description'),
    stateColumn<PackageRow>(
      'status',
      'Status',
      {
        transform: (v) => String(v ?? ''),
        evaluate: (v) => {
          if (v === 'active') return 'success';
          if (v === 'archived') return 'info';
          return 'warn';
        },
      },
      {
        sortable: true,
        filter: {
          type: 'select',
          operators: ['eq'],
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Draft', value: 'draft' },
            { label: 'Archived', value: 'archived' },
          ],
        },
      }
    ),
    numberColumn<PackageRow>('stepCount', 'Steps'),
    numberColumn<PackageRow>('version', 'Version'),
    textColumn<PackageRow>('vendors', 'Vendors', 'Filter vendor'),
    textColumn<PackageRow>('categories', 'Categories', 'Filter category'),
    textColumn<PackageRow>('scope', 'Scope', 'Search scope'),
    relativeDateColumn<PackageRow>('updatedAt', 'Updated'),
    {
      key: 'actions',
      title: '',
      sortable: false,
      hideable: false,
      width: '48px',
      cell: rowActionsCell,
    },
  ];

  const rowActions: RowAction<PackageRow>[] = $derived.by(() => {
    const actions: RowAction<PackageRow>[] = [];
    if (canRun) {
      actions.push({
        label: 'Run',
        icon: Play,
        disabled: (rows) => rows.length !== 1 || rows[0]!.status !== 'active',
        onclick: (rows) => {
          const r = rows[0];
          if (!r) return;
          runDialogPackageId = r.id;
          runDialogOpen = true;
        },
      });
    }
    if (canWrite) {
      actions.push({
        label: 'Duplicate',
        icon: Copy,
        onclick: async (rows) => {
          for (const r of rows) await duplicateOne(r.id);
        },
      });
    }
    if (canDelete) {
      actions.push({
        label: 'Archive',
        icon: Archive,
        disabled: (rows) => rows.every((r) => r.status === 'archived'),
        onclick: async (rows) => {
          for (const r of rows) {
            if (r.status !== 'archived') await archiveOne(r.id);
          }
        },
      });
      actions.push({
        label: 'Delete',
        icon: Trash2,
        variant: 'destructive',
        disabled: (rows) => rows.length !== 1,
        onclick: (rows) => {
          const r = rows[0];
          if (!r) return;
          deleteTarget = r;
        },
      });
    }
    return actions;
  });

  async function fetchData(opts: PaginationInput): Promise<{ rows: PackageRow[]; total: number }> {
    const [raw, capabilities] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ['packages.list', refreshKey],
        queryFn: () => trpc.packages.list.query(),
      }),
      queryClient.fetchQuery({
        queryKey: ['packages.metadata.capabilities'],
        queryFn: () => trpc.packages.capabilities.query(),
        staleTime: 5 * 60_000,
      }),
    ]);

    const capMap = new Map(capabilities.map((c) => [c.id, c]));
    const rows: PackageRow[] = raw.map((p) => {
      const steps = Array.isArray(p.steps)
        ? (p.steps as Array<{ capabilityId: string; label?: string }>)
        : [];
      const stepCaps = steps.map((s) => capMap.get(s.capabilityId));
      const names = steps.map((s, i) => s.label ?? stepCaps[i]?.name ?? s.capabilityId);
      const preview =
        names.length === 0
          ? ''
          : names.length <= 3
            ? names.join(' → ')
            : `${names.slice(0, 3).join(' → ')} +${names.length - 3}`;
      const sites = ((p.allowedSites as string[] | null) ?? []).length;
      const groups = ((p.allowedSiteGroups as string[] | null) ?? []).length;
      let scope: string;
      if (sites === 0 && groups === 0) scope = 'Global';
      else if (groups === 0) scope = `${sites} site${sites === 1 ? '' : 's'}`;
      else if (sites === 0) scope = `${groups} group${groups === 1 ? '' : 's'}`;
      else
        scope = `${sites} site${sites === 1 ? '' : 's'} · ${groups} group${groups === 1 ? '' : 's'}`;

      const vendorSet = new Set(stepCaps.map((c) => c?.vendor).filter(Boolean) as string[]);
      const categorySet = new Set(
        stepCaps.map((c) => c?.category).filter(Boolean) as string[],
      );
      const vendors = [...vendorSet].sort().join(', ');
      const categories = [...categorySet].sort().join(', ');
      // Full-text search haystack — capability names + descriptions catch
      // "reset password" even if the step label was renamed.
      const capBlob = stepCaps
        .filter(Boolean)
        .map((c) => `${c!.name} ${c!.description ?? ''}`)
        .join(' ');

      return {
        id: p.id,
        name: p.name,
        description: p.description ?? '',
        status: p.status as PackageRow['status'],
        stepCount: steps.length,
        version: p.version,
        updatedAt: p.updatedAt,
        stepPreview: preview,
        scope,
        vendors,
        categories,
        searchBlob: [p.name, p.description ?? '', preview, vendors, categories, capBlob]
          .join(' ')
          .toLowerCase(),
      };
    });

    // Client-side filter / search / sort — package counts are always in the
    // tens or low hundreds, so a server endpoint isn't worth building yet.
    const q = opts.globalSearch.trim().toLowerCase();
    let filtered = q ? rows.filter((r) => r.searchBlob.includes(q)) : rows;

    for (const f of opts.filters) {
      filtered = filtered.filter((r) => {
        const v = (r as Record<string, unknown>)[f.field];
        if (f.operator === 'eq') return v === f.value;
        if (f.operator === 'neq') return v !== f.value;
        if (f.operator === 'contains')
          return String(v ?? '')
            .toLowerCase()
            .includes(String(f.value ?? '').toLowerCase());
        if (f.operator === 'gt') return Number(v) > Number(f.value);
        if (f.operator === 'lt') return Number(v) < Number(f.value);
        if (f.operator === 'gte') return Number(v) >= Number(f.value);
        if (f.operator === 'lte') return Number(v) <= Number(f.value);
        if (f.operator === 'is_null') return v === null || v === undefined || v === '';
        if (f.operator === 'is_not_null') return !(v === null || v === undefined || v === '');
        return true;
      });
    }

    const sorted = opts.sortField
      ? [...filtered].sort((a, b) => {
          const av = (a as Record<string, unknown>)[opts.sortField!] ?? '';
          const bv = (b as Record<string, unknown>)[opts.sortField!] ?? '';
          if (typeof av === 'number' && typeof bv === 'number') {
            return opts.sortDir === 'desc' ? bv - av : av - bv;
          }
          const cmp = String(av).localeCompare(String(bv));
          return opts.sortDir === 'desc' ? -cmp : cmp;
        })
      : filtered;

    const start = opts.page * opts.pageSize;
    return {
      rows: sorted.slice(start, start + opts.pageSize),
      total: sorted.length,
    };
  }
</script>

{#snippet rowActionsCell({ row }: { row: PackageRow })}
  <div class="flex justify-end" onclick={(e) => e.stopPropagation()} role="none">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            aria-label="Row actions"
            class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal class="size-4" />
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-44">
        {#if canRun && row.status === 'active'}
          <DropdownMenu.Item
            class="gap-2"
            onclick={() => {
              runDialogPackageId = row.id;
              runDialogOpen = true;
            }}
          >
            <Play class="size-3.5" /> Run
          </DropdownMenu.Item>
        {/if}
        {#if canWrite}
          <DropdownMenu.Item class="gap-2" onclick={() => goto(`/automation/packages/${row.id}`)}>
            <Pencil class="size-3.5" /> Edit
          </DropdownMenu.Item>
          <DropdownMenu.Item class="gap-2" onclick={() => duplicateOne(row.id)}>
            <Copy class="size-3.5" /> Duplicate
          </DropdownMenu.Item>
        {/if}
        {#if canDelete}
          <DropdownMenu.Separator />
          {#if row.status !== 'archived'}
            <DropdownMenu.Item class="gap-2" onclick={() => archiveOne(row.id)}>
              <Archive class="size-3.5" /> Archive
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Item
            class="gap-2 text-destructive focus:text-destructive"
            onclick={() => (deleteTarget = row)}
          >
            <Trash2 class="size-3.5" /> Delete
          </DropdownMenu.Item>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-4">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Packages</h1>
      <p class="text-sm text-muted-foreground">
        Compose managed capabilities into runs you can execute against any tenant.
      </p>
    </div>
    {#if canWrite}
      <Button class="gap-2" onclick={() => goto('/automation/packages/new')}>
        <Plus class="size-4" />
        New package
      </Button>
    {/if}
  </div>

  <RunPackageDialog
    bind:open={runDialogOpen}
    onOpenChange={(o) => (runDialogOpen = o)}
    packageId={runDialogPackageId}
  />

  <DataTable
    {columns}
    {fetchData}
    {refreshKey}
    {rowActions}
    actionMode="dropdown"
    enableRowSelection={rowActions.length > 0}
    enableGlobalSearch
    enableFilters
    enableExport={false}
    enableURLState={false}
    defaultPageSize={25}
    defaultSort={{ field: 'updatedAt', dir: 'desc' }}
    onrowclick={(row) => goto(`/automation/packages/${row.id}`)}
  />
</div>

<AlertDialog.Root
  open={deleteTarget !== null}
  onOpenChange={(o) => {
    if (!o) deleteTarget = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{deleteTarget?.name ?? ''}”?</AlertDialog.Title>
      <AlertDialog.Description>
        This can't be undone. Runs that reference this package will block the delete — archive it
        instead if you need to keep history.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
        onclick={deleteConfirmed}
      >
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
