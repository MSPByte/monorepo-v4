<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const frameworkQuery = createQuery(() => ({
    queryKey: ['frameworks.byId', id],
    queryFn: () => trpc.frameworks.byId.query({ id }),
  }));
  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const siteName = (siteId: string) => sitesQuery.data?.find((site) => site.id === siteId)?.name ?? siteId;
</script>

{#if frameworkQuery.data}
  {@const framework = frameworkQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader
      eyebrow="Framework"
      title={framework.name}
      subtitle={framework.description}
      sources={['Policy bundle']}
    />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-4">
          <MetricCard label="Pass Rate" value={`${framework.passRate}%`} />
          <MetricCard label="Policies" value={framework.policyCount} />
          <MetricCard label="Open Findings" value={framework.openFindings} />
          <MetricCard label="Enabled" value={framework.enabled ? 'Yes' : 'No'} />
        </div>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Contained Policies</Card.Title>
            <Card.Description>Policies in this standard or baseline.</Card.Description>
          </Card.Header>
          <Card.Content class="space-y-2 text-sm">
            {#each framework.containedPolicies ?? [] as policy}
              <a href={`/policies/${policy.id}`} class="block rounded-md border p-3 hover:bg-accent/40">
                <div class="font-medium">{policy.name}</div>
                <div class="text-xs text-muted-foreground">{policy.expectation}</div>
              </a>
            {/each}
          </Card.Content>
        </Card.Root>

        <section class="space-y-3">
          <h2 class="text-sm font-medium">Recent Failures</h2>
          {#each framework.recentFailures ?? [] as finding}
            <FindingCard {finding} policyName={finding.policyId} />
          {/each}
        </section>
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Coverage</Card.Title>
          </Card.Header>
          <Card.Content class="text-sm text-muted-foreground">
            Last evaluated {formatRelativeDate(framework.lastEvaluation)}
          </Card.Content>
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Sites Affected</Card.Title>
          </Card.Header>
          <Card.Content class="flex flex-wrap gap-2">
            {#each framework.sitesAffected as siteId}
              <SourceBadge source={siteName(siteId)} />
            {/each}
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading framework...</div>
{/if}
