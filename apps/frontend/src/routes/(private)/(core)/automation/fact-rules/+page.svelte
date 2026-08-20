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
  import type {
    DataTableColumn,
    PaginationInput,
    TableFilter,
  } from '$lib/components/data-table/types';
  import {
    boolBadgeColumn,
    relativeDateColumn,
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
    textColumn<FactRuleRow>('name', 'Name', 'Search fact rules'),
    boolBadgeColumn<FactRuleRow>('enabled', 'Status', {
      trueLabel: 'Enabled',
      falseLabel: 'Disabled',
    }),
    textColumn<FactRuleRow>('dataSource', 'Data Source'),
    textColumn<FactRuleRow>('factKey', 'Fact Key', 'Search fact keys'),
    numberColumn<FactRuleRow>('priority', 'Priority'),
    relativeDateColumn<FactRuleRow>('updatedAt', 'Updated'),
  ];

  function compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a ?? '').localeCompare(String(b ?? ''));
  }

  function matchesFilter(value: unknown, filter: TableFilter): boolean {
    if (filter.operator === 'eq') return value === filter.value;
    if (filter.operator === 'neq') return value !== filter.value;
    if (filter.operator === 'contains') {
      return String(value ?? '')
        .toLowerCase()
        .includes(String(filter.value ?? '').toLowerCase());
    }
    if (filter.operator === 'gt') return Number(value) > Number(filter.value);
    if (filter.operator === 'gte') return Number(value) >= Number(filter.value);
    if (filter.operator === 'lt') return Number(value) < Number(filter.value);
    if (filter.operator === 'lte') return Number(value) <= Number(filter.value);
    if (filter.operator === 'is_null') return value === null || value === undefined || value === '';
    if (filter.operator === 'is_not_null')
      return !(value === null || value === undefined || value === '');
    return true;
  }

  async function fetchData(
    input: PaginationInput
  ): Promise<{ rows: FactRuleRow[]; total: number }> {
    const rows = (await trpc.factRules.list.query()) as FactRuleRow[];
    const query = input.globalSearch.trim().toLowerCase();
    let filtered = query
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(query) ||
            row.factKey.toLowerCase().includes(query) ||
            row.dataSource.toLowerCase().includes(query)
        )
      : rows;
    for (const filter of input.filters) {
      filtered = filtered.filter((row) => matchesFilter(row[filter.field], filter));
    }
    const sorted = input.sortField
      ? [...filtered].sort((a, b) => {
          const comparison = compareValues(a[input.sortField!], b[input.sortField!]);
          return input.sortDir === 'asc' ? comparison : -comparison;
        })
      : filtered;
    const start = input.page * input.pageSize;
    return {
      rows: sorted.slice(start, start + input.pageSize),
      total: sorted.length,
    };
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
      onrowclick={(row) => goto(`/automation/fact-rules/${row.id}`)}
      onselectionchange={(rows) => (selectedIds = rows.map((row) => row.id))}
      enableRowSelection={canDelete}
    />
  </div>
</div>
