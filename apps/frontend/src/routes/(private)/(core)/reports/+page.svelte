<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Card from '$lib/components/ui/card';
  import Badge from '$lib/components/ui/badge/badge.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const reportsQuery = createQuery(() => ({
    queryKey: ['reports.list'],
    queryFn: () => trpc.reports.list.query(),
  }));
</script>

<div class="size-full overflow-auto">
  <div class="mx-auto flex max-w-7xl flex-col gap-5 p-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Reports</h1>
      <p class="text-sm text-muted-foreground">Report scaffolds built around findings, sites, policies, and evidence.</p>
    </div>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each reportsQuery.data ?? [] as report}
        <Card.Root class="rounded-lg">
          <Card.Header>
            <div><Badge variant="outline">{report.category}</Badge></div>
            <Card.Title>{report.name}</Card.Title>
            <Card.Description>{report.description}</Card.Description>
          </Card.Header>
          <Card.Content>
            <Badge variant="secondary">{report.status}</Badge>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  </div>
</div>
