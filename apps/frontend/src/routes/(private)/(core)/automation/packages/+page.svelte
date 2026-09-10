<script lang="ts">
  import './workspace.css';
  import '../workspace.css';
  import type { SignalStripApi } from '$lib/components/data-table/types';
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { STALE } from '$lib/query';
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
  import { Play, Pencil, Archive, Plus, Copy, Trash2, MoreHorizontal, CalendarClock, Layers, ArrowRight, Workflow, ShieldCheck } from '@lucide/svelte';
  import { prettyText } from '$lib/utils/format';

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
  let packageSummary = $state<{ total: number; active: number; draft: number; archived: number } | null>(null);
  const views = [
    { id: 'active', label: 'Active', filters: [{ field: 'status', operator: 'eq' as const, value: 'active' }] },
    { id: 'draft', label: 'Drafts', filters: [{ field: 'status', operator: 'eq' as const, value: 'draft' }] },
    { id: 'archived', label: 'Archived', filters: [{ field: 'status', operator: 'eq' as const, value: 'archived' }] },
  ];
  let runDialogOpen = $state(false);
  let runDialogPackageId = $state<string | undefined>(undefined);
  let scheduleDialogTarget = $state<PackageRow | null>(null);
  let deleteTarget = $state<PackageRow | null>(null);
  let deleteHistoryAcknowledged = $state(false);

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
    if (!deleteTarget || !deleteHistoryAcknowledged) return;
    try {
      await trpc.packages.delete.mutate({
        id: deleteTarget.id,
        deleteRunHistory: true,
      });
      toast.success('Package deleted');
      deleteTarget = null;
      invalidate();
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to delete'));
    }
  }

  function openDeleteDialog(target: PackageRow) {
    deleteTarget = target;
    deleteHistoryAcknowledged = false;
  }

  const columns: DataTableColumn<PackageRow>[] = [
    textColumn<PackageRow>('name', 'Name', 'Search name', undefined, {
      width: '340px',
      cell: packageIdentity,
      cellComponent: undefined,
    }),
    { ...textColumn<PackageRow>('description', 'Description', 'Search description'), defaultHidden: true },
    stateColumn<PackageRow>(
      'status',
      'Status',
      {
        transform: (v) => prettyText(String(v ?? '')),
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
    { ...numberColumn<PackageRow>('version', 'Version'), defaultHidden: true },
    textColumn<PackageRow>('vendors', 'Connected tools', 'Filter vendor', { pretty: true }),
    { ...textColumn<PackageRow>('categories', 'Categories', 'Filter category', { pretty: true }), defaultHidden: true },
    textColumn<PackageRow>('scope', 'Available to', 'Search scope'),
    relativeDateColumn<PackageRow>('updatedAt', 'Updated'),
    {key:'run',title:'',sortable:false,hideable:false,width:'130px',cell:packageRunAction},
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
      actions.push({
        label: 'Schedule',
        icon: CalendarClock,
        disabled: (rows) => rows.length !== 1 || rows[0]!.status !== 'active',
        onclick: (rows) => {
          const row = rows[0];
          if (row) scheduleDialogTarget = row;
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
          openDeleteDialog(r);
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
        staleTime: STALE.REF,
      }),
    ]);

    packageSummary = { total: raw.length, active: raw.filter(p => p.status === 'active').length, draft: raw.filter(p => p.status === 'draft').length, archived: raw.filter(p => p.status === 'archived').length };
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
      const links = ((p.allowedIntegrationLinks as string[] | null) ?? []).length;
      let scope: string;
      if (sites === 0 && groups === 0 && links === 0) scope = 'All clients';
      else if (groups === 0 && links === 0) scope = `${sites} site${sites === 1 ? '' : 's'}`;
      else if (sites === 0 && links === 0) scope = `${groups} group${groups === 1 ? '' : 's'}`;
      else if (sites === 0 && groups === 0) scope = `${links} tenant${links === 1 ? '' : 's'}`;
      else
        scope = [
          sites > 0 ? `${sites} site${sites === 1 ? '' : 's'}` : null,
          groups > 0 ? `${groups} group${groups === 1 ? '' : 's'}` : null,
          links > 0 ? `${links} tenant${links === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

      const vendorSet = new Set(stepCaps.map((c) => c?.vendor).filter(Boolean) as string[]);
      const categorySet = new Set(stepCaps.map((c) => c?.category).filter(Boolean) as string[]);
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
          <DropdownMenu.Item class="gap-2" onclick={() => (scheduleDialogTarget = row)}>
            <CalendarClock class="size-3.5" /> Schedule
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
            onclick={() => openDeleteDialog(row)}
          >
            <Trash2 class="size-3.5" /> Delete
          </DropdownMenu.Item>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
{/snippet}

{#snippet packageIdentity({ row }: { row: PackageRow })}
  <div class="pk-identity"><span class="pk-package-icon"><Layers size={18} strokeWidth={1.6} /></span><div><a href={'/automation/packages/' + row.id} onclick={(event) => event.stopPropagation()}>{row.name}</a><p title={row.description}>{row.description || 'No description added'}</p>{#if row.stepPreview}<span class="pk-step-preview" title={row.stepPreview}>{row.stepPreview}</span>{/if}</div></div>
{/snippet}

{#snippet packageRunAction({row}: {row:PackageRow})}
  <div onclick={(event)=>event.stopPropagation()} role="none">
    {#if row.status==='active' && canRun}<Button variant="outline" size="sm" class="gap-2" onclick={()=>{runDialogPackageId=row.id;runDialogOpen=true;}}><Play size={13} /> Run</Button>
    {:else}<a class="text-xs text-primary" href={`/automation/packages/${row.id}`}>{row.status==='draft' && canWrite ? 'Continue building' : 'View package'}</a>{/if}
  </div>
{/snippet}
{#snippet packageSignals(api:SignalStripApi)}<div class="au-signal-strip"><button type="button" aria-pressed={!api.activeViewId} onclick={()=>{api.clearFilters();api.setView();}}><strong>{packageSummary?.total ?? '—'}</strong>All</button>{#each [{label:'Ready to run',value:'active',count:packageSummary?.active,tone:'au-success'},{label:'Drafts',value:'draft',count:packageSummary?.draft,tone:'au-attention'},{label:'Archived',value:'archived',count:packageSummary?.archived,tone:''}] as item}<button type="button" class={item.tone} aria-pressed={api.activeViewId===(item.value)} onclick={()=>{api.clearFilters();api.setView(item.value);}}><strong>{item.count ?? '—'}</strong>{item.label}</button>{/each}<span>{packageSummary?.total ?? '—'} packages</span></div>{/snippet}
<div class="pk-workspace au-page">
  <header class="au-heading"><div><p class="au-eyebrow">Automation / Package library</p><h1>Packages</h1><p>Build repeatable workflows for your team. Run them when needed or schedule them for your clients.</p></div>{#if canWrite}<Button onclick={()=>goto('/automation/packages/new')} class="gap-2"><Plus size={15} /> Create package</Button>{/if}</header>
  <RunPackageDialog
    bind:open={runDialogOpen}
    onOpenChange={(o) => (runDialogOpen = o)}
    packageId={runDialogPackageId}
  />
  <RunPackageDialog
    open={scheduleDialogTarget !== null}
    onOpenChange={(open) => {
      if (!open) scheduleDialogTarget = null;
    }}
    packageId={scheduleDialogTarget?.id}
    scheduleMode
    onScheduled={() => void queryClient.invalidateQueries({ queryKey: ['packageRuns.schedules'] })}
  />

  <div class="au-table">
  <DataTable
    {views}
    enableViewSelector={false}
    signalStrip={packageSignals}
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
</div>

<AlertDialog.Root
  open={deleteTarget !== null}
  onOpenChange={(o) => {
    if (!o) {
      deleteTarget = null;
      deleteHistoryAcknowledged = false;
    }
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{deleteTarget?.name ?? ''}”?</AlertDialog.Title>
      <AlertDialog.Description>
        This permanently removes the package and its run history. Packages with scheduled or active
        runs, or packages used by another package, cannot be deleted.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <label class="flex items-start gap-2 text-sm">
      <input class="mt-0.5" type="checkbox" bind:checked={deleteHistoryAcknowledged} />
      <span>I understand that this permanently deletes the package and its run history.</span>
    </label>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
        disabled={!deleteHistoryAcknowledged}
        onclick={deleteConfirmed}
      >
        Delete package
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
