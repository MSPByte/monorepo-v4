<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
  } from '$lib/components/data-table';
  import {
    relativeDateColumn,
    stateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';

  type FindingRow = {
    id: string;
    title: string;
    severity: number;
    status: string;
    siteName: string;
    linkName: string;
    resourceName: string;
    policyName: string;
    evidenceSummary: string;
    recommendation: string | null;
    lastSeenAt: string;
  };

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const columns: DataTableColumn<FindingRow>[] = [
    stateColumn<FindingRow>(
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
    {
      key: 'status',
      title: 'Status',
      sortable: true,
      cell: statusCell,
      filter: {
        type: 'select',
        operators: ['eq'],
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Acknowledged', value: 'acknowledged' },
          { label: 'Suppressed', value: 'suppressed' },
          { label: 'Regressed', value: 'regressed' },
        ],
      },
    },
    textColumn<FindingRow>('policyName', 'Policy'),
    textColumn<FindingRow>('title', 'Title', undefined, { width: '260px' }),
    textColumn<FindingRow>('siteName', 'Site'),
    textColumn<FindingRow>('linkName', 'Link'),
    textColumn<FindingRow>('resourceName', 'Affected Resource'),
    relativeDateColumn<FindingRow>('lastSeenAt', 'Last Seen'),
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.findings.tableData.query(
      toServerTableInput(input, [
        'title',
        'siteName',
        'linkName',
        'resourceName',
        'policyName',
        'evidenceSummary',
        'recommendation',
      ])
    );
    return { rows: result.rows as FindingRow[], total: result.total };
  }
</script>

{#snippet statusCell({ value }: { row: FindingRow; value: string })}
  <FindingStatusBadge status={value} />
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">Findings</h1>
    <p class="text-sm text-muted-foreground">
      Technician queue for policy failures and operational gaps.
    </p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'severity', dir: 'desc' }}
    onrowclick={(row) => goto(`/findings/${row.id}`)}
  />
</div>
