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

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const siteQuery = createQuery(() => ({
    queryKey: ['sites.byId', id],
    queryFn: () => trpc.sites.byId.query({ id }),
  }));
  const findingsQuery = createQuery(() => ({
    queryKey: ['findings.list', { siteId: id }],
    queryFn: () => trpc.findings.list.query({ siteId: id }),
  }));
  const assetsQuery = createQuery(() => ({ queryKey: ['assets.list'], queryFn: () => trpc.assets.list.query() }));
  const peopleQuery = createQuery(() => ({ queryKey: ['people.list'], queryFn: () => trpc.people.list.query() }));
  const policiesQuery = createQuery(() => ({ queryKey: ['policies.list'], queryFn: () => trpc.policies.list.query() }));

  const siteAssets = $derived((assetsQuery.data ?? []).filter((asset) => asset.siteId === id));
  const sitePeople = $derived((peopleQuery.data ?? []).filter((person) => person.siteId === id));
  const policyName = (policyId: string) => policiesQuery.data?.find((policy) => policy.id === policyId)?.name ?? 'Policy';
</script>

{#if siteQuery.data}
  {@const site = siteQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader eyebrow="Site" title={site.name} subtitle={site.description ?? ''} sources={site.sources ?? []} />
    <div class="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div class="grid gap-4 md:grid-cols-5">
        <MetricCard label="Open Findings" value={findingsQuery.data?.length ?? 0} />
        <MetricCard label="Assets" value={siteAssets.length} />
        <MetricCard label="People" value={sitePeople.length} />
        <MetricCard label="Framework Score" value={`${site.frameworkScore ?? 100}%`} />
        <MetricCard label="Policy Health" value={`${site.policyHealth ?? 100}%`} />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section class="space-y-3">
          <h2 class="text-sm font-medium">Open Findings</h2>
          {#each findingsQuery.data ?? [] as finding}
            <FindingCard
              {finding}
              siteName={site.name}
              resourceName={finding.resourceId}
              policyName={policyName(finding.policyId)}
            />
          {/each}
        </section>

        <div class="space-y-4">
          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Integrations / Sources</Card.Title>
            </Card.Header>
            <Card.Content class="flex flex-wrap gap-2">
              {#each site.sources ?? [] as source}
                <SourceBadge {source} />
              {/each}
            </Card.Content>
          </Card.Root>

          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Recent Activity</Card.Title>
            </Card.Header>
            <Card.Content class="space-y-2 text-sm">
              {#each site.recentActivity ?? [] as activity}
                <div class="rounded-md bg-muted px-3 py-2">{activity}</div>
              {/each}
            </Card.Content>
          </Card.Root>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading site...</div>
{/if}
