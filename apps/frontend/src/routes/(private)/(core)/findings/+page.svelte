<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { DataTable, type DataTableColumn, type PaginationInput } from '$lib/components/data-table';
  import { relativeDateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';

  type FindingRow = {
    id: string;
    title: string;
    severity: number;
    status: string;
    siteName: string;
    resourceName: string;
    policyName: string;
    evidenceSummary: string;
    recommendation: string | null;
    lastSeenAt: string;
  };

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const columns: DataTableColumn<FindingRow>[] = [
    textColumn<FindingRow>('title', 'Title', undefined, { width: '260px' }),
    { key: 'severity', title: 'Severity', sortable: true, cell: severityCell, filter: { type: 'select', operators: ['eq'], options: [{ label: 'Critical', value: 4 }, { label: 'High', value: 3 }, { label: 'Medium', value: 2 }, { label: 'Low', value: 1 }] } },
    { key: 'status', title: 'Status', sortable: true, cell: statusCell, filter: { type: 'select', operators: ['eq'], options: [{ label: 'Open', value: 'open' }, { label: 'Acknowledged', value: 'acknowledged' }, { label: 'Suppressed', value: 'suppressed' }, { label: 'Regressed', value: 'regressed' }] } },
    textColumn<FindingRow>('siteName', 'Site'),
    textColumn<FindingRow>('resourceName', 'Affected Resource'),
    textColumn<FindingRow>('policyName', 'Policy'),
    textColumn<FindingRow>('evidenceSummary', 'Evidence Summary', undefined, { width: '280px' }),
    textColumn<FindingRow>('recommendation', 'Recommendation', undefined, { width: '280px' }),
    relativeDateColumn<FindingRow>('lastSeenAt', 'Last Seen'),
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.findings.tableData.query(
      toServerTableInput(input, ['title', 'siteName', 'resourceName', 'policyName', 'evidenceSummary', 'recommendation'])
    );
    return { rows: result.rows as FindingRow[], total: result.total };
  }
</script>

{#snippet severityCell({ value }: { row: FindingRow; value: number })}
  <FindingSeverityBadge severity={value} />
{/snippet}

{#snippet statusCell({ value }: { row: FindingRow; value: string })}
  <FindingStatusBadge status={value} />
{/snippet}

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-normal">Findings</h1>
    <p class="text-sm text-muted-foreground">Technician queue for policy failures and operational gaps.</p>
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'severity', dir: 'desc' }}
    onrowclick={(row) => goto(`/findings/${row.id}`)}
  />
</div>
