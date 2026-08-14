<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import { DataTable } from '$lib/components/data-table';
  import type { DataTableColumn, PaginationInput } from '$lib/components/data-table/types';
  import {
    relativeDateColumn,
    stateColumn,
    textColumn,
    numberColumn,
  } from '$lib/components/data-table/column-defs';
  import Button from '$lib/components/ui/button/button.svelte';
  import { toUserMessage } from '$lib/utils/errors';
  import { Plus, Trash2 } from '@lucide/svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Policies.Write'));
  const canDelete = $derived(authStore.isAllowed('Policies.Delete'));

  type FactRuleRow = {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    factKey: string;
    dataSource: string;
    priority: number;
    updatedAt: string | null;
    [key: string]: unknown;
  };

  let refreshKey = $state(0);
  let selectedIds = $state<string[]>([]);
  let deleteDialogOpen = $state(false);

  const columns: DataTableColumn<FactRuleRow>[] = [
    textColumn({ key: 'name', label: 'Name', sortable: true, searchable: true }),
    stateColumn({
      key: 'enabled',
      label: 'Status',
      states: {
        true: { label: 'Enabled', variant: 'success' },
        false: { label: 'Disabled', variant: 'muted' },
      },
    }),
    textColumn({ key: 'dataSource', label: 'Data Source', sortable: true }),
    textColumn({ key: 'factKey', label: 'Fact Key', sortable: true, searchable: true }),
    numberColumn({ key: 'priority', label: 'Priority', sortable: true }),
    relativeDateColumn({ key: 'updatedAt', label: 'Updated' }),
  ];

  async function fetchData(input: PaginationInput) {
    const rows = await trpc.factRules.list.query();
    const filtered = input.search
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(input.search!.toLowerCase()) ||
            row.factKey.toLowerCase().includes(input.search!.toLowerCase())
        )
      : rows;
    return { rows: filtered as FactRuleRow[], total: filtered.length };
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) return;
    try {
      await trpc.factRules.delete.mutate({ ids: selectedIds });
      toast.success(`Deleted ${selectedIds.length} fact rule${selectedIds.length > 1 ? 's' : ''}`);
      selectedIds = [];
      refreshKey++;
      await queryClient.invalidateQueries({ queryKey: ['factRules.list'] });
    } catch (error) {
      toast.error(toUserMessage(error, 'Failed to delete fact rules'));
    } finally {
      deleteDialogOpen = false;
    }
  }
</script>

<AlertDialog.Root bind:open={deleteDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title
        >Delete {selectedIds.length} fact rule{selectedIds.length > 1
          ? 's'
          : ''}?</AlertDialog.Title
      >
      <AlertDialog.Description>
        This will permanently remove the selected fact rules. Existing site facts written by these
        rules will not be removed.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={deleteSelected}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<div class="flex size-full flex-col overflow-hidden">
  <div class="flex items-center justify-between border-b px-6 py-3">
    <div>
      <h1 class="text-base font-semibold">Fact Rules</h1>
      <p class="text-xs text-muted-foreground">
        Automatically populate site facts from vendor data after each sync.
      </p>
    </div>
    <div class="flex items-center gap-2">
      {#if selectedIds.length > 0 && canDelete}
        <Button
          variant="destructive"
          size="sm"
          class="gap-2"
          onclick={() => (deleteDialogOpen = true)}
        >
          <Trash2 class="size-4" />
          Delete ({selectedIds.length})
        </Button>
      {/if}
      {#if canWrite}
        <Button size="sm" class="gap-2" onclick={() => goto('/automation/fact-rules/builder')}>
          <Plus class="size-4" />
          New Rule
        </Button>
      {/if}
    </div>
  </div>

  <div class="flex size-full p-4">
    <DataTable
      {columns}
      {fetchData}
      {refreshKey}
      onRowClick={(row) => goto(`/automation/fact-rules/${row.id}`)}
      bind:selectedIds
      selectable={canDelete}
    />
  </div>
</div>
