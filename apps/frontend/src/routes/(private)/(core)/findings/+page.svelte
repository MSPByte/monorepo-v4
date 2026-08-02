<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
    type RowAction,
    type SignalStripApi,
    type TableView,
  } from '$lib/components/data-table';
  import {
    relativeDateColumn,
    stateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import FindingSheet from '$lib/components/domain/finding-sheet.svelte';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import SignalStrip from '$lib/components/panel/signal-strip.svelte';
  import SignalCell from '$lib/components/panel/signal-cell.svelte';
  import SeverityRibbon from '$lib/components/panel/severity-ribbon.svelte';

  import CircleCheckBig from '@lucide/svelte/icons/circle-check-big';

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
  const qc = useQueryClient();

  let selectedFindingId = $state<string | null>(null);
  let refreshKey = $state(0);

  const overview = createQuery(() => ({
    queryKey: ['findings.overview'],
    queryFn: () => trpc.findings.overview.query(),
    staleTime: 60_000,
  }));

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
      },
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
          { label: 'Regressed', value: 'regressed' },
          { label: 'Suppressed', value: 'suppressed' },
          { label: 'Resolved', value: 'resolved' },
        ],
      },
    },
    textColumn<FindingRow>('policyName', 'Policy'),
    textColumn<FindingRow>('title', 'Title', undefined, undefined, { width: '260px' }),
    textColumn<FindingRow>('siteName', 'Site'),
    textColumn<FindingRow>('linkName', 'Link'),
    textColumn<FindingRow>('resourceName', 'Affected Resource'),
    relativeDateColumn<FindingRow>('lastSeenAt', 'Last Seen'),
  ];

  const views: TableView<FindingRow>[] = [
    {
      id: 'open-findings',
      label: 'Open',
      isDefault: true,
      filters: [{ field: 'status', operator: 'eq', value: 'open' }],
    },
    {
      id: 'suppressed',
      label: 'Suppressed',
      filters: [{ field: 'status', operator: 'eq', value: 'suppressed' }],
    },
    {
      id: 'resolved',
      label: 'Resolved',
      filters: [{ field: 'status', operator: 'eq', value: 'resolved' }],
    },
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
      ]),
    );
    return { rows: result.rows as FindingRow[], total: result.total };
  }

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['findings.overview'] });
  }

  async function bulkResolve(
    rows: FindingRow[],
    refetch: () => Promise<void>,
    ctx: { setProgress: (m: string | null) => void },
  ) {
    const eligible = rows.filter((r) => r.status !== 'suppressed' && r.status !== 'resolved');
    if (eligible.length === 0) {
      toast.info('No eligible findings selected to resolve');
      return;
    }
    let done = 0;
    for (const row of eligible) {
      ctx.setProgress(`Resolving ${++done} of ${eligible.length}…`);
      try {
        await trpc.findings.resolve.mutate({ id: row.id });
      } catch (e) {
        toast.error(
          `Failed to resolve "${row.title}": ${e instanceof Error ? e.message : 'unknown error'}`,
        );
      }
    }
    invalidate();
    await refetch();
    toast.success(`Resolved ${done} finding${done === 1 ? '' : 's'}`);
  }

  const rowActions: RowAction<FindingRow>[] = [
    {
      label: 'Resolve',
      icon: CircleCheckBig,
      variant: 'default',
      onclick: bulkResolve,
      disabled: (rows) => !rows.some((r) => r.status !== 'suppressed' && r.status !== 'resolved'),
    },
  ];

  const openTotal = $derived.by(() => {
    const s = overview.data?.severity;
    return s ? s.critical + s.high + s.medium + s.low : 0;
  });

  // Deferred count = findings actively hidden until a future date. That's the
  // one lifecycle signal worth tracking at the queue level.
  const suppressedCount = $derived(overview.data?.byStatus.suppressed ?? 0);
  const resolvedCount = $derived(overview.data?.byStatus.resolved ?? 0);
  const regressedCount = $derived(overview.data?.byStatus.regressed ?? 0);
</script>

{#snippet statusCell({ value }: { row: FindingRow; value: string })}
  <FindingStatusBadge status={value} />
{/snippet}

{#snippet strip(api: SignalStripApi)}
  <SignalStrip
    code="01"
    title="Queue Signal"
    meta={overview.data ? `${overview.data.totalOpen.toLocaleString()} open` : 'loading'}
  >
    <SignalCell
      code="S"
      label="Severity"
      onclick={() => api.setSort('severity', 'desc')}
    >
      {#if overview.data}
        <div class="mt-0.5 flex items-baseline gap-2">
          <span class="font-mono text-xl font-semibold tabular-nums text-foreground">
            {openTotal.toLocaleString()}
          </span>
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {overview.data.severity.critical + overview.data.severity.high} elevated
          </span>
        </div>
        <div class="pt-1">
          <SeverityRibbon buckets={overview.data.severity} />
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
    <SignalCell code="L" label="Lifecycle">
      {#if overview.data}
        <div class="mt-0.5 flex items-baseline gap-2">
          <span class="font-mono text-xl font-semibold tabular-nums text-foreground">
            {suppressedCount.toLocaleString()}
          </span>
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            suppressed
          </span>
        </div>
        <div class="flex flex-wrap gap-x-3 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <button
            type="button"
            class="hover:text-foreground"
            onclick={(e) => {
              e.stopPropagation();
              api.addFilter({ field: 'status', operator: 'eq', value: 'suppressed' });
            }}
          >
            deferred <span class="tabular-nums text-foreground">{suppressedCount}</span>
          </button>
          <button
            type="button"
            class="hover:text-foreground"
            onclick={(e) => {
              e.stopPropagation();
              api.addFilter({ field: 'status', operator: 'eq', value: 'resolved' });
            }}
          >
            closed <span class="tabular-nums text-foreground">{resolvedCount}</span>
          </button>
          {#if regressedCount > 0}
            <button
              type="button"
              class="text-destructive hover:text-destructive"
              onclick={(e) => {
                e.stopPropagation();
                api.addFilter({ field: 'status', operator: 'eq', value: 'regressed' });
              }}
            >
              regressed <span class="tabular-nums">{regressedCount}</span>
            </button>
          {/if}
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
    <SignalCell
      code="A"
      label="Aged > 30d"
      value={overview.data ? overview.data.agedOver30d.toLocaleString() : '—'}
      detail={overview.data && overview.data.agedOver30d > 0 ? 'still open · needs closure' : 'queue is fresh'}
      tone={overview.data && overview.data.agedOver30d > 0 ? 'warning' : 'muted'}
      onclick={() => api.setSort('lastSeenAt', 'asc')}
    />
    <SignalCell
      code="P"
      label="Top Policy"
    >
      {#if overview.data?.topPolicy}
        {@const tp = overview.data.topPolicy}
        <div class="mt-0.5 truncate font-mono text-sm font-semibold text-foreground" title={tp.policyName}>
          {tp.policyName}
        </div>
        <div class="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {tp.count} open · filter →
        </div>
        <button
          type="button"
          class="absolute inset-0"
          aria-label={`Filter to ${tp.policyName}`}
          onclick={(e) => {
            e.stopPropagation();
            api.addFilter({ field: 'policyName', operator: 'eq', value: tp.policyName });
          }}
        ></button>
      {:else if overview.data}
        <div class="mt-0.5 font-mono text-sm text-muted-foreground">—</div>
        <div class="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          no open policy work
        </div>
      {:else}
        <div class="h-8"></div>
      {/if}
    </SignalCell>
  </SignalStrip>
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
    {views}
    {rowActions}
    {refreshKey}
    enableRowSelection
    defaultPageSize={25}
    defaultSort={{ field: 'severity', dir: 'desc' }}
    onrowclick={(row) => (selectedFindingId = row.id)}
    signalStrip={strip}
  />
</div>

<FindingSheet
  findingId={selectedFindingId}
  onclose={() => (selectedFindingId = null)}
  onchange={() => {
    refreshKey += 1;
    invalidate();
  }}
/>
