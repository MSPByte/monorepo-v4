<script lang="ts">
  import { getContext } from 'svelte';
  import type { createTrpcClient } from '$lib/trpc';
  import { DataTable, type DataTableColumn, type PaginationInput, type TableView } from '$lib/components/data-table';
  import { AlertSeverity } from '@mspbyte/shared/types/alerts';
  import { cn } from '$lib/utils';
  import { alertEntityLabel, alertTitle, hydratedAlertMessage } from './display';

  function capitalize(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  import AlertSuppress from "$lib/components/alerts/alert-suppress.svelte";

  type ScopeColumn = 'link' | 'site';
  type AlertLinkOption = {
    id: string;
    name: string;
    siteId?: string | null;
    siteName?: string | null;
  };

  let { siteId, linkId, integrationId, links = [], scopeColumn = 'link' }: {
    siteId?: string;
    linkId?: string;
    integrationId?: string;
    links?: AlertLinkOption[];
    scopeColumn?: ScopeColumn;
  } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const normalizedLinkId = $derived(linkId || undefined);

  let suppressId = $state<string | null>(null);
  let suppressOpen = $state(false);
  let suppressAlertRow = $state<AlertRow | null>(null);

  function openSuppress(alert: AlertRow) {
    suppressId = alert.id;
    suppressAlertRow = alert;
    suppressOpen = true;
  }

  const linkMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const l of links) map.set(l.id, l.name);
    return map;
  });

  const linkSiteMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const l of links) {
      if (l.siteName) map.set(l.id, l.siteName);
    }
    return map;
  });

  const siteMap = $derived.by(() => {
    const map = new Map<string, string>();
    for (const l of links) {
      if (l.siteId && l.siteName) map.set(l.siteId, l.siteName);
    }
    return map;
  });

  const views: TableView[] = [
    { id: 'active',   label: 'Active',   filters: [{ field: 'status',   operator: 'eq', value: 'active'   }], isDefault: true },
    { id: 'critical', label: 'Critical', filters: [{ field: 'severity', operator: 'eq', value: '3'        }] },
    { id: 'high',     label: 'High',     filters: [{ field: 'severity', operator: 'eq', value: '2'        }] },
    { id: 'medium',   label: 'Medium',   filters: [{ field: 'severity', operator: 'eq', value: '1'        }] },
    { id: 'low',      label: 'Low',      filters: [{ field: 'severity', operator: 'eq', value: '0'        }] },
  ];

  function severityLabel(s: number) {
    const labels = ['Low', 'Medium', 'High', 'Critical'];
    return labels[s] ?? 'Unknown';
  }

  function severityClass(s: number) {
    if (s === AlertSeverity.Critical) return 'bg-destructive/15 text-destructive';
    if (s === AlertSeverity.High) return 'bg-destructive/10 text-destructive/80';
    if (s === AlertSeverity.Medium) return 'bg-warning/20 text-warning';
    return 'bg-muted text-muted-foreground';
  }

  function relativeTime(ts?: Date | string | null) {
    if (!ts) return '—';
    const diff = Date.now() - (ts instanceof Date ? ts.getTime() : new Date(ts).getTime());
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const validOperators = new Set(['eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte']);

  async function fetchData(input: PaginationInput) {
    return trpc.alerts.tableData.query({
      siteId,
      linkId: normalizedLinkId,
      integrationId,
      page: input.page,
      pageSize: input.pageSize,
      globalSearch: input.globalSearch || undefined,
      filters: input.filters
        .filter(f => validOperators.has(f.operator))
        .map(f => ({
          field: f.field,
          operator: f.operator as 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte',
          value: f.value != null ? String(f.value) : undefined,
        })),
      sortField: input.sortField,
      sortDir: input.sortDir,
    });
  }

  type AlertRow = Awaited<ReturnType<typeof fetchData>>['rows'][number];

  const columns: DataTableColumn<AlertRow>[] = $derived([
    { key: 'status',       title: 'Status',    sortable: true,  width: '80px',  cell: statusCell },
    { key: 'definitionId', title: 'Alert',     sortable: true,                  cell: definitionCell },
    { key: 'entityId',     title: 'Entity',                     width: '200px', cell: entityCell },
    ...(!normalizedLinkId
      ? [{ key: 'linkId', title: scopeColumn === 'site' ? 'Site' : 'Tenant', sortable: true, width: '180px', cell: scopeCell }]
      : []),
    { key: 'severity',     title: 'Severity',  sortable: true,  width: '110px', cell: severityCell },
    { key: 'lastSeenAt',   title: 'Last Seen', sortable: true,  width: '130px', cell: lastSeenCell },
    { key: 'id',           title: '',                           width: '120px', cell: actionsCell },
  ]);
</script>

{#snippet statusCell({ row }: { row: AlertRow; value: unknown })}
  <div class={cn(
    'flex justify-center py-0.5 rounded border w-24',
    row.status === 'active'
      ? 'bg-destructive/10 text-destructive border-destructive/30'
      : 'bg-warning/10 text-warning border-warning/30'
  )}>
    {capitalize(row.status)}
  </div>
{/snippet}

{#snippet definitionCell({ row }: { row: AlertRow; value: unknown })}
  <div class="flex flex-col gap-0.5">
    <span class="font-medium text-sm">{alertTitle(row)}</span>
    <span class="text-xs text-muted-foreground">{hydratedAlertMessage(row)}</span>
  </div>
{/snippet}

{#snippet entityCell({ row }: { row: AlertRow; value: unknown })}
  <span class="text-sm">{alertEntityLabel(row)}</span>
{/snippet}

{#snippet scopeCell({ row }: { row: AlertRow; value: unknown })}
  {@const label =
    scopeColumn === 'site'
      ? ((row.siteId ? siteMap.get(row.siteId) : undefined) ??
        (row.linkId ? linkSiteMap.get(row.linkId) : undefined))
      : (row.linkId ? (linkMap.get(row.linkId) ?? row.linkId) : undefined)}
  <span class="text-sm">{label ?? '—'}</span>
{/snippet}

{#snippet severityCell({ row }: { row: AlertRow; value: unknown })}
  <span class={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', severityClass(row.severity))}>
    {severityLabel(row.severity)}
  </span>
{/snippet}

{#snippet lastSeenCell({ row }: { row: AlertRow; value: unknown })}
  <span class="text-muted-foreground text-xs">{relativeTime(row.lastSeenAt)}</span>
{/snippet}

{#snippet actionsCell({ row }: { row: AlertRow; value: unknown })}
  <div class="relative flex justify-end z-50">
    <button
      onclick={(e) => { e.stopPropagation(); openSuppress(row); }}
      class="text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1 transition-colors"
    >
      Suppress
    </button>
  </div>
{/snippet}

{#key `${siteId ?? ''}-${normalizedLinkId ?? 'all'}-${scopeColumn}`}
  <DataTable
    {fetchData}
    {columns}
    {views}
    enableGlobalSearch
  />
{/key}

<AlertSuppress id={suppressId ?? ''} alert={suppressAlertRow ?? undefined} bind:open={suppressOpen} />
