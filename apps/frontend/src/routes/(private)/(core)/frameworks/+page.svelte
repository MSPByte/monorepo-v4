<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { DataTable, type DataTableColumn, type PaginationInput } from '$lib/components/data-table';
  import {
    boolBadgeColumn,
    numberColumn,
    relativeDateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import { toServerTableInput } from '$lib/components/domain/server-table';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  type FrameworkRow = {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    policyCount: number;
    passRate: number;
    openFindings: number;
    lastEvaluation?: string;
    updatedAt?: string;
  };

  const columns: DataTableColumn<FrameworkRow>[] = [
    textColumn<FrameworkRow>('name', 'Framework Name', undefined, { width: '260px' }),
    boolBadgeColumn<FrameworkRow>('enabled', 'Enabled', {
      trueLabel: 'Enabled',
      falseLabel: 'Off',
    }),
    numberColumn<FrameworkRow>('policyCount', 'Policy Count'),
    numberColumn<FrameworkRow>('passRate', 'Pass %', undefined, { cell: percentCell }),
    numberColumn<FrameworkRow>('openFindings', 'Open Findings'),
    relativeDateColumn<FrameworkRow>('updatedAt', 'Last Evaluation'),
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.frameworks.tableData.query(
      toServerTableInput(input, ['name', 'description'])
    );
    return { rows: result.rows as FrameworkRow[], total: result.total };
  }
</script>

{#snippet percentCell({ value }: { row: FrameworkRow; value: number })}
  <span>{value}%</span>
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">Frameworks</h1>
    <p class="text-sm text-muted-foreground">Policy bundles that define baselines and standards.</p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'openFindings', dir: 'desc' }}
    onrowclick={(row) => goto(`/frameworks/${row.id}`)}
  />
</div>
