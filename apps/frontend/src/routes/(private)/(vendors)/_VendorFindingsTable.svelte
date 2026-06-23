<script lang="ts">
  import { getContext } from 'svelte';
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
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import FindingSheet from '$lib/components/domain/finding-sheet.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';

  type FindingRow = {
    id: string;
    title: string;
    severity: number;
    status: string;
    siteName: string;
    linkId: string;
    linkName: string;
    resourceName: string;
    policyName: string;
    evidenceSummary: string;
    recommendation: string | null;
    lastSeenAt: string;
  };

  let {
    linkId,
    providerId,
    showLinkColumn = false,
    showSiteColumn = true,
  }: {
    linkId?: string | null;
    providerId?: string;
    showLinkColumn?: boolean;
    showSiteColumn?: boolean;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  let selectedFindingId = $state<string | null>(null);
  let refreshKey = $state(0);

  const columns: DataTableColumn<FindingRow>[] = $derived([
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
          if (v === 4) return 'critical';
          if (v === 3) return 'destructive';
          if (v === 2) return 'warn';
          if (v === 1) return 'info';
          return 'success';
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
    ...(showSiteColumn ? [textColumn<FindingRow>('siteName', 'Site')] : []),
    ...(showLinkColumn ? [textColumn<FindingRow>('linkName', 'Link')] : []),
    textColumn<FindingRow>('resourceName', 'Affected Resource'),
    relativeDateColumn<FindingRow>('lastSeenAt', 'Last Seen'),
  ]);

  async function fetchData(input: PaginationInput) {
    const baseInput = toServerTableInput(input, [
      'title',
      'siteName',
      'linkName',
      'resourceName',
      'policyName',
      'evidenceSummary',
      'recommendation',
    ]);

    const extraFilters: { column: string; operator: 'eq'; value: string }[] = [];
    if (linkId) extraFilters.push({ column: 'linkId', operator: 'eq', value: linkId });
    else if (providerId)
      extraFilters.push({ column: 'providerId', operator: 'eq', value: providerId });

    const filters = extraFilters.length
      ? [...baseInput.filters, ...extraFilters]
      : baseInput.filters;

    const result = await trpc.findings.tableData.query({ ...baseInput, filters });
    return { rows: result.rows as FindingRow[], total: result.total };
  }

  function refreshTable() {
    refreshKey += 1;
  }
</script>

{#snippet statusCell({ value }: { row: FindingRow; value: string })}
  <FindingStatusBadge status={value} />
{/snippet}

<DataTable
  {fetchData}
  {columns}
  defaultPageSize={25}
  defaultSort={{ field: 'severity', dir: 'desc' }}
  {refreshKey}
  onrowclick={(row) => (selectedFindingId = row.id)}
/>

<FindingSheet
  findingId={selectedFindingId}
  onclose={() => (selectedFindingId = null)}
  onchange={refreshTable}
/>
