<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import { formatRelativeDate, formatStringProper } from '$lib/utils/format';
    import Loader from "$lib/components/transition/loader.svelte";
    import FadeIn from "$lib/components/transition/fade-in.svelte";

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const rollups = createQuery(() => ({
    queryKey: ['overview.findingRollups'],
    queryFn: () => trpc.overview.findingRollups.query()
  }));

  type Rollup = NonNullable<typeof rollups.data>[number];

  let groupBy = $state<'policy' | 'resource' | 'severity'>('policy');

  function groupedByResource(rows: Rollup[]) {
    const map = new Map<string, { resourceType: string; count: number; maxSeverity: number; siteCount: number; policies: number }>();
    for (const row of rows) {
      const key = row.resourceType || 'unknown';
      const entry = map.get(key) ?? { resourceType: key, count: 0, maxSeverity: 0, siteCount: 0, policies: 0 };
      entry.count += row.count;
      entry.maxSeverity = Math.max(entry.maxSeverity, row.maxSeverity);
      entry.siteCount = Math.max(entry.siteCount, row.siteCount);
      entry.policies += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.maxSeverity - a.maxSeverity || b.count - a.count);
  }

  function groupedBySeverity(rows: Rollup[]) {
    const map = new Map<number, { severity: number; count: number; policies: number }>();
    for (const row of rows) {
      const entry = map.get(row.maxSeverity) ?? { severity: row.maxSeverity, count: 0, policies: 0 };
      entry.count += row.count;
      entry.policies += 1;
      map.set(row.maxSeverity, entry);
    }
    return [...map.values()].sort((a, b) => b.severity - a.severity);
  }
</script>

<div class="size-full overflow-auto">
  <div class="flex flex-col gap-6 p-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-normal">Findings rollup</h1>
        <p class="text-sm text-muted-foreground">Group the workload before you dig in. Use /findings for the full table.</p>
      </div>
      <div class="flex gap-1 rounded-md border p-1 text-xs">
        {#each [{ k: 'policy', label: 'By policy' }, { k: 'resource', label: 'By resource' }, { k: 'severity', label: 'By severity' }] as choice}
          <button
            type="button"
            class={
              'rounded px-2.5 py-1 transition-colors ' +
              (groupBy === choice.k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')
            }
            onclick={() => (groupBy = choice.k as typeof groupBy)}
          >{choice.label}</button>
        {/each}
      </div>
    </div>

    {#if rollups.data && rollups.data.length > 0}
      {#if groupBy === 'policy'}
        <FadeIn class="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {#each rollups.data as rollup}
            <a
              href={`/findings?policyId=${encodeURIComponent(rollup.policyId)}`}
              class="block rounded-lg border bg-background p-4 transition-colors hover:bg-accent/40"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="font-medium leading-tight truncate">{rollup.policyName}</div>
                  <div class="text-2xl font-semibold">{rollup.count}</div>
                  <div class="text-xs text-muted-foreground">
                    {rollup.siteCount} {rollup.siteCount === 1 ? 'site' : 'sites'} · {formatStringProper(rollup.resourceType ?? 'resource')} · last seen {formatRelativeDate(rollup.lastSeenAt)}
                  </div>
                </div>
                <FindingSeverityBadge severity={rollup.maxSeverity} />
              </div>
            </a>
          {/each}
        </FadeIn>
      {:else if groupBy === 'resource'}
        <FadeIn class="grid gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {#each groupedByResource(rollups.data) as group}
            <Card.Root class="rounded-lg">
              <Card.Header class="pb-2">
                <Card.Description>{formatStringProper(group.resourceType)}</Card.Description>
                <Card.Title class="text-2xl">{group.count}</Card.Title>
              </Card.Header>
              <Card.Content class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{group.policies} {group.policies === 1 ? 'policy' : 'policies'}</span>
                <FindingSeverityBadge severity={group.maxSeverity} />
              </Card.Content>
            </Card.Root>
          {/each}
        </FadeIn>
      {:else}
        <FadeIn class="grid gap-3 sm:grid-cols-4">
          {#each groupedBySeverity(rollups.data) as bucket}
            <Card.Root class="rounded-lg">
              <Card.Header class="pb-2">
                <Card.Description>
                  <FindingSeverityBadge severity={bucket.severity} />
                </Card.Description>
                <Card.Title class="text-2xl">{bucket.count}</Card.Title>
              </Card.Header>
              <Card.Content class="text-xs text-muted-foreground">
                {bucket.policies} {bucket.policies === 1 ? 'policy' : 'policies'}
              </Card.Content>
            </Card.Root>
          {/each}
        </FadeIn>
      {/if}
    {:else if rollups.data}
      <Card.Root class="rounded-lg">
        <Card.Content class="py-12 text-center text-sm text-muted-foreground">
          No open findings — nothing to roll up.
        </Card.Content>
      </Card.Root>
    {:else}
      <Loader />
    {/if}
  </div>
</div>
