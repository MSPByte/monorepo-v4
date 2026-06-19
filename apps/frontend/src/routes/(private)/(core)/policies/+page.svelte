<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { DataTable, type DataTableColumn, type PaginationInput } from '$lib/components/data-table';
  import {
    boolBadgeColumn,
    numberColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  type PolicyRow = {
    id: string;
    name: string;
    enabled: boolean;
    severity: number;
    category: string | null;
    scope: string;
    source: string;
    frameworkList: string;
    openFindingCount: number;
  };

  const columns: DataTableColumn<PolicyRow>[] = [
    textColumn<PolicyRow>('name', 'Policy Name', undefined, { width: '260px' }),
    boolBadgeColumn<PolicyRow>('enabled', 'Enabled', {
      trueLabel: 'Enabled',
      falseLabel: 'Off',
    }),
    { key: 'severity', title: 'Severity', sortable: true, cell: severityCell, filter: { type: 'select', operators: ['eq'], options: [{ label: 'Critical', value: 4 }, { label: 'High', value: 3 }, { label: 'Medium', value: 2 }, { label: 'Low', value: 1 }] } },
    textColumn<PolicyRow>('category', 'Category'),
    textColumn<PolicyRow>('scope', 'Scope'),
    { key: 'source', title: 'Source', sortable: true, cell: sourceCell, filter: { type: 'select', operators: ['eq'], options: [{ label: 'Catalog', value: 'catalog' }, { label: 'Custom', value: 'custom' }] } },
    textColumn<PolicyRow>('frameworkList', 'Framework Membership', undefined, { width: '240px' }),
    numberColumn<PolicyRow>('openFindingCount', 'Open Findings'),
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.policies.tableData.query(
      toServerTableInput(input, ['name', 'description', 'category', 'scope', 'source', 'frameworkList'])
    );
    return { rows: result.rows as PolicyRow[], total: result.total };
  }
</script>

{#snippet severityCell({ value }: { row: PolicyRow; value: number })}
  <FindingSeverityBadge severity={value} />
{/snippet}

{#snippet sourceCell({ value }: { row: PolicyRow; value: string })}
  <SourceBadge source={value} />
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">Policies</h1>
    <p class="text-sm text-muted-foreground">Operational expectations that produce findings.</p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindingCount', dir: 'desc' }}
    onrowclick={(row) => goto(`/policies/${row.id}`)}
  />
</div>
