<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
    type TableView,
  } from '$lib/components/data-table';
  import {
    relativeDateColumn,
    stateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import SectionPanel from '../../_components/site-panel.svelte';
  import { useSiteContext } from '../_components/site-context';

  const ctx = useSiteContext();
  const site = $derived(ctx.site!);

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const breakdownQuery = createQuery(() => ({
    queryKey: ['findings.list', { siteId: site?.id, status: 'open' }],
    queryFn: () => trpc.findings.list.query({ siteId: site!.id, status: 'open' }),
    enabled: !!site?.id,
  }));

  const breakdown = $derived.by(() => {
    const rows = breakdownQuery.data ?? [];
    return {
      critical: rows.filter((r) => r.severity === 4).length,
      high: rows.filter((r) => r.severity === 3).length,
      medium: rows.filter((r) => r.severity === 2).length,
      low: rows.filter((r) => r.severity === 1).length,
      total: rows.length,
    };
  });

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

  const columns: DataTableColumn<FindingRow>[] = [
    stateColumn<FindingRow>(
      'severity',
      'Sev',
      {
        transform: (v) =>
          v === 4 ? 'CRIT' : v === 3 ? 'HIGH' : v === 2 ? 'MED' : v === 1 ? 'LOW' : '—',
        evaluate: (v) =>
          v === 4
            ? 'critical'
            : v === 3
              ? 'destructive'
              : v === 2
                ? 'warn'
                : v === 1
                  ? 'info'
                  : 'success',
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
    textColumn<FindingRow>('title', 'Title', undefined, undefined, { width: '320px', cell: findingCell, cellComponent: undefined }),
    textColumn<FindingRow>('linkName', 'Source'),
    textColumn<FindingRow>('resourceName', 'Resource'),
    relativeDateColumn<FindingRow>('lastSeenAt', 'Last Seen'),
  ];

  const views: TableView<FindingRow>[] = [
    {
      id: 'open-findings',
      label: 'Open',
      isDefault: true,
      filters: [{ field: 'status', operator: 'eq', value: 'open' }],
    },
    { id: 'all-findings', label: 'All', filters: [] },
  ];

  async function fetchData(input: PaginationInput) {
    const base = toServerTableInput(input, [
      'title',
      'linkName',
      'resourceName',
      'policyName',
      'evidenceSummary',
    ]);
    const result = await trpc.findings.tableData.query({
      ...base,
      filters: [
        ...(base.filters ?? []),
        { column: 'siteId', operator: 'eq' as const, value: site.id },
      ],
    });
    return { rows: result.rows as FindingRow[], total: result.total };
  }
</script>

{#snippet findingCell({ row }: { row: FindingRow; value: string })}
  <a class="sw-site-link" href={`/findings/${row.id}`} onclick={(event) => event.stopPropagation()}>{row.title}</a>
{/snippet}

{#snippet statusCell({ value }: { row: FindingRow; value: string })}
  <FindingStatusBadge status={value} />
{/snippet}

<div class="sw-page">
  <div class="sw-section-heading">
    <div>
      <h2>Findings</h2>
      <p>Prioritize open issues by severity. Switch to All to review the full history.</p>
    </div>
  </div>
  {#if breakdownQuery.isError}<div class="sw-notice" role="alert">
      Finding totals could not be loaded. <button onclick={() => breakdownQuery.refetch()}
        >Try again</button
      >
    </div>{/if}
  <!-- Severity histogram -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
    {#each [{ label: 'OPEN', count: breakdown.total, tone: 'bg-foreground/70', emphasis: 'text-foreground' }, { label: 'CRITICAL', count: breakdown.critical, tone: 'bg-destructive', emphasis: 'text-destructive' }, { label: 'HIGH', count: breakdown.high, tone: 'bg-destructive/70', emphasis: 'text-destructive/80' }, { label: 'MEDIUM', count: breakdown.medium, tone: 'bg-warning', emphasis: 'text-warning' }, { label: 'LOW', count: breakdown.low, tone: 'bg-foreground/40', emphasis: 'text-muted-foreground' }] as bucket (bucket.label)}
      <div class="relative overflow-hidden rounded-xl border border-border bg-card px-5 py-4">
        <span class={`absolute left-0 top-0 h-full w-[3px] ${bucket.tone}`}></span>
        <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {bucket.label}
        </div>
        <div class={`font-mono text-2xl font-semibold tabular-nums ${bucket.emphasis}`}>
          {breakdownQuery.data ? bucket.count : '—'}
        </div>
      </div>
    {/each}
  </div>

  <SectionPanel title="Findings queue">
    {#snippet aside()}
      {site.openFindingCount} open findings
    {/snippet}
    <div class="sw-table">
      <DataTable
        {fetchData}
        {columns}
        enableRowSelection={false}
        {views}
        defaultPageSize={25}
        defaultSort={{ field: 'severity', dir: 'desc' }}
        onrowclick={(row) => goto(`/findings/${row.id}`)}
      />
    </div>
  </SectionPanel>
</div>
