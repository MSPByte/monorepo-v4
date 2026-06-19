<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import * as Card from '$lib/components/ui/card';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const overviewQuery = createQuery(() => ({
    queryKey: ['overview.summary'],
    queryFn: () => trpc.overview.summary.query(),
  }));
</script>

<div class="size-full overflow-auto">
  <div class="mx-auto flex max-w-7xl flex-col gap-6 p-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Overview</h1>
      <p class="text-sm text-muted-foreground">What requires attention today.</p>
    </div>

    {#if overviewQuery.data}
      {@const data = overviewQuery.data}
      <div class="grid gap-4 md:grid-cols-4">
        {#each data.bySeverity as item}
          <MetricCard
            label={item.severity === 4
              ? 'Critical findings'
              : item.severity === 3
                ? 'High findings'
                : item.severity === 2
                  ? 'Medium findings'
                  : 'Low findings'}
            value={item.count}
            detail="Open technician work"
          />
        {/each}
      </div>

      <div class="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section class="space-y-3">
          <h2 class="text-sm font-medium">Highest Priority Findings</h2>
          {#each data.highestPriorityFindings as finding}
            <FindingCard finding={finding} />
          {/each}
        </section>

        <div class="space-y-4">
          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Sites Needing Attention</Card.Title>
              <Card.Description>Open finding pressure by site.</Card.Description>
            </Card.Header>
            <Card.Content class="space-y-3">
              {#each data.sitesNeedingAttention as site}
                <a href={`/sites/${site.id}`} class="flex items-center justify-between rounded-md border p-3 hover:bg-accent/40">
                  <span class="font-medium">{site.name}</span>
                  <span class="text-sm text-muted-foreground">{site.openFindingCount} open</span>
                </a>
              {/each}
            </Card.Content>
          </Card.Root>

          <div class="grid gap-4 sm:grid-cols-2">
            <MetricCard
              label="Correlation Health"
              value={data.correlationHealth.unmatchedSignals}
              detail="Unmatched source signals"
            />
            <MetricCard
              label="Policy Coverage"
              value={`${data.policyCoverage.averagePassRate}%`}
              detail={`${data.policyCoverage.enabledPolicies} enabled policies`}
            />
            <MetricCard
              label="Sync Health"
              value={data.syncHealth.failedSources}
              detail={`${data.syncHealth.warningSources} warnings`}
            />
            <MetricCard
              label="Frameworks"
              value={data.policyCoverage.frameworksEnabled}
              detail="Enabled bundles"
            />
          </div>

          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Recent Activity</Card.Title>
            </Card.Header>
            <Card.Content class="space-y-2 text-sm">
              {#each data.recentActivity as activity}
                <div class="rounded-md bg-muted px-3 py-2">{activity}</div>
              {/each}
            </Card.Content>
          </Card.Root>
        </div>
      </div>
    {:else}
      <div class="text-sm text-muted-foreground">Loading overview...</div>
    {/if}
  </div>
</div>
