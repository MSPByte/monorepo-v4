<script lang="ts">
  import './workspace.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { ShieldCheck, ArrowUpRight, RefreshCw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { STALE } from '$lib/query';
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
  import { toServerTableInput } from '$lib/components/domain/server-table';

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
    firstSeenAt: string;
  };

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const canManage = $derived(authStore.isAllowed('Assets.Write'));
  function findingHref(id: string) {
    return `/findings/${id}?returnTo=${encodeURIComponent(typeof window === 'undefined' ? page.url.pathname + page.url.search : window.location.pathname + window.location.search)}`;
  }
  let refreshKey = $state(0);

  const overview = createQuery(() => ({
    queryKey: ['findings.overview'],
    queryFn: () => trpc.findings.overview.query(),
    staleTime: STALE.PAGE,
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
          { label: 'Acknowledged', value: 'acknowledged' },
          { label: 'Regressed', value: 'regressed' },
          { label: 'Suppressed', value: 'suppressed' },
          { label: 'Resolved', value: 'resolved' },
        ],
      },
    },
    { ...textColumn<FindingRow>('title', 'Finding'), cellComponent: undefined, cell: findingCell, width: '340px' },
    { ...textColumn<FindingRow>('policyName', 'Policy'), defaultHidden: true },
    textColumn<FindingRow>('siteName', 'Site'),
    { ...textColumn<FindingRow>('linkName', 'Integration'), defaultHidden: true },
    textColumn<FindingRow>('resourceName', 'Affected Resource'),
    relativeDateColumn<FindingRow>('lastSeenAt', 'Last seen'),
    { ...relativeDateColumn<FindingRow>('firstSeenAt', 'First seen'), defaultHidden: true },
  ];

  const views: TableView<FindingRow>[] = [
    {
      id: 'open-findings',
      label: 'Needs attention',
      isDefault: true,
      filters: [
        { field: 'status', operator: 'neq', value: 'resolved' },
        { field: 'status', operator: 'neq', value: 'suppressed' },
      ],
    },
    {
      id: 'regressed',
      label: 'Regressed',
      filters: [{ field: 'status', operator: 'eq', value: 'regressed' }],
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
    let succeeded = 0;
    for (const row of eligible) {
      ctx.setProgress(`Resolving ${++done} of ${eligible.length}…`);
      try {
        await trpc.findings.resolve.mutate({ id: row.id });
        succeeded += 1;
      } catch (e) {
        toast.error(
          `Failed to resolve "${row.title}": ${e instanceof Error ? e.message : 'unknown error'}`,
        );
      }
    }
    invalidate();
    await refetch();
    ctx.setProgress(null);
    if (succeeded > 0) toast.success(`Resolved ${succeeded} finding${succeeded === 1 ? '' : 's'}`);
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

</script>

{#snippet findingCell({ row }: { row: FindingRow; value: unknown })}
  <div class="fq-finding-cell">
    <a href={findingHref(row.id)} onclick={(event) => event.stopPropagation()}>{row.title}<ArrowUpRight class="size-3.5 shrink-0" /></a>
    <span>{row.policyName}</span>
  </div>
{/snippet}

{#snippet statusCell({ value }: { row: FindingRow; value: string })}
  <FindingStatusBadge status={value} />
{/snippet}

{#snippet strip(api: SignalStripApi)}
  <nav class="fq-views" aria-label="Finding queues">
    {#each views as view}
      <button type="button" class:active={api.activeViewId === view.id} aria-pressed={api.activeViewId === view.id} onclick={() => api.setView(view.id)}>
        {view.label}
        {#if overview.data}<span>{view.id === 'open-findings' ? overview.data.totalOpen : overview.data.byStatus[view.id as 'regressed' | 'suppressed' | 'resolved']}</span>{/if}
      </button>
    {/each}
    <button type="button" class:active={!api.activeViewId} aria-pressed={!api.activeViewId} onclick={() => api.setView(undefined)}>All findings</button>
  </nav>
{/snippet}

<div class="findings-workspace fq-queue">
  <header class="fq-heading">
    <div class="flex items-start gap-4">
      <span class="fq-icon"><ShieldCheck class="size-5" /></span>
      <div><p class="fq-eyebrow">Operations / Findings</p><h1>Findings</h1><p>Review policy failures, investigate the evidence, and decide what needs attention.</p></div>
    </div>
    <Button variant="outline" size="sm" onclick={() => { refreshKey += 1; invalidate(); }}><RefreshCw class="size-3.5" /> Refresh</Button>
  </header>

  {#if overview.isError}
    <div class="fq-notice" role="alert">The queue summary could not be loaded. <button onclick={() => overview.refetch()}>Try again</button></div>
  {:else}
    <div class="fq-overview" aria-label="Active findings overview" aria-busy={overview.isPending}>
      <div><span>Needs attention</span><strong>{overview.data?.totalOpen.toLocaleString() ?? '—'}</strong><small>Open, acknowledged, and regressed</small></div>
      <div><span>High priority</span><strong class:fq-urgent={overview.data && overview.data.severity.critical + overview.data.severity.high > 0}>{overview.data ? (overview.data.severity.critical + overview.data.severity.high).toLocaleString() : '—'}</strong><small>Critical and high severity</small></div>
      <div><span>Open over 30 days</span><strong>{overview.data?.agedOver30d.toLocaleString() ?? '—'}</strong><small>Age measured from first detection</small></div>
      <div class="fq-guidance"><ShieldCheck class="size-5 shrink-0" /><p>Start with the highest severity.<br /><span>Regressed findings have returned after resolution and need another review.</span></p></div>
    </div>
  {/if}

  <div class="fq-table">
    <DataTable {fetchData} {columns} {views} rowActions={canManage ? rowActions : []} {refreshKey}
      enableRowSelection={canManage} enableViewSelector={false} defaultPageSize={25}
      defaultSort={{ field: 'severity', dir: 'desc' }} onrowclick={(row) => goto(findingHref(row.id))} signalStrip={strip} />
  </div>
</div>
