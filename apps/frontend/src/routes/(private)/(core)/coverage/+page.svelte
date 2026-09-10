<script lang="ts">
  import './workspace.css';
  import SingleSelect from '$lib/components/single-select.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Search, ArrowUpRight, RefreshCw, CircleCheck, TriangleAlert } from '@lucide/svelte';
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { STALE } from '$lib/query';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import ScopeBar from '../reports/_components/scope-bar.svelte';
  import { serializeFilters } from '$lib/components/data-table/utils/filters';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Building2 from '@lucide/svelte/icons/building-2';
  import Link2 from '@lucide/svelte/icons/link-2';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import Loader from '$lib/components/transition/loader.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const prefsQuery = createQuery(() => ({
    queryKey: ['reports.getMyPrefs'],
    queryFn: () => trpc.reports.getMyPrefs.query(),
    staleTime: STALE.PAGE,
  }));

  const query = createQuery(() => ({
    queryKey: ['findings.policyBreakdown', prefsQuery.data?.scopeKind, prefsQuery.data?.scopeIds],
    queryFn: () => trpc.findings.policyBreakdown.query(),
    staleTime: STALE.PAGE,
    enabled: prefsQuery.isSuccess,
  }));

  $effect(() => {
    function onScopeChanged() {
      void queryClient.invalidateQueries({ queryKey: ['findings.policyBreakdown'] });
    }
    window.addEventListener('reports:scope-changed', onScopeChanged);
    return () => window.removeEventListener('reports:scope-changed', onScopeChanged);
  });

  const data = $derived(query.data ?? []);

  type PolicyRow = NonNullable<typeof query.data>[number];

  type CategoryGroup = {
    category: string | null;
    maxSeverity: number;
    totalFindings: number;
    policies: PolicyRow[];
  };

  type SiteGap = {
    siteId: string;
    siteName: string;
    totalFindings: number;
    policyCount: number;
    worstSeverity: number;
    policies: {
      policyId: string;
      policyName: string;
      category: string | null;
      severity: number;
      count: number;
    }[];
  };

  let search = $state('');
  let viewMode = $state<'sites' | 'policies'>('sites');
  let severity = $state('all');
  let sort = $state('priority');
  const matchingData = $derived(
    data.filter((p) => severity === 'all' || p.severity === Number(severity))
  );
  const hasFilters = $derived(!!search.trim() || severity !== 'all');
  function clearFilters() {
    search = '';
    severity = 'all';
  }
  async function refresh() {
    await prefsQuery.refetch();
    if (prefsQuery.isSuccess) await query.refetch();
  }

  // Policy-first grouping
  const grouped = $derived.by(() => {
    const map = new Map<string | null, PolicyRow[]>();
    for (const policy of matchingData) {
      const key = policy.category ?? null;
      const bucket = map.get(key) ?? [];
      bucket.push(policy);
      map.set(key, bucket);
    }

    const groups: CategoryGroup[] = [];
    for (const [category, pols] of map) {
      groups.push({
        category,
        maxSeverity: Math.max(...pols.map((p) => p.severity)),
        totalFindings: pols.reduce((a, p) => a + p.totalFindings, 0),
        policies: pols,
      });
    }

    const named = groups
      .filter((g) => g.category !== null)
      .sort((a, b) => b.maxSeverity - a.maxSeverity);
    const unnamed = groups.filter((g) => g.category === null);
    return [...named, ...unnamed];
  });

  // Site-first pivot — each site lists matching policies and its highest policy severity.
  const siteGaps = $derived.by((): SiteGap[] => {
    const map = new Map<string, SiteGap>();
    for (const policy of matchingData) {
      for (const site of policy.sites) {
        if (!map.has(site.siteId)) {
          map.set(site.siteId, {
            siteId: site.siteId,
            siteName: site.siteName,
            totalFindings: 0,
            policyCount: 0,
            worstSeverity: 1,
            policies: [],
          });
        }
        const s = map.get(site.siteId)!;
        s.totalFindings += site.count;
        s.policyCount += 1;
        s.policies.push({
          policyId: policy.policyId,
          policyName: policy.policyName,
          category: policy.category,
          severity: policy.severity,
          count: site.count,
        });
        if (policy.severity > s.worstSeverity) s.worstSeverity = policy.severity;
      }
    }

    return [...map.values()].sort((a, b) =>
      sort === 'name'
        ? a.siteName.localeCompare(b.siteName)
        : sort === 'findings'
          ? b.totalFindings - a.totalFindings || a.siteName.localeCompare(b.siteName)
          : b.worstSeverity - a.worstSeverity ||
            b.totalFindings - a.totalFindings ||
            a.siteName.localeCompare(b.siteName)
    );
  });

  // Summary stats
  const totalPolicies = $derived(data.length);
  const totalSites = $derived(new Set(data.flatMap((p) => p.sites.map((s) => s.siteId))).size);
  const totalLinks = $derived(new Set(data.flatMap((p) => p.links.map((l) => l.linkId))).size);
  const totalFindings = $derived(data.reduce((a, p) => a + p.totalFindings, 0));
  const criticalCount = $derived(
    data.filter((p) => p.severity === 4).reduce((a, p) => a + p.totalFindings, 0)
  );

  const filteredPolicies = $derived.by(() => {
    const term = search.trim().toLowerCase();
    return grouped
      .map((group) => ({
        ...group,
        policies: group.policies
          .filter(
            (p) =>
              p.policyName.toLowerCase().includes(term) ||
              (p.category ?? '').toLowerCase().includes(term) ||
              p.sites.some((s) => s.siteName.toLowerCase().includes(term)) ||
              p.links.some((l) => l.linkName.toLowerCase().includes(term))
          )
          .toSorted((a, b) =>
            sort === 'name'
              ? a.policyName.localeCompare(b.policyName)
              : sort === 'findings'
                ? b.totalFindings - a.totalFindings
                : b.severity - a.severity || b.totalFindings - a.totalFindings
          ),
      }))
      .filter((g) => g.policies.length > 0);
  });

  const filteredSites = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return siteGaps;
    return siteGaps.filter(
      (s) =>
        s.siteName.toLowerCase().includes(term) ||
        s.policies.some(
          (p) =>
            p.policyName.toLowerCase().includes(term) ||
            (p.category ?? '').toLowerCase().includes(term) ||
            matchingData
              .find((row) => row.policyId === p.policyId)
              ?.links.some(
                (link) => link.siteName === s.siteName && link.linkName.toLowerCase().includes(term)
              )
        )
    );
  });

  function connectionSiteName(link: PolicyRow['links'][number], policy: PolicyRow): string | null {
    const name = (
      policy.sites.find((site) => site.siteId === link.siteId)?.siteName ?? link.siteName
    )?.trim();
    return name && !['-', '–', '—'].includes(name) ? name : null;
  }

  let expanded = $state(new Set<string>());
  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function findingsUrl(filters: { field: string; value: string }[]): string {
    const f = filters.map((fi, i) => ({
      id: `cov-${i}`,
      field: fi.field,
      operator: 'eq' as const,
      value: fi.value,
    }));
    return `/findings?filters=${encodeURIComponent(serializeFilters([...f, { id: 'cov-resolved', field: 'status', operator: 'neq', value: 'resolved' }, { id: 'cov-suppressed', field: 'status', operator: 'neq', value: 'suppressed' }]))}`;
  }

  const visibleIds = $derived(
    viewMode === 'sites'
      ? filteredSites.map((s) => s.siteId)
      : filteredPolicies.flatMap((g) => g.policies.map((p) => p.policyId))
  );
  const allExpanded = $derived(visibleIds.length > 0 && visibleIds.every((id) => expanded.has(id)));
  const visiblePolicyCount = $derived(
    filteredPolicies.reduce((sum, group) => sum + group.policies.length, 0)
  );
  const severityOptions = [
    { value: 'all', label: 'All severities' },
    { value: '4', label: 'Critical' },
    { value: '3', label: 'High' },
    { value: '2', label: 'Medium' },
    { value: '1', label: 'Low' },
  ];

  function plural(n: number, word: string, pluralWord?: string): string {
    return `${n.toLocaleString()} ${n === 1 ? word : (pluralWord ?? word + 's')}`;
  }
</script>

<svelte:head><title>Coverage | MSPByte</title></svelte:head>

<div class="coverage-workspace">
  <header class="cw-header">
    <div class="cw-heading">
      <span class="cw-icon"><ShieldAlert size={22} /></span>
      <div>
        <p class="cw-eyebrow">Operations / Policy gaps</p>
        <h1>Coverage</h1>
      </div>
    </div>
    <div class="cw-actions">
      <ScopeBar /><Button
        variant="outline"
        size="sm"
        disabled={query.isFetching || prefsQuery.isFetching}
        onclick={refresh}
        ><RefreshCw size={14} />
        {query.isFetching || prefsQuery.isFetching ? 'Refreshing…' : 'Refresh'}</Button
      >
    </div>
  </header>

  {#if prefsQuery.isError || query.isError}
    <div class="cw-empty" role="alert">
      <TriangleAlert size={28} />
      <h2>Couldn’t load coverage</h2>
      <p>
        {prefsQuery.isError
          ? 'Your saved scope could not be loaded.'
          : 'Coverage data is unavailable.'} Try again to see the latest policy gaps.
      </p>
      <Button
        variant="outline"
        onclick={refresh}
        disabled={prefsQuery.isFetching || query.isFetching}>Try again</Button
      >
    </div>
  {:else if query.isPending || prefsQuery.isPending}
    <div class="cw-empty" role="status">
      <Loader />
      <p>Loading policy gaps for your scope…</p>
    </div>
  {:else}
    <section class="cw-intro" aria-label="Coverage overview">
      <div>
        <p class="cw-eyebrow">Know where to focus</p>
        <h2>Know what your clients <span>are missing.</span></h2>
        <p>
          See which client sites need attention and the policy gaps to discuss at your next review.
        </p>
      </div>
      <div class="cw-priority">
        <ShieldAlert size={20} />
        <div>
          <strong
            >{data.length
              ? plural(totalPolicies, 'policy needs', 'policies need') + ' attention'
              : 'No open policy gaps'}</strong
          >
          <p>
            {criticalCount > 0
              ? `${plural(data.filter((p) => p.severity === 4).length, 'policy', 'policies')} with critical severity. Start your review there.`
              : data.length
                ? 'Start with the highest severity, then work through the most affected sites.'
                : 'No open findings were returned for your current scope.'}
          </p>
          {#if criticalCount > 0}<button
              type="button"
              onclick={() => {
                viewMode = 'policies';
                severity = '4';
                search = '';
              }}>Review critical policies <ArrowUpRight size={14} /></button
            >{/if}
        </div>
      </div>
    </section>

    <div class="cw-overview" aria-label="Totals for current scope">
      <div>
        <span><Building2 size={14} /> Client sites with gaps</span><strong
          >{totalSites.toLocaleString()}</strong
        ><small>Sites with open gaps</small>
      </div>
      <div>
        <span><Link2 size={14} /> Connections with gaps</span><strong
          >{totalLinks.toLocaleString()}</strong
        ><small>Integration connections</small>
      </div>
      <div>
        <span><ShieldAlert size={14} /> Policies with gaps</span><strong
          >{totalPolicies.toLocaleString()}</strong
        ><small>Across the selected scope</small>
      </div>
      <div>
        <span><TriangleAlert size={14} /> Open findings</span><strong
          >{totalFindings.toLocaleString()}</strong
        ><small>Includes acknowledged & regressed</small>
      </div>
    </div>

    {#if data.length === 0}
      <div class="cw-empty">
        <CircleCheck size={30} class="text-success" />
        <h2>No open gaps in this scope</h2>
        <p>
          There are no open findings to review. This does not confirm that every policy has been
          evaluated. Change the scope above to review other sites or links.
        </p>
        <Button variant="outline" onclick={refresh} disabled={query.isFetching}>Check again</Button>
      </div>
    {:else}
      <section class="cw-panel" aria-label="Explore policy gaps">
        <div class="cw-toolbar">
          <div>
            <h2>
              {viewMode === 'sites' ? 'Client coverage gaps' : 'Policy impact across clients'}
            </h2>
            <p>
              {viewMode === 'sites'
                ? 'Review the gaps below each site. Expand for all policies and finding counts.'
                : 'See who is affected by each policy. Expand to review client sites and integration connections.'}
            </p>
          </div>
          <div class="cw-search">
            <Search size={16} /><input
              type="search"
              aria-label="Search coverage"
              bind:value={search}
              placeholder="Search sites, policies or links…"
            />
          </div>
        </div>
        <div class="cw-filterbar">
          <div class="cw-tabs" aria-label="Group coverage by">
            <button
              type="button"
              class:active={viewMode === 'sites'}
              aria-pressed={viewMode === 'sites'}
              onclick={() => (viewMode = 'sites')}
              ><Building2 size={15} /> By client site <span>{totalSites}</span></button
            ><button
              type="button"
              class:active={viewMode === 'policies'}
              aria-pressed={viewMode === 'policies'}
              onclick={() => (viewMode = 'policies')}
              ><ShieldAlert size={15} /> By policy <span>{totalPolicies}</span></button
            >
          </div>
          <div class="cw-controls">
            <div class="cw-control">
              <span>Policy severity</span>
              <SingleSelect
                options={severityOptions}
                selected={severity}
                onchange={(value) => (severity = value || 'all')}
                aria-label="Policy severity"
                placeholder="All severities"
                searchPlaceholder="Find a severity…"
                disableSort
                allowClear={false}
                class="h-8 text-xs"
              />
            </div>
            <div class="cw-control">
              <span>Sort by</span>
              <SingleSelect
                options={[
                  { value: 'priority', label: 'Highest severity' },
                  { value: 'findings', label: 'Most findings' },
                  { value: 'name', label: 'Name A–Z' },
                ]}
                selected={sort}
                onchange={(value) => (sort = value || 'priority')}
                aria-label="Sort by"
                placeholder="Highest severity"
                searchPlaceholder="Find a sort order…"
                disableSort
                allowClear={false}
                class="h-8 text-xs"
              />
            </div>
          </div>
        </div>
        <div class="cw-results">
          <span aria-live="polite"
            >{viewMode === 'sites'
              ? plural(filteredSites.length, 'site')
              : plural(visiblePolicyCount, 'policy', 'policies')} shown{hasFilters
              ? ' · Filtered results'
              : ''}</span
          >
          <div>
            {#if hasFilters}<button type="button" onclick={clearFilters}>Clear filters</button
              >{/if}<button
              type="button"
              disabled={visibleIds.length === 0}
              onclick={() => (expanded = allExpanded ? new Set() : new Set(visibleIds))}
              >{allExpanded ? 'Collapse all' : 'Expand all'}</button
            >
          </div>
        </div>
        {#if viewMode === 'sites' && totalLinks > 0}<div class="cw-note">
            <Link2 size={14} /><span>Integration links may have gaps of their own.</span><button
              type="button"
              onclick={() => (viewMode = 'policies')}
              >Review by policy <ArrowUpRight size={13} /></button
            >
          </div>{/if}
        <div class="cw-list">
          {#if visibleIds.length === 0}
            <div class="cw-empty">
              <Search size={26} />
              <h2>{hasFilters ? 'No matching gaps' : 'These gaps belong to integration links'}</h2>
              <p>
                {hasFilters
                  ? 'Try a different search or severity to broaden your results.'
                  : 'Switch to the policy view to review affected integration links.'}
              </p>
              {#if hasFilters}<Button variant="outline" onclick={clearFilters}>Clear filters</Button
                >{:else}<Button variant="outline" onclick={() => (viewMode = 'policies')}
                  >Review by policy</Button
                >{/if}
            </div>
          {:else if viewMode === 'sites'}
            {#each filteredSites as site (site.siteId)}
              {@const isExpanded = expanded.has(site.siteId)}
              <article class="cw-row">
                <div class="cw-row-header">
                  <button
                    type="button"
                    class="cw-toggle"
                    aria-expanded={isExpanded}
                    aria-controls={'site-' + site.siteId}
                    onclick={() => toggle(site.siteId)}
                    ><span class="cw-row-icon"><Building2 size={18} /></span><span
                      class="cw-row-copy"
                      ><strong>{site.siteName}</strong><small
                        >{plural(site.policyCount, 'policy gap')}</small
                      ></span
                    ><FindingSeverityBadge severity={site.worstSeverity} /><span class="cw-count"
                      >{plural(site.totalFindings, 'finding')}</span
                    ><ChevronDown size={16} class={isExpanded ? 'rotate-180' : ''} /></button
                  ><a
                    class="cw-review"
                    aria-label={'Review findings for ' + site.siteName}
                    href={findingsUrl([{ field: 'siteName', value: site.siteName }])}
                    >Review <ArrowUpRight size={14} /></a
                  >
                </div>
                {#if !isExpanded}
                  <div class="cw-gap-preview" aria-label={'Policy gaps for ' + site.siteName}>
                    <span class="cw-gap-label">Needs attention</span>
                    <div class="cw-gap-links">
                      {#each site.policies
                        .toSorted((a, b) => b.severity - a.severity || b.count - a.count)
                        .slice(0, 3) as policy (policy.policyId)}
                        <a
                          href={findingsUrl([
                            { field: 'siteName', value: site.siteName },
                            { field: 'policyName', value: policy.policyName },
                          ])}>{policy.policyName}<ArrowUpRight size={12} /></a
                        >
                      {/each}
                      {#if site.policyCount > 3}
                        <button
                          type="button"
                          onclick={() => toggle(site.siteId)}
                          aria-expanded={false}
                          aria-controls={'site-' + site.siteId}>+{site.policyCount - 3} more</button
                        >
                      {/if}
                    </div>
                  </div>
                {/if}
                {#if isExpanded}<div class="cw-details" id={'site-' + site.siteId}>
                    {#each site.policies.toSorted((a, b) => b.severity - a.severity || b.count - a.count) as policy (policy.policyId)}<a
                        class="cw-detail"
                        href={findingsUrl([
                          { field: 'siteName', value: site.siteName },
                          { field: 'policyName', value: policy.policyName },
                        ])}
                        ><FindingSeverityBadge severity={policy.severity} /><span
                          class="cw-row-copy"
                          ><strong>{policy.policyName}</strong>{#if policy.category}<small
                              >{policy.category}</small
                            >{/if}</span
                        ><span class="cw-count">{plural(policy.count, 'finding')}</span
                        ><ArrowUpRight size={14} /></a
                      >{/each}
                  </div>{/if}
              </article>
            {/each}
          {:else}
            {#each filteredPolicies as group (group.category)}
              <div class="cw-category">
                <h3>{group.category ?? 'Uncategorized'}</h3>
                <span>{plural(group.policies.length, 'policy', 'policies')}</span>
              </div>
              {#each group.policies as policy (policy.policyId)}
                {@const isExpanded = expanded.has(policy.policyId)}
                <article class="cw-row cw-policy-row">
                  <div class="cw-row-header">
                    <button
                      type="button"
                      class="cw-toggle"
                      aria-expanded={isExpanded}
                      aria-controls={'policy-' + policy.policyId}
                      onclick={() => toggle(policy.policyId)}
                    >
                      <span class="cw-row-icon"><ShieldAlert size={18} /></span>
                      <span class="cw-row-copy"
                        ><strong>{policy.policyName}</strong>
                        <small
                          >{policy.siteCount > 0
                            ? plural(policy.siteCount, 'client site') + ' affected'
                            : 'No client sites identified'}{policy.linkCount > 0
                            ? ' · ' + plural(policy.linkCount, 'connection')
                            : ''}</small
                        >
                      </span>
                      <FindingSeverityBadge severity={policy.severity} />
                      <span class="cw-count">{plural(policy.totalFindings, 'finding')}</span>
                      <ChevronDown size={16} class={isExpanded ? 'rotate-180' : ''} />
                    </button>
                    <a
                      class="cw-review"
                      aria-label={'Review findings for ' + policy.policyName}
                      href={findingsUrl([{ field: 'policyName', value: policy.policyName }])}
                      >Review findings <ArrowUpRight size={14} /></a
                    >
                  </div>
                  {#if !isExpanded && (policy.sites.length || policy.links.length)}
                    <div
                      class="cw-gap-preview"
                      aria-label={'Affected clients for ' + policy.policyName}
                    >
                      <span class="cw-gap-label"
                        >{policy.sites.length
                          ? 'Affected client sites'
                          : 'Affected connections'}</span
                      >
                      <div class="cw-gap-links">
                        {#each (policy.sites.length ? policy.sites.map( (site) => ({ id: site.siteId, name: site.siteName, field: 'siteName', count: site.count }) ) : policy.links.map( (link) => ({ id: link.linkId, name: link.linkName, field: 'linkName', count: link.count }) ))
                          .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name))
                          .slice(0, 3) as target (target.id)}
                          <a
                            href={findingsUrl([
                              { field: 'policyName', value: policy.policyName },
                              { field: target.field, value: target.name },
                            ])}>{target.name}<ArrowUpRight size={12} /></a
                          >
                        {/each}
                        {#if (policy.sites.length || policy.links.length) > 3}
                          <button
                            type="button"
                            onclick={() => toggle(policy.policyId)}
                            aria-expanded={false}
                            aria-controls={'policy-' + policy.policyId}
                            >+{(policy.sites.length || policy.links.length) - 3} more</button
                          >
                        {/if}
                      </div>
                    </div>
                  {/if}
                  {#if isExpanded}
                    <div class="cw-policy-details" id={'policy-' + policy.policyId}>
                      <div class="cw-impact-guide">
                        <span>Who is affected</span>
                        <p>
                          Open a site or connection to review its findings. Most findings are listed
                          first.
                        </p>
                      </div>
                      <div class="cw-impact-grid">
                        <section
                          class="cw-impact-section"
                          aria-label={'Affected client sites for ' + policy.policyName}
                        >
                          <div class="cw-impact-heading">
                            <Building2 size={15} />
                            <h4>Affected client sites</h4>
                            <span>{policy.sites.length}</span>
                          </div>
                          {#each policy.sites.toSorted((a, b) => b.count - a.count || a.siteName.localeCompare(b.siteName)) as site (site.siteId)}
                            <a
                              class="cw-detail"
                              href={findingsUrl([
                                { field: 'policyName', value: policy.policyName },
                                { field: 'siteName', value: site.siteName },
                              ])}
                            >
                              <span class="cw-row-copy"><strong>{site.siteName}</strong></span>
                              <span class="cw-count">{plural(site.count, 'finding')}</span
                              ><ArrowUpRight size={14} />
                            </a>
                          {:else}
                            <div class="cw-impact-empty">
                              <p>No client sites identified</p>
                              <span
                                >{policy.links.length
                                  ? 'Review the connections to investigate where this gap applies.'
                                  : 'Open the policy findings to investigate the affected resources.'}</span
                              >
                            </div>
                          {/each}
                        </section>
                        <section
                          class="cw-impact-section"
                          aria-label={'Integration connections for ' + policy.policyName}
                        >
                          <div class="cw-impact-heading">
                            <Link2 size={15} />
                            <h4>Integration connections</h4>
                            <span>{policy.links.length}</span>
                          </div>
                          {#each policy.links.toSorted((a, b) => b.count - a.count || a.linkName.localeCompare(b.linkName)) as link (link.linkId)}
                            {@const siteName = connectionSiteName(link, policy)}
                            <a
                              class="cw-detail"
                              href={findingsUrl([
                                { field: 'policyName', value: policy.policyName },
                                { field: 'linkName', value: link.linkName },
                              ])}
                            >
                              <span class="cw-row-copy"
                                ><strong>{link.linkName}</strong><small
                                  >{siteName
                                    ? 'Client site: ' + siteName
                                    : 'Client site not identified in findings'}</small
                                ></span
                              >
                              <span class="cw-count">{plural(link.count, 'finding')}</span
                              ><ArrowUpRight size={14} />
                            </a>
                          {:else}
                            <div class="cw-impact-empty">
                              <p>No affected connections</p>
                              <span
                                >No integration connections are identified in these findings.</span
                              >
                            </div>
                          {/each}
                        </section>
                      </div>
                      {#if policy.sites.length && policy.links.length}<p class="cw-overlap-note">
                          A finding can appear under both a site and a connection. These counts
                          overlap; the policy total is {plural(policy.totalFindings, 'finding')}.
                        </p>{/if}
                    </div>
                  {/if}
                </article>
              {/each}
            {/each}
          {/if}
        </div>
      </section>
      <p class="cw-footnote">
        Coverage shows open, acknowledged and regressed findings. Policy severity reflects the
        highest severity of its open findings. Site and link counts can overlap.
      </p>
    {/if}
  {/if}
</div>
