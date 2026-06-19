<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import EvidencePanel from '$lib/components/domain/evidence-panel.svelte';
  import * as Card from '$lib/components/ui/card';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const personQuery = createQuery(() => ({ queryKey: ['people.byId', id], queryFn: () => trpc.people.byId.query({ id }) }));
  const sitesQuery = createQuery(() => ({ queryKey: ['sites.list'], queryFn: () => trpc.sites.list.query() }));
  const findingsQuery = createQuery(() => ({ queryKey: ['findings.list', { resourceType: 'person' }], queryFn: () => trpc.findings.list.query({ resourceType: 'person' }) }));
  const policiesQuery = createQuery(() => ({ queryKey: ['policies.list'], queryFn: () => trpc.policies.list.query() }));

  const personFindings = $derived((findingsQuery.data ?? []).filter((finding) => finding.resourceId === id));
  const siteName = $derived(personQuery.data ? (sitesQuery.data?.find((site) => site.id === personQuery.data.siteId)?.name ?? 'Unknown site') : '');
  const policyName = (policyId: string) => policiesQuery.data?.find((policy) => policy.id === policyId)?.name ?? 'Policy';
</script>

{#if personQuery.data}
  {@const person = personQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader eyebrow="Person" title={person.displayName} subtitle={`${person.primaryEmail} · ${siteName}`} sources={person.sources} />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-4">
          <MetricCard label="Status" value={person.status} />
          <MetricCard label="Open Findings" value={personFindings.length} />
          <MetricCard label="Sources" value={person.sources.length} />
          <MetricCard label="Licenses" value={person.licenses.length} />
        </div>

        <section class="space-y-3">
          <h2 class="text-sm font-medium">Open Findings</h2>
          {#each personFindings as finding}
            <FindingCard
              {finding}
              siteName={siteName}
              resourceName={person.displayName}
              policyName={policyName(finding.policyId)}
            />
          {/each}
        </section>

        <EvidencePanel summary="Identity and contact source records supporting this person." sources={person.sources} items={person.vendorEvidence} />
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Related Assets / Licenses</Card.Title></Card.Header>
          <Card.Content class="space-y-2 text-sm">
            {#each [...person.relatedAssets, ...person.licenses] as item}
              <div class="rounded-md bg-muted px-3 py-2">{item}</div>
            {/each}
          </Card.Content>
        </Card.Root>
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Applied Policies</Card.Title></Card.Header>
          <Card.Content class="space-y-2 text-sm">
            {#each policiesQuery.data ?? [] as policy}
              <a href={`/policies/${policy.id}`} class="block rounded-md bg-muted px-3 py-2 hover:bg-accent">{policy.name}</a>
            {/each}
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading person...</div>
{/if}
