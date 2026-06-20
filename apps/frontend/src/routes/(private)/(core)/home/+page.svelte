<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const kpis = createQuery(() => ({
    queryKey: ['overview.kpis'],
    queryFn: () => trpc.overview.kpis.query()
  }));

  const rollups = createQuery(() => ({
    queryKey: ['overview.findingRollups.briefing'],
    queryFn: () => trpc.overview.findingRollups.query()
  }));

  const sitePressure = createQuery(() => ({
    queryKey: ['overview.sitePressure.briefing'],
    queryFn: () => trpc.overview.sitePressure.query()
  }));

  function severityLabel(severity: number) {
    return severity === 4 ? 'Critical' : severity === 3 ? 'High' : severity === 2 ? 'Medium' : 'Low';
  }
</script>

<div class="size-full overflow-auto">
  <div class="flex flex-col gap-6 p-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Command Center</h1>
      <p class="text-sm text-muted-foreground">What needs your attention across every managed site.</p>
    </div>

    <div class="grid gap-4 md:grid-cols-4">
      <a href="/home/findings" class="block">
        <MetricCard
          label="Critical &amp; High open"
          value={kpis.data?.criticalHigh ?? '—'}
          detail={`${kpis.data?.totalOpen ?? 0} total open findings`}
        />
      </a>
      <a href="/home/sites" class="block">
        <MetricCard
          label="Sites with open work"
          value={kpis.data?.sitesWithOpenFindings ?? '—'}
          detail="Click to triage by site"
        />
      </a>
      <a href="/setup/integrations" class="block">
        <MetricCard
          label="Failing sources"
          value={kpis.data?.sourceHealth.failed ?? '—'}
          detail={`${kpis.data?.sourceHealth.total ?? 0} integration links`}
        />
      </a>
      <MetricCard
        label="Policy pass rate"
        value={kpis.data ? `${kpis.data.policyPassRate}%` : '—'}
        detail="Across enabled policies"
      />
    </div>

    <div class="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section class="space-y-3">
        <div class="flex items-baseline justify-between">
          <h2 class="text-sm font-medium">Needs attention now</h2>
          <a href="/home/findings" class="text-xs text-muted-foreground hover:text-foreground">View all rollups →</a>
        </div>
        {#if rollups.data && rollups.data.length > 0}
          <div class="grid gap-3 md:grid-cols-2">
            {#each rollups.data.slice(0, 8) as rollup}
              <a
                href={`/findings?policyId=${encodeURIComponent(rollup.policyId)}`}
                class="block rounded-lg border bg-background p-4 transition-colors hover:bg-accent/40"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <div class="font-medium leading-tight">
                      {rollup.count} {rollup.count === 1 ? 'finding' : 'findings'} — {rollup.policyName}
                    </div>
                    <div class="text-xs text-muted-foreground">
                      {rollup.siteCount} {rollup.siteCount === 1 ? 'site' : 'sites'} affected · last seen {formatRelativeDate(rollup.lastSeenAt)}
                    </div>
                  </div>
                  <FindingSeverityBadge severity={rollup.maxSeverity} />
                </div>
              </a>
            {/each}
          </div>
        {:else if rollups.data}
          <Card.Root class="rounded-lg">
            <Card.Content class="py-6 text-center text-sm text-muted-foreground">
              No open findings — every enabled policy is passing.
            </Card.Content>
          </Card.Root>
        {:else}
          <div class="text-sm text-muted-foreground">Loading rollups…</div>
        {/if}
      </section>

      <div class="space-y-6">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Sites by pressure</Card.Title>
            <Card.Description>Highest open finding load first.</Card.Description>
          </Card.Header>
          <Card.Content class="space-y-2">
            {#if sitePressure.data && sitePressure.data.length > 0}
              {#each sitePressure.data.slice(0, 8) as site}
                <a href={`/sites/${site.id}`} class="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent/40">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">{site.name}</div>
                    <div class="text-xs text-muted-foreground">{site.openFindingCount} open</div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1 text-xs">
                    {#if site.severity.critical > 0}<span class="rounded bg-red-700 px-1.5 py-0.5 text-white">{site.severity.critical}C</span>{/if}
                    {#if site.severity.high > 0}<span class="rounded bg-orange-600 px-1.5 py-0.5 text-white">{site.severity.high}H</span>{/if}
                    {#if site.severity.medium > 0}<span class="rounded bg-yellow-500 px-1.5 py-0.5 text-black">{site.severity.medium}M</span>{/if}
                    {#if site.severity.low > 0}<span class="rounded border px-1.5 py-0.5 text-muted-foreground">{site.severity.low}L</span>{/if}
                  </div>
                </a>
              {/each}
            {:else if sitePressure.data}
              <div class="py-4 text-center text-sm text-muted-foreground">No sites with open work.</div>
            {:else}
              <div class="text-sm text-muted-foreground">Loading…</div>
            {/if}
          </Card.Content>
        </Card.Root>

        {#if kpis.data}
          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Severity distribution</Card.Title>
            </Card.Header>
            <Card.Content>
              <div class="space-y-2">
                {#each kpis.data.bySeverity as bucket}
                  <div class="flex items-center justify-between rounded-md border px-3 py-2">
                    <div class="text-xs text-muted-foreground">{severityLabel(bucket.severity)}</div>
                    <div class="text-lg font-semibold">{bucket.count}</div>
                  </div>
                {/each}
              </div>
            </Card.Content>
          </Card.Root>
        {/if}
      </div>
    </div>
  </div>
</div>
