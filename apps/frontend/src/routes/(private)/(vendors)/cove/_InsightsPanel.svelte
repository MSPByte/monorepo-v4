<script lang="ts">
  import { AlertSeverity } from '@mspbyte/shared';
  import AlertSuppress from '$lib/components/alerts/alert-suppress.svelte';
  import type { UiAlert } from '$lib/components/alerts/types';
  import { cn } from '$lib/utils';
  import {
    alertSearchText,
    alertTitle,
    hydratedAlertMessage,
  } from '$lib/components/alerts/display';
  import { ChevronRight, Search } from '@lucide/svelte';

  let {
    alerts,
    loading,
    onalertchange,
  }: {
    alerts: UiAlert[];
    loading: boolean;
    onalertchange?: () => void;
  } = $props();

  type FilterId = 'all' | 'errors' | 'stale';
  type EndpointInsight = {
    entityKey: string;
    alerts: UiAlert[];
    highestSeverity: number;
  };

  let activeFilter = $state<FilterId>('all');
  let searchQuery = $state('');
  let suppressAlert = $state<UiAlert | null>(null);
  let suppressOpen = $state(false);
  let expandedEntities = $state<Set<string>>(new Set());

  const filterOptions: { id: FilterId; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'errors', label: 'Errors' },
    { id: 'stale', label: 'Stale backup' },
  ];

  function alertFilter(alert: UiAlert): FilterId {
    if (alert.definitionId === 'cove.endpoint.errors') return 'errors';
    if (alert.definitionId === 'cove.endpoint.lastSuccessStale') return 'stale';
    return 'all';
  }

  function entityKey(alert: UiAlert) {
    const metadata = alert.metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const endpointName = (metadata as Record<string, unknown>)['endpointName'];
      const hostname = (metadata as Record<string, unknown>)['hostname'];
      if (typeof endpointName === 'string' && endpointName.trim()) return endpointName;
      if (typeof hostname === 'string' && hostname.trim()) return hostname;
    }
    return alert.entityRef ?? alert.entityId ?? 'Unknown endpoint';
  }

  const filteredAlerts = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    return alerts.filter((alert) => {
      if (activeFilter !== 'all' && alertFilter(alert) !== activeFilter) return false;
      if (!query) return true;
      return alertSearchText(alert).includes(query);
    });
  });

  const entities = $derived.by(() => {
    const grouped = new Map<string, EndpointInsight>();
    for (const alert of filteredAlerts) {
      const key = entityKey(alert);
      const existing = grouped.get(key);
      if (existing) {
        existing.alerts.push(alert);
        existing.highestSeverity = Math.max(existing.highestSeverity, alert.severity);
      } else {
        grouped.set(key, {
          entityKey: key,
          alerts: [alert],
          highestSeverity: alert.severity,
        });
      }
    }
    return [...grouped.values()]
      .map((entity) => ({
        ...entity,
        alerts: entity.alerts.sort((a, b) => b.severity - a.severity),
      }))
      .sort((a, b) => b.highestSeverity - a.highestSeverity || b.alerts.length - a.alerts.length);
  });

  const filterCounts = $derived.by(() => {
    const counts = new Map<FilterId, number>([
      ['all', alerts.length],
      ['errors', 0],
      ['stale', 0],
    ]);
    for (const alert of alerts) {
      const filter = alertFilter(alert);
      if (filter !== 'all') counts.set(filter, (counts.get(filter) ?? 0) + 1);
    }
    return counts;
  });

  function severityDot(severity: number) {
    if (severity === AlertSeverity.Critical) return 'bg-destructive';
    if (severity === AlertSeverity.High) return 'bg-destructive/80';
    if (severity === AlertSeverity.Medium) return 'bg-warning';
    return 'bg-muted-foreground/40';
  }

  function severityBadge(severity: number) {
    if (severity === AlertSeverity.Critical) return 'bg-destructive/15 text-destructive';
    if (severity === AlertSeverity.High) return 'bg-destructive/10 text-destructive/80';
    if (severity === AlertSeverity.Medium) return 'bg-warning/15 text-warning';
    return 'bg-muted text-muted-foreground';
  }

  function severityLabel(severity: number) {
    if (severity === AlertSeverity.Critical) return 'Critical';
    if (severity === AlertSeverity.High) return 'High';
    if (severity === AlertSeverity.Medium) return 'Medium';
    return 'Low';
  }

  function relativeTime(ts?: Date | string | null) {
    if (!ts) return '—';
    const time = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    if (Number.isNaN(time)) return '—';
    const diff = Date.now() - time;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  function isExpanded(key: string) {
    return expandedEntities.has(key);
  }

  function toggleEntity(key: string) {
    const next = new Set(expandedEntities);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedEntities = next;
  }

  function openSuppress(alert: UiAlert) {
    suppressAlert = alert;
    suppressOpen = true;
  }
</script>

<div class="flex flex-col size-full overflow-hidden border-t">
  <div class="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
    <div class="flex items-center gap-2">
      <h2 class="font-semibold text-sm">Insights</h2>
      {#if !loading}
        <span class="text-xs text-muted-foreground tabular-nums">{alerts.length} active</span>
      {/if}
    </div>
    {#if !loading}
      <a href="/cove/alerts" class="text-xs text-muted-foreground hover:text-foreground transition-colors">
        View all alerts &rarr;
      </a>
    {/if}
  </div>

  {#if !loading && alerts.length > 0}
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b shrink-0">
      <div class="flex items-center gap-1">
        {#each filterOptions as filter}
          {@const count = filterCounts.get(filter.id) ?? 0}
          {#if filter.id === 'all' || count > 0}
            <button
              type="button"
              onclick={() => (activeFilter = filter.id)}
              class={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                activeFilter === filter.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              {filter.label}
              <span class="tabular-nums opacity-60">{count}</span>
            </button>
          {/if}
        {/each}
      </div>
      <div class="relative ml-auto w-72 max-w-full">
        <Search class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search insights"
          bind:value={searchQuery}
          class="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <div class="flex flex-col gap-2 p-3">
        {#each Array(4) as _}
          <div class="h-12 rounded-lg bg-muted animate-pulse"></div>
        {/each}
      </div>
    {:else if entities.length === 0}
      <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {searchQuery.trim() ? 'No insights match your search' : 'No active insights'}
      </div>
    {:else}
      <table class="w-full table-fixed text-sm">
        <thead class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
          <tr class="text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <th class="w-[32%] px-4 py-2">Endpoint</th>
            <th class="px-3 py-2">Summary</th>
            <th class="w-24 px-3 py-2">Severity</th>
            <th class="w-20 px-3 py-2 text-right">Seen</th>
            <th class="w-24 px-4 py-2 text-right"></th>
          </tr>
        </thead>
        <tbody>
          {#each entities as entity (entity.entityKey)}
            {@const expanded = isExpanded(entity.entityKey)}
            {@const primaryAlert = entity.alerts[0]}
            <tr class="group border-b hover:bg-accent/30">
              <td class="px-4 py-2 align-top">
                <button
                  type="button"
                  onclick={() => toggleEntity(entity.entityKey)}
                  class="flex w-full min-w-0 items-start gap-2 text-left"
                  aria-expanded={expanded}
                >
                  <ChevronRight
                    class={cn(
                      'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                      expanded && 'rotate-90',
                    )}
                  />
                  <span class={cn('mt-1 size-2 rounded-full shrink-0', severityDot(entity.highestSeverity))}></span>
                  <span class="min-w-0">
                    <span class="block truncate font-medium">{entity.entityKey}</span>
                    <span class="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                      {entity.alerts.length} {entity.alerts.length === 1 ? 'issue' : 'issues'}
                    </span>
                  </span>
                </button>
              </td>
              <td class="px-3 py-2 align-top">
                <button
                  type="button"
                  onclick={() => toggleEntity(entity.entityKey)}
                  class="block w-full text-left"
                >
                  <div class="truncate font-medium">
                    {entity.alerts.length === 1
                      ? alertTitle(primaryAlert)
                      : `${entity.alerts.length} active alerts`}
                  </div>
                  <div class="truncate text-xs text-muted-foreground">
                    {entity.alerts.length === 1
                      ? hydratedAlertMessage(primaryAlert)
                      : entity.alerts.map((alert) => alertTitle(alert)).join(', ')}
                  </div>
                </button>
              </td>
              <td class="px-3 py-2 align-top">
                <span
                  class={cn(
                    'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium',
                    severityBadge(entity.highestSeverity),
                  )}
                >
                  {severityLabel(entity.highestSeverity)}
                </span>
              </td>
              <td class="px-3 py-2 text-right align-top text-xs text-muted-foreground tabular-nums">
                {relativeTime(primaryAlert.lastSeenAt)}
              </td>
              <td class="px-4 py-2 text-right align-top">
                {#if entity.alerts.length === 1}
                  <button
                    type="button"
                    onclick={() => openSuppress(primaryAlert)}
                    class="text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 transition-colors"
                  >
                    Suppress
                  </button>
                {/if}
              </td>
            </tr>
            {#if expanded}
              <tr class="border-b bg-muted/20">
                <td colspan="5" class="px-12 py-2">
                  <div class="flex flex-col gap-2">
                    {#each entity.alerts as alert (alert.id)}
                      <div class="flex items-start justify-between gap-3 rounded border bg-background px-3 py-2">
                        <div class="min-w-0">
                          <div class="text-sm font-medium">{alertTitle(alert)}</div>
                          <div class="text-xs text-muted-foreground">{hydratedAlertMessage(alert)}</div>
                        </div>
                        <button
                          type="button"
                          onclick={() => openSuppress(alert)}
                          class="shrink-0 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 transition-colors"
                        >
                          Suppress
                        </button>
                      </div>
                    {/each}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

{#if suppressAlert}
  <AlertSuppress
    id={suppressAlert.id}
    alert={suppressAlert}
    bind:open={suppressOpen}
    onsuppress={onalertchange}
  />
{/if}
