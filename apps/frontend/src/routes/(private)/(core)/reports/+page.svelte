<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { Plus, Trash2 } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { getPolicyTableShape } from '@mspbyte/shared';
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

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));
  const canDelete = $derived(authStore.isAllowed('Reports.Delete'));

  type ReportRow = {
    id: string;
    name: string;
    description: string | null;
    source: string;
    sourceLabel: string;
    updatedAt: string | null;
    [key: string]: unknown;
  };

  let refreshKey = $state(0);
  let toDelete = $state<ReportRow | null>(null);

  const columns: DataTableColumn<ReportRow>[] = [
    textColumn<ReportRow>('name', 'Name'),
    textColumn<ReportRow>('sourceLabel', 'Source'),
    textColumn<ReportRow>('description', 'Description'),
    relativeDateColumn<ReportRow>('updatedAt', 'Updated'),
  ];

  async function fetchData(input: PaginationInput) {
    const rows = await trpc.reports.list.query();
    const enriched: ReportRow[] = rows.map((r) => ({
      ...r,
      sourceLabel: getPolicyTableShape(r.source)?.label ?? r.source,
    }));
    const search = input.globalSearch?.toLowerCase();
    const filtered = search
      ? enriched.filter(
          (r) =>
            r.name.toLowerCase().includes(search) ||
            r.sourceLabel.toLowerCase().includes(search),
        )
      : enriched;
    return { rows: filtered, total: filtered.length };
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await trpc.reports.delete.mutate({ id: toDelete.id });
      toast.success(`Deleted "${toDelete.name}"`);
      refreshKey++;
      await queryClient.invalidateQueries({ queryKey: ['reports.list'] });
    } catch (err) {
      showErrorToast(err, 'Failed to delete report');
    } finally {
      toDelete = null;
    }
  }
</script>

<AlertDialog.Root open={toDelete !== null} onOpenChange={(v) => !v && (toDelete = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete "{toDelete?.name}"?</AlertDialog.Title>
      <AlertDialog.Description>
        Removes the saved report. Dashboards referencing it will show an empty tile until you
        repoint them.
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
      <h1 class="text-2xl font-semibold tracking-normal">Reports</h1>
      <p class="text-sm text-muted-foreground">
        Compose reports over vendor data. Reports are visible to everyone with Reports.Read.
      </p>
    </div>
    {#if canWrite}
      <Button size="sm" class="gap-2" onclick={() => goto('/reports/builder')}>
        <Plus class="size-4" />
        New report
      </Button>
    {/if}
  </div>

  <DataTable
    {fetchData}
    {columns}
    {refreshKey}
    defaultPageSize={25}
    defaultSort={{ field: 'updatedAt', dir: 'desc' }}
    onrowclick={(row) => goto(`/reports/builder?id=${row.id}`)}
    rowActions={canDelete
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            variant: 'destructive',
            onclick: (rows) => {
              toDelete = rows[0] ?? null;
            },
          },
        ]
      : []}
  />
</div>
