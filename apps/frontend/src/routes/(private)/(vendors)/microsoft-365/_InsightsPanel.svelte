<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { AlertSeverity } from '@mspbyte/shared';
  import AlertSuppress from '$lib/components/alerts/alert-suppress.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import type { UiAlert } from '$lib/components/alerts/types';
  import {
    definitionExcludePrefixesForModule,
    definitionPrefixesForModule,
    moduleForAlert,
    moduleForDefinitionId,
    type M365AlertModuleId,
  } from './_alert-modules';
  import {
    alertMetadataEntries,
    alertTitle,
    formatAlertValue,
    hydratedAlertMessage,
    metadataLabel,
  } from '$lib/components/alerts/display';
  import { ChevronRight, Search } from '@lucide/svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  let {
    linkId,
    onalertchange,
  }: {
    linkId: string | null;
    onalertchange?: () => void;
  } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const GROUP_PAGE_SIZE = 100;

  let activeFilter = $state<M365AlertModuleId | 'all'>('all');
  let searchQuery = $state('');
  let groupPage = $state(0);
  let groups = $state<InsightGroup[]>([]);
  let totalGroups = $state(0);
  let suppressId = $state<string | null>(null);
  let suppressAlert = $state<UiAlert | null>(null);
  let suppressOpen = $state(false);
  let expandedEntities = $state<Set<string>>(new Set());
  let groupAlerts = $state(new Map<string, { rows: UiAlert[]; total: number; loading: boolean }>());

  const FILTER_OPTIONS: { id: M365AlertModuleId | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'identities', label: 'Identities' },
    { id: 'licenses', label: 'Licenses' },
    { id: 'exchange', label: 'Exchange' },
    { id: 'other', label: 'Other' },
  ];

  const groupsQuery = createQuery(() => ({
    queryKey: [
      'alerts.insightGroups',
      'microsoft-365',
      linkId,
      'active',
      activeFilter,
      searchQuery.trim(),
      groupPage,
    ],
    queryFn: () =>
      trpc.alerts.insightGroups.query({
        linkId: linkId!,
        status: 'active',
        definitionPrefixes: definitionPrefixesForModule(activeFilter),
        definitionExcludePrefixes: definitionExcludePrefixesForModule(activeFilter),
        search: searchQuery.trim() || undefined,
        page: groupPage,
        pageSize: GROUP_PAGE_SIZE,
      }),
    enabled: !!linkId,
  }));

  const countsQuery = createQuery(() => ({
    queryKey: ['alerts.insightGroupCounts', 'microsoft-365', linkId, 'active', searchQuery.trim()],
    queryFn: () =>
      trpc.alerts.insightGroupCounts.query({
        linkId: linkId!,
        status: 'active',
        search: searchQuery.trim() || undefined,
        buckets: FILTER_OPTIONS.map((filter) => ({
          id: filter.id,
          definitionPrefixes: definitionPrefixesForModule(filter.id),
          definitionExcludePrefixes: definitionExcludePrefixesForModule(filter.id),
        })),
      }),
    enabled: !!linkId,
  }));

  type InsightGroup = NonNullable<typeof groupsQuery.data>['rows'][number];

  const loading = $derived(groupsQuery.isPending && groups.length === 0);
  const counts = $derived.by(() => {
    const map = new Map<string, number>();
    for (const row of countsQuery.data ?? []) map.set(row.id, row.total);
    return map;
  });
  const totalActive = $derived(counts.get('all') ?? totalGroups);
  const showFilters = $derived(totalActive > 0 || activeFilter !== 'all' || !!searchQuery.trim());

  $effect(() => {
    const data = groupsQuery.data;
    if (!data) return;
    totalGroups = data.total;
    groups = untrack(() =>
      data.page === 0
        ? data.rows
        : [
            ...groups.filter(
              (group) => !data.rows.some((row) => row.entityKey === group.entityKey)
            ),
            ...data.rows,
          ]
    );
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

  function openSuppress(alert: UiAlert) {
    suppressId = alert.id;
    suppressAlert = alert;
    suppressOpen = true;
  }

  function isExpanded(entityKey: string) {
    return expandedEntities.has(entityKey);
  }

  function toggleEntity(entityKey: string) {
    const next = new Set(expandedEntities);
    if (next.has(entityKey)) {
      next.delete(entityKey);
    } else {
      next.add(entityKey);
      void loadGroupAlerts(entityKey);
    }
    expandedEntities = next;
  }

  async function loadGroupAlerts(entityKey: string) {
    if (!linkId) return;
    const existing = groupAlerts.get(entityKey);
    if (existing?.loading || existing?.rows.length) return;

    groupAlerts = new Map(groupAlerts).set(entityKey, { rows: [], total: 0, loading: true });
    const result = await trpc.alerts.insightGroupAlerts.query({
      linkId,
      status: 'active',
      definitionPrefixes: definitionPrefixesForModule(activeFilter),
      definitionExcludePrefixes: definitionExcludePrefixesForModule(activeFilter),
      entityKey,
      page: 0,
      pageSize: 100,
    });
    groupAlerts = new Map(groupAlerts).set(entityKey, {
      rows: result.rows as UiAlert[],
      total: result.total,
      loading: false,
    });
  }

  function resetPaging() {
    groupPage = 0;
    groups = [];
    totalGroups = 0;
    expandedEntities = new Set();
    groupAlerts = new Map();
  }
</script>

<div class="flex flex-col size-full overflow-hidden">
  <div class="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
    <div class="flex items-center gap-2">
      <h2 class="font-semibold text-sm">Insights</h2>
      {#if !loading}
        <span class="text-xs text-muted-foreground tabular-nums">{totalActive} entities</span>
      {/if}
    </div>
    {#if !loading}
      <a
        href="/microsoft-365/alerts"
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        View all alerts &rarr;
      </a>
    {/if}
  </div>

  {#if !loading && showFilters}
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b shrink-0">
      <div class="flex items-center gap-1">
        {#each FILTER_OPTIONS as filter}
          {@const count = counts.get(filter.id) ?? 0}
          {#if filter.id === 'all' || count > 0 || activeFilter === filter.id || !searchQuery.trim()}
            <button
              type="button"
              onclick={() => {
                activeFilter = filter.id;
                resetPaging();
              }}
              class={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                activeFilter === filter.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
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
          value={searchQuery}
          oninput={(event) => {
            searchQuery = event.currentTarget.value;
            resetPaging();
          }}
          class="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <Loader />
    {:else if groups.length === 0}
      <FadeIn class="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {searchQuery.trim() ? 'No insights match your search' : 'No active insights'}
      </FadeIn>
    {:else}
      <FadeIn class="flex-1">
        <table class="w-full table-fixed text-sm">
          <thead class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
            <tr
              class="text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              <th class="w-[32%] px-4 py-2">Entity</th>
              <th class="px-3 py-2">Summary</th>
              <th class="w-24 px-3 py-2">Severity</th>
              <th class="w-20 px-3 py-2 text-right">Seen</th>
              <th class="w-24 px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {#each groups as entity (entity.entityKey)}
              {@const expanded = isExpanded(entity.entityKey)}
              {@const primaryAlert = {
                id: entity.primaryAlertId,
                definitionId: entity.primaryDefinitionId,
                entityRef: entity.entityKey,
                entityId: entity.entityKey,
                entityType: null,
                message: entity.primaryMessage,
                metadata: entity.primaryMetadata,
                severity: entity.highestSeverity,
                status: 'active',
                linkId,
                siteId: null,
                firstSeen: entity.lastSeenAt,
                lastSeenAt: entity.lastSeenAt,
                resolvedAt: null,
                suppressedAt: null,
                suppressedUntil: null,
                suppressionNote: null,
                suppressedBy: null,
                updatedAt: entity.lastSeenAt,
              } as UiAlert}
              {@const modules = [
                ...new Set(
                  entity.moduleIds.map((definitionId) => moduleForDefinitionId(definitionId).label)
                ),
              ]}
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
                        expanded && 'rotate-90'
                      )}
                    />
                    <span
                      class={cn(
                        'mt-1 size-2 rounded-full shrink-0',
                        severityDot(entity.highestSeverity)
                      )}
                    ></span>
                    <span class="min-w-0">
                      <span class="block truncate font-medium">{entity.entityKey}</span>
                      <span class="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                        {entity.alertCount}
                        {entity.alertCount === 1 ? 'issue' : 'issues'}
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
                      {entity.alertCount === 1
                        ? alertTitle(primaryAlert)
                        : `${entity.alertCount} active alerts`}
                    </div>
                    <div class="truncate text-xs text-muted-foreground">
                      {entity.alertCount === 1
                        ? hydratedAlertMessage(primaryAlert)
                        : modules.join(', ')}
                    </div>
                  </button>
                </td>
                <td class="px-3 py-2 align-top">
                  <span
                    class={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium',
                      severityBadge(entity.highestSeverity)
                    )}
                  >
                    {severityLabel(entity.highestSeverity)}
                  </span>
                </td>
                <td
                  class="px-3 py-2 text-right align-top text-xs text-muted-foreground tabular-nums"
                >
                  {relativeTime(primaryAlert.lastSeenAt)}
                </td>
                <td class="px-4 py-2 text-right align-top">
                  {#if entity.alertCount === 1}
                    <button
                      type="button"
                      onclick={async () => {
                        await loadGroupAlerts(entity.entityKey);
                        const loaded = groupAlerts.get(entity.entityKey)?.rows[0];
                        if (loaded) openSuppress(loaded);
                      }}
                      class="text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 transition-colors"
                    >
                      Suppress
                    </button>
                  {:else}
                    <button
                      type="button"
                      onclick={() => toggleEntity(entity.entityKey)}
                      class="text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 transition-colors"
                    >
                      {expanded ? 'Hide' : 'Expand'}
                    </button>
                  {/if}
                </td>
              </tr>
              {#if expanded}
                {@const details = groupAlerts.get(entity.entityKey)}
                <tr class="border-b bg-muted/10">
                  <td colspan="5" class="px-4 py-2">
                    <div class="ml-6 overflow-hidden rounded-md border bg-background">
                      {#if details?.loading}
                        <div class="px-3 py-3 text-xs text-muted-foreground">Loading alerts...</div>
                      {:else if !details || details.rows.length === 0}
                        <div class="px-3 py-3 text-xs text-muted-foreground">No alerts loaded.</div>
                      {:else}
                        {#each details.rows as alert, alertIndex (alert.id)}
                          {@const module = moduleForAlert(alert)}
                          {@const detailEntries = alertMetadataEntries(alert).slice(0, 4)}
                          <div
                            class={cn(
                              'grid gap-2 px-3 py-2 text-xs md:grid-cols-[minmax(11rem,16rem)_1fr_auto]',
                              alertIndex < details.rows.length - 1 && 'border-b'
                            )}
                          >
                            <div class="min-w-0">
                              <div class="flex items-center gap-1.5">
                                <span
                                  class={cn(
                                    'size-1.5 rounded-full shrink-0',
                                    severityDot(alert.severity)
                                  )}
                                ></span>
                                <span class="truncate font-medium text-sm">{alertTitle(alert)}</span
                                >
                              </div>
                              <div
                                class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                              >
                                <span>{module.label}</span>
                                <span aria-hidden="true">/</span>
                                <span>{severityLabel(alert.severity)}</span>
                              </div>
                            </div>

                            <div class="min-w-0">
                              <div class="wrap-break-word text-sm leading-snug">
                                {hydratedAlertMessage(alert)}
                              </div>
                              {#if detailEntries.length > 0}
                                <div
                                  class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
                                >
                                  {#each detailEntries as [key, value]}
                                    <span class="min-w-0">
                                      <span>{metadataLabel(key)}:</span>
                                      <span class="font-medium text-foreground/80">
                                        {formatAlertValue(value)}
                                      </span>
                                    </span>
                                  {/each}
                                </div>
                              {/if}
                            </div>

                            <div class="flex items-start justify-end">
                              <button
                                type="button"
                                onclick={() => openSuppress(alert)}
                                class="shrink-0 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-0.5 transition-colors"
                              >
                                Suppress
                              </button>
                            </div>
                          </div>
                        {/each}
                        {#if details.total > details.rows.length}
                          <div class="border-t px-3 py-2 text-xs text-muted-foreground">
                            Showing {details.rows.length} of {details.total} alerts. Use the full alerts
                            table for the complete list.
                          </div>
                        {/if}
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </FadeIn>
      {#if groups.length < totalGroups}
        <div class="flex justify-center border-t p-3">
          <button
            type="button"
            onclick={() => (groupPage += 1)}
            class="rounded border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Load more
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<AlertSuppress
  id={suppressId ?? ''}
  alert={suppressAlert ?? undefined}
  bind:open={suppressOpen}
  onsuppress={onalertchange}
/>
