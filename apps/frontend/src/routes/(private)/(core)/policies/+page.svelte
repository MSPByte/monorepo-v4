<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { Copy, Plus, Trash2 } from '@lucide/svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
    type RowAction,
  } from '$lib/components/data-table';
  import {
    boolBadgeColumn,
    numberColumn,
    stateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import Button from '$lib/components/ui/button/button.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  type PolicyRow = {
    id: string;
    name: string;
    enabled: boolean;
    severity: number;
    category: string | null;
    scope: string;
    source: string;
    dataSource: string;
    origin: string;
    frameworkList: string;
    openFindingCount: number;
  };

  const columns: DataTableColumn<PolicyRow>[] = [
    textColumn<PolicyRow>('name', 'Policy Name', undefined, undefined, { width: '260px' }),
    boolBadgeColumn<PolicyRow>('enabled', 'Enabled', {
      trueLabel: 'Enabled',
      falseLabel: 'Off',
    }),
    stateColumn<PolicyRow>(
      'severity',
      'Severity',
      {
        transform: (v) => {
          switch (v) {
            case 4:
              return 'Critical';
            case 3:
              return 'High';
            case 2:
              return 'Medium';
            case 1:
              return 'Low';
            default:
              return 'Unknown';
          }
        },
        evaluate: (v) => {
          if (v === 4) {
            return 'critical';
          } else if (v === 3) {
            return 'destructive';
          } else if (v === 2) {
            return 'warn';
          } else if (v === 1) {
            return 'info';
          } else return 'success';
        },
      },
      {
        sortable: true,
        filter: {
          type: 'select',
          operators: ['eq'],
          options: [
            { label: 'Critical', value: 4 },
            { label: 'High', value: 3 },
            { label: 'Medium', value: 2 },
            { label: 'Low', value: 1 },
          ],
        },
      }
    ),
    textColumn<PolicyRow>('category', 'Category'),
    textColumn<PolicyRow>('scope', 'Scope'),
    {
      key: 'dataSource',
      title: 'Data Source',
      sortable: false,
      cell: sourceCell,
    },
    numberColumn<PolicyRow>('openFindingCount', 'Open Findings'),
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.policies.tableData.query(
      toServerTableInput(input, [
        'name',
        'description',
        'category',
        'scope',
        'source',
        'frameworkList',
      ])
    );
    return { rows: result.rows as PolicyRow[], total: result.total };
  }

  const canWritePolicies = $derived(authStore.isAllowed('Policies.Write'));
  const canDeletePolicies = $derived(authStore.isAllowed('Policies.Delete'));
  const rowActions: RowAction<PolicyRow>[] = $derived([
    ...(canWritePolicies
      ? [
          {
            label: 'Duplicate',
            icon: Copy,
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = rows.map((row) => row.id).filter(Boolean);
              if (ids.length === 0) return;

              setProgress(`Duplicating ${ids.length} polic${ids.length === 1 ? 'y' : 'ies'}...`);
              for (const id of ids) {
                await trpc.policies.duplicate.mutate({ id });
              }
              setProgress('Refreshing policies...');
              await queryClient.invalidateQueries({ queryKey: ['policies.list'] });
              await fetchData();
              toast.success(
                `Duplicated ${ids.length} polic${ids.length === 1 ? 'y' : 'ies'}`
              );
            },
          } satisfies RowAction<PolicyRow>,
        ]
      : []),
    ...(canDeletePolicies
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            variant: 'destructive',
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = rows.map((row) => row.id).filter(Boolean);
              if (ids.length === 0) return;

              setProgress(`Deleting ${ids.length} polic${ids.length === 1 ? 'y' : 'ies'}...`);
              const result = await trpc.policies.delete.mutate({ ids });
              setProgress('Refreshing policies...');
              await queryClient.invalidateQueries({ queryKey: ['policies.list'] });
              await fetchData();

              if (result.failed > 0 && result.deleted > 0) {
                toast.warning(
                  `Deleted ${result.deleted} polic${result.deleted === 1 ? 'y' : 'ies'}, ${result.failed} failed`
                );
              } else if (result.failed > 0) {
                toast.error(
                  `Failed to delete ${result.failed} polic${result.failed === 1 ? 'y' : 'ies'}`
                );
              } else {
                toast.success(
                  `Deleted ${result.deleted} polic${result.deleted === 1 ? 'y' : 'ies'}`
                );
              }
            },
          } satisfies RowAction<PolicyRow>,
        ]
      : []),
  ]);
</script>

{#snippet severityCell({ value }: { row: PolicyRow; value: number })}
  <FindingSeverityBadge severity={value} />
{/snippet}

{#snippet sourceCell({ value }: { row: PolicyRow; value: string })}
  <SourceBadge source={value} />
{/snippet}

<div class="pw-library flex size-full min-h-0 flex-col gap-4 overflow-hidden">
  <div class="pw-heading shrink-0">
    <div>
      <div class="pw-eyebrow">Operations / Policy library</div>
      <h1>Policies</h1>
      <p class="pw-description">Define what healthy looks like. Review findings and refine the rules that keep your sites on track.</p>
    </div>
    {#if canWritePolicies}<Button class="gap-2" onclick={() => goto('/policies/builder')}>
      <Plus class="size-4" />
      Create policy
    </Button>{/if}
  </div>

  <DataTable
    {fetchData}
    {columns}
    views={[
      { id: 'attention', label: 'With open findings', filters: [{ field: 'openFindingCount', operator: 'gt', value: 0 }] },
      { id: 'enabled', label: 'Enabled', filters: [{ field: 'enabled', operator: 'eq', value: true }] },
      { id: 'disabled', label: 'Disabled', filters: [{ field: 'enabled', operator: 'eq', value: false }] },
    ]}
    enableRowSelection={canWritePolicies || canDeletePolicies}
    {rowActions}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/policies/${row.id}`)}
  />
</div>
