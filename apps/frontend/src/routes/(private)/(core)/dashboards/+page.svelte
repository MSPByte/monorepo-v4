<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { Plus, Pin, Trash2 } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
  } from '$lib/components/data-table';
  import { relativeDateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import { showErrorToast } from '$lib/utils/errors';
  import ScopeBar from '../reports/_components/scope-bar.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));
  const canDelete = $derived(authStore.isAllowed('Reports.Delete'));

  type DashboardRow = {
    id: string;
    name: string;
    description: string | null;
    tileCount: number;
    pinned: boolean;
    updatedAt: string | null;
    [key: string]: unknown;
  };

  let refreshKey = $state(0);
  let toDelete = $state<DashboardRow | null>(null);

  const columns: DataTableColumn<DashboardRow>[] = [
    {
      key: 'name',
      title: 'Name',
      sortable: true,
      searchable: true,
      cell: nameCell,
    },
    textColumn<DashboardRow>('description', 'Description'),
    {
      key: 'tileCount',
      title: 'Tiles',
      sortable: true,
      cell: tilesCell,
    },
    relativeDateColumn<DashboardRow>('updatedAt', 'Updated'),
  ];

  async function fetchData(input: PaginationInput) {
    const rows = (await trpc.dashboards.list.query()) as DashboardRow[];
    const search = input.globalSearch?.toLowerCase();
    const filtered = search
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(search) ||
            (r.description ?? '').toLowerCase().includes(search),
        )
      : rows;
    return { rows: filtered, total: filtered.length };
  }

  async function pin(row: DashboardRow) {
    try {
      await trpc.reports.saveMyPrefs.mutate({ landingDashboardId: row.id });
      toast.success(`"${row.name}" pinned as your landing page`);
      refreshKey++;
      await queryClient.invalidateQueries({ queryKey: ['reports.getMyPrefs'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboards.list'] });
    } catch (err) {
      showErrorToast(err, 'Failed to pin dashboard');
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await trpc.dashboards.delete.mutate({ id: toDelete.id });
      toast.success(`Deleted "${toDelete.name}"`);
      refreshKey++;
      await queryClient.invalidateQueries({ queryKey: ['dashboards.list'] });
    } catch (err) {
      showErrorToast(err, 'Failed to delete dashboard');
    } finally {
      toDelete = null;
    }
  }
</script>

{#snippet nameCell({ row }: { row: DashboardRow })}
  <span class="flex items-center gap-2">
    <span class="font-medium">{row.name}</span>
    {#if row.pinned}
      <span
        class="text-primary inline-flex items-center gap-1 rounded-full border border-current/20 bg-current/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
      >
        <Pin class="size-2.5" />
        Landing
      </span>
    {/if}
  </span>
{/snippet}

{#snippet tilesCell({ row }: { row: DashboardRow })}
  <span class="text-muted-foreground font-mono text-xs tabular-nums">
    {row.tileCount}
  </span>
{/snippet}

<AlertDialog.Root open={toDelete !== null} onOpenChange={(v) => !v && (toDelete = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete "{toDelete?.name}"?</AlertDialog.Title>
      <AlertDialog.Description>
        Removes the dashboard and all its tiles. The underlying reports are not affected.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={confirmDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Dashboards</h1>
      <p class="text-sm text-muted-foreground">
        Glanceable KPIs built from your reports. Pin one as your landing page.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <ScopeBar />
      {#if canWrite}
        <Button size="sm" class="gap-2" onclick={() => goto('/dashboards/new')}>
          <Plus class="size-4" />
          New dashboard
        </Button>
      {/if}
    </div>
  </div>

  <DataTable
    {fetchData}
    {columns}
    {refreshKey}
    defaultPageSize={25}
    defaultSort={{ field: 'updatedAt', dir: 'desc' }}
    onrowclick={(row) => goto(`/dashboards/${row.id}`)}
    rowActions={[
      {
        label: 'Pin as landing',
        icon: Pin,
        onclick: (rows) => rows[0] && void pin(rows[0]),
      },
      ...(canDelete
        ? [
            {
              label: 'Delete',
              icon: Trash2,
              variant: 'destructive' as const,
              onclick: (rows: DashboardRow[]) => {
                toDelete = rows[0] ?? null;
              },
            },
          ]
        : []),
    ]}
  />
</div>
