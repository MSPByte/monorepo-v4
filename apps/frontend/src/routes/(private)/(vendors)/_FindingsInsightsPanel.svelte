<script lang="ts" module>
  export type FindingsInsightsFilter = {
    id: string;
    label: string;
    match: (finding: FindingRow) => boolean;
  };

  type FindingRow = {
    id: string;
    title: string;
    severity: number;
    status: string;
    siteId: string | null;
    siteName: string;
    linkId: string | null;
    linkName: string;
    resourceType: string;
    resourceTable: string | null;
    resourceId: string;
    resourceName: string;
    policyId: string;
    policyName: string;
    evidenceSummary: string;
    recommendation: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  };
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { cn } from '$lib/utils';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingSheet from '$lib/components/domain/finding-sheet.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import { formatRelativeDate } from '$lib/utils/format';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Search from '@lucide/svelte/icons/search';

  let {
    linkId,
    findingsHref,
    filters = [],
    entityHeading = 'Resource',
    moduleLabelForFinding,
  }: {
    linkId: string | null;
    findingsHref: string;
    filters?: FindingsInsightsFilter[];
    entityHeading?: string;
    moduleLabelForFinding?: (finding: FindingRow) => string;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  let activeFilter = $state<string>('all');
  let searchQuery = $state('');
  let expandedEntities = $state<Set<string>>(new Set());
  let selectedFindingId = $state<string | null>(null);

  type EntityGroup = {
    entityKey: string;
    entityLabel: string;
    findings: FindingRow[];
    maxSeverity: number;
    lastSeenAt: string;
  };

  const findingsQuery = createQuery(() => ({
    queryKey: ['vendor.linkFindings', linkId],
    queryFn: () => trpc.vendor.linkFindings.query({ linkId: linkId! }),
    enabled: !!linkId,
  }));

  const loading = $derived(findingsQuery.isPending);
  const allFindings = $derived((findingsQuery.data ?? []) as FindingRow[]);

  const filterCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    counts.set('all', allFindings.length);
    for (const filter of filters) {
      counts.set(filter.id, allFindings.filter((f) => filter.match(f)).length);
    }
    return counts;
  });

  const filteredFindings = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    let rows = allFindings;
    if (activeFilter !== 'all') {
      const filter = filters.find((f) => f.id === activeFilter);
      if (filter) rows = rows.filter((row) => filter.match(row));
    }
    if (!query) return rows;
    return rows.filter((row) =>
      [row.title, row.resourceName, row.policyName, row.evidenceSummary, row.recommendation ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  });

  const entityGroups = $derived.by<EntityGroup[]>(() => {
    const map = new Map<string, EntityGroup>();
    for (const finding of filteredFindings) {
      const key = `${finding.resourceType}:${finding.resourceId}`;
      const existing = map.get(key);
      if (existing) {
        existing.findings.push(finding);
        existing.maxSeverity = Math.max(existing.maxSeverity, finding.severity);
        if (finding.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = finding.lastSeenAt;
      } else {
        map.set(key, {
          entityKey: key,
          entityLabel: finding.resourceName,
          findings: [finding],
          maxSeverity: finding.severity,
          lastSeenAt: finding.lastSeenAt,
        });
      }
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        findings: group.findings.sort((a, b) => b.severity - a.severity),
      }))
      .sort(
        (a, b) =>
          b.maxSeverity - a.maxSeverity ||
          b.findings.length - a.findings.length ||
          a.entityLabel.localeCompare(b.entityLabel)
      );
  });

  const showFilters = $derived(
    allFindings.length > 0 || activeFilter !== 'all' || !!searchQuery.trim()
  );

  function toggleEntity(key: string) {
    const next = new Set(expandedEntities);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedEntities = next;
  }

  function severityDot(severity: number) {
    if (severity === 4) return 'bg-destructive';
    if (severity === 3) return 'bg-destructive/80';
    if (severity === 2) return 'bg-warning';
    return 'bg-muted-foreground/40';
  }

  async function refreshFindings() {
    await queryClient.invalidateQueries({ queryKey: ['vendor.linkFindings', linkId] });
  }
</script>

<div class="flex flex-col size-full overflow-hidden border-t">
  <div class="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
    <div class="flex items-center gap-2">
      <h2 class="font-semibold text-sm">Insights</h2>
      {#if !loading}
        <span class="text-xs text-muted-foreground tabular-nums">
          {entityGroups.length}
          {entityGroups.length === 1 ? 'entity' : 'entities'}
        </span>
      {/if}
    </div>
    {#if !loading}
      <a
        href={findingsHref}
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        View all findings &rarr;
      </a>
    {/if}
  </div>

  {#if !loading && showFilters}
    <div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b shrink-0">
      <div class="flex items-center gap-1">
        <button
          type="button"
          onclick={() => (activeFilter = 'all')}
          class={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
            activeFilter === 'all'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          All
          <span class="tabular-nums opacity-60">{filterCounts.get('all') ?? 0}</span>
        </button>
        {#each filters as filter}
          {@const count = filterCounts.get(filter.id) ?? 0}
          {#if count > 0 || activeFilter === filter.id}
            <button
              type="button"
              onclick={() => (activeFilter = filter.id)}
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
          bind:value={searchQuery}
          class="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <Loader />
    {:else if entityGroups.length === 0}
      <FadeIn class="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {searchQuery.trim() ? 'No findings match your search' : 'No open findings'}
      </FadeIn>
    {:else}
      <FadeIn class="flex-1">
        <table class="w-full table-fixed text-sm">
          <thead class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
            <tr
              class="text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              <th class="w-[32%] px-4 py-2">{entityHeading}</th>
              <th class="px-3 py-2">Summary</th>
              <th class="w-24 px-3 py-2">Severity</th>
              <th class="w-20 px-3 py-2 text-right">Seen</th>
              <th class="w-24 px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {#each entityGroups as entity (entity.entityKey)}
              {@const expanded = expandedEntities.has(entity.entityKey)}
              {@const primary = entity.findings[0]}
              {@const moduleLabels = moduleLabelForFinding
                ? [...new Set(entity.findings.map((f) => moduleLabelForFinding(f)))]
                : [...new Set(entity.findings.map((f) => f.policyName))]}
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
                        severityDot(entity.maxSeverity)
                      )}
                    ></span>
                    <span class="min-w-0">
                      <span class="block truncate font-medium">{entity.entityLabel}</span>
                      <span class="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                        {entity.findings.length}
                        {entity.findings.length === 1 ? 'finding' : 'findings'}
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
                      {entity.findings.length === 1
                        ? primary.title
                        : `${entity.findings.length} open findings`}
                    </div>
                    <div class="truncate text-xs text-muted-foreground">
                      {entity.findings.length === 1
                        ? primary.evidenceSummary
                        : moduleLabels.join(', ')}
                    </div>
                  </button>
                </td>
                <td class="px-3 py-2 align-top">
                  <FindingSeverityBadge severity={entity.maxSeverity} />
                </td>
                <td
                  class="px-3 py-2 text-right align-top text-xs text-muted-foreground tabular-nums"
                >
                  {formatRelativeDate(entity.lastSeenAt)}
                </td>
                <td class="px-4 py-2 text-right align-top">
                  {#if entity.findings.length === 1}
                    <button
                      type="button"
                      onclick={() => (selectedFindingId = primary.id)}
                      class="text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 transition-colors"
                    >
                      View
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
                <tr class="border-b bg-muted/10">
                  <td colspan="5" class="px-4 py-2">
                    <div class="ml-6 overflow-hidden rounded-md border bg-background">
                      {#each entity.findings as finding, index (finding.id)}
                        <div
                          class={cn(
                            'grid gap-2 px-3 py-2 text-xs md:grid-cols-[minmax(11rem,16rem)_1fr_auto]',
                            index < entity.findings.length - 1 && 'border-b'
                          )}
                        >
                          <div class="min-w-0">
                            <div class="flex items-center gap-1.5">
                              <span
                                class={cn(
                                  'size-1.5 rounded-full shrink-0',
                                  severityDot(finding.severity)
                                )}
                              ></span>
                              <span class="truncate font-medium text-sm">{finding.title}</span>
                            </div>
                            <div
                              class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                            >
                              <span>{finding.policyName}</span>
                            </div>
                          </div>
                          <div class="min-w-0">
                            <div class="wrap-break-word text-sm leading-snug">
                              {finding.evidenceSummary}
                            </div>
                            {#if finding.recommendation}
                              <div class="mt-1 text-[11px] text-muted-foreground">
                                {finding.recommendation}
                              </div>
                            {/if}
                          </div>
                          <div class="flex items-start justify-end">
                            <button
                              type="button"
                              onclick={() => (selectedFindingId = finding.id)}
                              class="shrink-0 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-0.5 transition-colors"
                            >
                              View
                            </button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </FadeIn>
    {/if}
  </div>
</div>

<FindingSheet
  findingId={selectedFindingId}
  onclose={() => (selectedFindingId = null)}
  onchange={refreshFindings}
/>
