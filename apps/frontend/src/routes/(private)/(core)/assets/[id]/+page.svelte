<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import EvidencePanel from '$lib/components/domain/evidence-panel.svelte';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import * as Card from '$lib/components/ui/card';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const assetQuery = createQuery(() => ({ queryKey: ['assets.byId', id], queryFn: () => trpc.assets.byId.query({ id }) }));
  const sitesQuery = createQuery(() => ({ queryKey: ['sites.list'], queryFn: () => trpc.sites.list.query() }));
  const findingsQuery = createQuery(() => ({ queryKey: ['findings.list', { resourceType: 'asset' }], queryFn: () => trpc.findings.list.query({ resourceType: 'asset' }) }));
  const policiesQuery = createQuery(() => ({ queryKey: ['policies.list'], queryFn: () => trpc.policies.list.query() }));

  const assetFindings = $derived((findingsQuery.data ?? []).filter((finding) => finding.resourceId === id));
  const siteName = $derived(assetQuery.data ? (sitesQuery.data?.find((site) => site.id === assetQuery.data.siteId)?.name ?? 'Unknown site') : '');
  const policyName = (policyId: string) => policiesQuery.data?.find((policy) => policy.id === policyId)?.name ?? 'Policy';
</script>

{#if assetQuery.data}
  {@const asset = assetQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader eyebrow="Asset" title={asset.hostname} subtitle={`${asset.type} · ${asset.os} · ${siteName}`} sources={asset.sources} />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-4">
          <MetricCard label="Status" value={asset.status} />
          <MetricCard label="Open Findings" value={assetFindings.length} />
          <MetricCard label="Sources" value={asset.sources.length} />
          <MetricCard label="Site" value={siteName} />
        </div>

        <section class="space-y-3">
          <h2 class="text-sm font-medium">Open Findings</h2>
          {#each assetFindings as finding}
            <FindingCard
              {finding}
              siteName={siteName}
              resourceName={asset.hostname}
              policyName={policyName(finding.policyId)}
            />
          {/each}
        </section>

        <EvidencePanel summary="Vendor source records supporting this canonical asset." sources={asset.sources} items={asset.vendorEvidence} />
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Applied Policies</Card.Title></Card.Header>
          <Card.Content class="space-y-2 text-sm">
            {#each policiesQuery.data ?? [] as policy}
              <a href={`/policies/${policy.id}`} class="block rounded-md bg-muted px-3 py-2 hover:bg-accent">{policy.name}</a>
            {/each}
          </Card.Content>
        </Card.Root>
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Related People / Services</Card.Title></Card.Header>
          <Card.Content class="space-y-2 text-sm">
            {#each asset.relatedPeople as person}
              <div class="rounded-md bg-muted px-3 py-2">{person}</div>
            {/each}
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading asset...</div>
{/if}
