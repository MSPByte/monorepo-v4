<script lang="ts">
  import { getContext } from 'svelte';
  import type { createTrpcClient } from '$lib/trpc';
  import DataTable from '$lib/components/data-table/data-table.svelte';
  import type {
    DataTableColumn,
    PaginationInput,
    TableFilter,
  } from '$lib/components/data-table/types';
  import {
    dateColumn,
    nullableTextColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import { ActionFilterOptions, formatActionLabel } from '@mspbyte/shared';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  type AuditLogRow = inferRouterOutputs<AppRouter>['audit']['listCustomerLogs']['rows'][number];

  type AuditFilterOperator =
    | 'eq'
    | 'neq'
    | 'contains'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'is_null'
    | 'is_not_null';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  let selectedLog = $state<AuditLogRow | null>(null);

  const columns: DataTableColumn<AuditLogRow>[] = [
    dateColumn<AuditLogRow>('createdAt', 'Time', {
      width: '180px',
      filter: {
        type: 'date',
        operators: ['lt', 'gt'],
        defaultOperator: 'gt',
      },
    }, { withTime: true }),
    textColumn<AuditLogRow>('actorLabel', 'Actor', undefined, {
      width: '180px',
      filter: {
        type: 'text',
        operators: ['contains', 'eq'],
        placeholder: 'Search actors...',
      },
    }),
    {
      key: 'actionLabel',
      title: 'Action',
      width: '260px',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: ActionFilterOptions,
      },
      cell: actionLabelCell,
    },
    textColumn<AuditLogRow>('targetLabel', 'Target', undefined, {
      filter: {
        type: 'text',
        operators: ['contains', 'eq'],
        placeholder: 'Search targets...',
      },
    }),
    textColumn<AuditLogRow>('targetType', 'Type', undefined, {
      width: '160px',
      filter: {
        type: 'text',
        operators: ['contains', 'eq'],
        placeholder: 'Search target types...',
      },
    }),
    nullableTextColumn<AuditLogRow>('siteName', 'Site', {
      width: '160px',
      sortable: false,
    }),
    {
      key: 'result',
      title: 'Result',
      width: '120px',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: [
          { label: 'Success', value: 'success' },
          { label: 'Failure', value: 'failure' },
          { label: 'Partial', value: 'partial' },
        ],
      },
      cell: resultCell,
    },
  ];

  function mapOperator(op: TableFilter['operator']): AuditFilterOperator | null {
    switch (op) {
      case 'eq':
        return 'eq';
      case 'neq':
        return 'neq';
      case 'contains':
        return 'contains';
      case 'gt':
        return 'gt';
      case 'gte':
        return 'gte';
      case 'lt':
        return 'lt';
      case 'lte':
        return 'lte';
      case 'is_null':
        return 'is_null';
      case 'is_not_null':
        return 'is_not_null';
      default:
        return null;
    }
  }

  async function fetchAuditLogs(
    input: PaginationInput
  ): Promise<{ rows: AuditLogRow[]; total: number }> {
    const filters = input.filters
      .map((filter) => {
        const operator = mapOperator(filter.operator);
        if (!operator) return null;
        return {
          column: filter.field,
          operator,
          value: typeof filter.value === 'string' ? filter.value : String(filter.value),
        };
      })
      .filter((filter): filter is NonNullable<typeof filter> => filter !== null);

    const result = await trpc.audit.listCustomerLogs.query({
      page: input.page + 1,
      pageSize: input.pageSize,
      sortColumn: input.sortField,
      sortDirection: input.sortDir,
      filters,
      globalSearch: input.globalSearch || undefined,
    });

    return { rows: result.rows as AuditLogRow[], total: result.total };
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  }

  function formatTargetType(value: string) {
    return value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function actionPastTense(action: AuditLogRow['action']) {
    if (action === 'create') return 'created';
    if (action === 'update') return 'updated';
    return 'deleted';
  }

  function metadataText(value: unknown) {
    if (value == null) return 'None';
    return JSON.stringify(value, null, 2);
  }

  const detailRows = $derived(
    selectedLog
      ? [
          ['Time', formatDate(selectedLog.createdAt)],
          ['Actor', selectedLog.actorLabel],
          ['Actor Type', selectedLog.actorType],
          ['Actor ID', selectedLog.actorId],
          ['Action', formatActionLabel(selectedLog.actionLabel, selectedLog.action)],
          ['Action Type', selectedLog.action],
          ['Target Type', formatTargetType(selectedLog.targetType)],
          ['Target Label', selectedLog.targetLabel],
          ['Target ID', selectedLog.targetId],
          ['Result', selectedLog.result],
          ['Site', selectedLog.siteName ?? selectedLog.siteId ?? '—'],
          ['IP Address', selectedLog.ipAddress ?? '—'],
          ['User Agent', selectedLog.userAgent ?? '—'],
          ['Error', selectedLog.errorMessage ?? '—'],
        ]
      : []
  );
</script>

{#snippet actionLabelCell({ row }: { row: AuditLogRow; value: AuditLogRow['actionLabel'] })}
  <Badge variant="outline">{formatActionLabel(row.actionLabel, row.action)}</Badge>
{/snippet}

{#snippet resultCell({ value }: { row: AuditLogRow; value: AuditLogRow['result'] })}
  <Badge
    variant="outline"
    class={[
      'capitalize',
      value === 'success'
        ? 'bg-success/15 text-success border-success/30'
        : value === 'partial'
          ? 'bg-warning/15 text-warning border-warning/30'
          : 'bg-destructive/15 text-destructive border-destructive/30',
    ].join(' ')}
  >
    {value}
  </Badge>
{/snippet}

<div class="flex flex-col size-full overflow-hidden p-4">
  <DataTable
    fetchData={fetchAuditLogs}
    {columns}
    defaultPageSize={100}
    defaultSort={{ field: 'createdAt', dir: 'desc' }}
    onrowclick={(row) => (selectedLog = row)}
  />
</div>

<Sheet.Root
  open={!!selectedLog}
  onOpenChange={(open) => {
    if (!open) selectedLog = null;
  }}
>
  <Sheet.Content side="right" class="w-[32rem] max-w-[100vw] flex flex-col p-0">
    {#if selectedLog}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>
          {formatActionLabel(
            selectedLog.actionLabel,
            `${actionPastTense(selectedLog.action)} ${formatTargetType(selectedLog.targetType)}`
          )}: {selectedLog.targetLabel}
        </Sheet.Title>
        <Sheet.Description>{selectedLog.actorLabel} - {formatDate(selectedLog.createdAt)}</Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 space-y-5">
        <dl class="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
          {#each detailRows as [label, value]}
            <dt class="text-muted-foreground">{label}</dt>
            <dd class="min-w-0 wrap-break-word font-medium">{value}</dd>
          {/each}
        </dl>

        <div class="space-y-2">
          <div class="text-sm font-medium">Metadata</div>
          <pre
            class="overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">{metadataText(
              selectedLog.metadata
            )}</pre>
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
