<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import EvidencePanel from '$lib/components/domain/evidence-panel.svelte';
  import * as Card from '$lib/components/ui/card';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const findingQuery = createQuery(() => ({
    queryKey: ['findings.byId', id],
    queryFn: () => trpc.findings.byId.query({ id }),
  }));
  const sitesQuery = createQuery(() => ({ queryKey: ['sites.list'], queryFn: () => trpc.sites.list.query() }));
  const policiesQuery = createQuery(() => ({ queryKey: ['policies.list'], queryFn: () => trpc.policies.list.query() }));
  const assetsQuery = createQuery(() => ({ queryKey: ['assets.list'], queryFn: () => trpc.assets.list.query() }));
  const peopleQuery = createQuery(() => ({ queryKey: ['people.list'], queryFn: () => trpc.people.list.query() }));

  const siteName = $derived(
    findingQuery.data ? (sitesQuery.data?.find((site) => site.id === findingQuery.data.siteId)?.name ?? 'Unknown site') : ''
  );
  const policyName = $derived(
    findingQuery.data ? (policiesQuery.data?.find((policy) => policy.id === findingQuery.data.policyId)?.name ?? 'Policy') : ''
  );
  const resourceName = $derived.by(() => {
    const finding = findingQuery.data;
    if (!finding) return '';
    if (finding.resourceType === 'asset') return assetsQuery.data?.find((asset) => asset.id === finding.resourceId)?.hostname ?? finding.resourceId;
    if (finding.resourceType === 'person') return peopleQuery.data?.find((person) => person.id === finding.resourceId)?.displayName ?? finding.resourceId;
    return finding.resourceId;
  });
</script>

{#if findingQuery.data}
  {@const finding = findingQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader
      eyebrow="Finding"
      title={finding.title}
      subtitle={`${siteName} · ${resourceName} · ${policyName}`}
      sources={finding.vendorSources ?? []}
    />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <div class="flex flex-wrap gap-2">
              <FindingSeverityBadge severity={finding.severity} />
              <FindingStatusBadge status={finding.status} />
            </div>
            <Card.Title>Finding Summary</Card.Title>
            <Card.Description>Last seen {formatRelativeDate(finding.lastSeenAt)}</Card.Description>
          </Card.Header>
          <Card.Content class="space-y-3 text-sm">
            <div>
              <div class="text-xs text-muted-foreground">Affected resource</div>
              <div>{resourceName}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Site</div>
              <a href={`/sites/${finding.siteId}`} class="hover:underline">{siteName}</a>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Policy</div>
              <a href={`/policies/${finding.policyId}`} class="hover:underline">{policyName}</a>
            </div>
          </Card.Content>
        </Card.Root>

        <EvidencePanel
          summary={finding.evidenceSummary}
          sources={finding.vendorSources ?? []}
          items={finding.timeline ?? []}
        />
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Recommendation</Card.Title>
          </Card.Header>
          <Card.Content class="text-sm text-muted-foreground">{finding.recommendation}</Card.Content>
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Timeline</Card.Title>
          </Card.Header>
          <Card.Content class="space-y-2 text-sm">
            {#each finding.timeline ?? [] as item}
              <div class="rounded-md bg-muted px-3 py-2">{item}</div>
            {/each}
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading finding...</div>
{/if}
