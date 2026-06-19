<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');
  const policyQuery = createQuery(() => ({ queryKey: ['policies.byId', id], queryFn: () => trpc.policies.byId.query({ id }) }));
  const findingsQuery = createQuery(() => ({ queryKey: ['findings.list', { policyId: id }], queryFn: () => trpc.findings.list.query({ policyId: id }) }));
</script>

{#if policyQuery.data}
  {@const policy = policyQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader eyebrow="Policy" title={policy.name} subtitle={policy.description} sources={[policy.source, policy.scope]} />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-4">
          <MetricCard label="Open Findings" value={findingsQuery.data?.length ?? policy.openFindingCount} />
          <MetricCard label="Severity" value={policy.severity} />
          <MetricCard label="Category" value={policy.category} />
          <MetricCard label="Enabled" value={policy.enabled ? 'Yes' : 'No'} />
        </div>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <div><FindingSeverityBadge severity={policy.severity} /></div>
            <Card.Title>Expectation</Card.Title>
          </Card.Header>
          <Card.Content class="text-sm text-muted-foreground">{policy.expectation}</Card.Content>
        </Card.Root>

        <section class="space-y-3">
          <h2 class="text-sm font-medium">Example Findings</h2>
          {#each findingsQuery.data ?? policy.exampleFindings ?? [] as finding}
            <FindingCard {finding} />
          {/each}
        </section>
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Framework Membership</Card.Title></Card.Header>
          <Card.Content class="flex flex-wrap gap-2">
            {#each policy.frameworkMembership as framework}
              <SourceBadge source={framework} />
            {/each}
          </Card.Content>
        </Card.Root>
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Evaluation</Card.Title></Card.Header>
          <Card.Content class="text-sm text-muted-foreground">
            Last evaluated {formatRelativeDate(policy.lastEvaluation)}
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading policy...</div>
{/if}
