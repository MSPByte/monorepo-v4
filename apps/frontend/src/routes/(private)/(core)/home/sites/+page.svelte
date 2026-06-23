<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Card from '$lib/components/ui/card';
  import { CheckCircle2 } from '@lucide/svelte';
    import Loader from "$lib/components/transition/loader.svelte";
    import FadeIn from "$lib/components/transition/fade-in.svelte";

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const sitePressure = createQuery(() => ({
    queryKey: ['overview.sitePressure'],
    queryFn: () => trpc.overview.sitePressure.query()
  }));

  type Site = NonNullable<typeof sitePressure.data>[number];

  function score(site: Site) {
    return (
      site.severity.critical * 1_000_000 +
      site.severity.high * 10_000 +
      site.severity.medium * 100 +
      site.severity.low
    );
  }

  function sorted(rows: Site[]) {
    return [...rows].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  }
</script>

<div class="size-full overflow-auto">
  <div class="flex flex-col gap-6 p-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Sites</h1>
      <p class="text-sm text-muted-foreground">Pressure matrix sorted by severity weight, then count. Green tiles are clean.</p>
    </div>

    {#if sitePressure.data && sitePressure.data.length > 0}
      <FadeIn class="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {#each sorted(sitePressure.data) as site}
          {@const clean = site.openFindingCount === 0}
          <a
            href={`/sites/${site.id}`}
            class={
              'block rounded-lg border p-3 transition-colors ' +
              (clean
                ? 'border-green-600/40 bg-green-600/5 hover:bg-green-600/10'
                : site.severity.critical > 0
                  ? 'border-red-700/50 bg-red-700/5 hover:bg-red-700/10'
                  : site.severity.high > 0
                    ? 'border-orange-600/50 bg-orange-600/5 hover:bg-orange-600/10'
                    : 'bg-background hover:bg-accent/40')
            }
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{site.name}</div>
                {#if clean}
                  <div class="mt-0.5 flex items-center gap-1 text-xs text-green-700 dark:text-green-500">
                    <CheckCircle2 class="size-3" />
                    All clear
                  </div>
                {:else}
                  <div class="text-xs text-muted-foreground">
                    {site.openFindingCount} open
                  </div>
                {/if}
              </div>
              {#if !clean}
                <div class="text-xl font-semibold leading-none">{site.openFindingCount}</div>
              {/if}
            </div>

            {#if !clean}
              <div class="mt-3 grid grid-cols-4 gap-1 text-center text-[11px]">
                <div class={'rounded py-1 ' + (site.severity.critical > 0 ? 'bg-red-700/15 text-red-700 dark:text-red-400' : 'bg-muted/40 text-muted-foreground')}>
                  <div class="font-semibold">{site.severity.critical}</div>
                  <div>C</div>
                </div>
                <div class={'rounded py-1 ' + (site.severity.high > 0 ? 'bg-orange-600/15 text-orange-700 dark:text-orange-400' : 'bg-muted/40 text-muted-foreground')}>
                  <div class="font-semibold">{site.severity.high}</div>
                  <div>H</div>
                </div>
                <div class={'rounded py-1 ' + (site.severity.medium > 0 ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' : 'bg-muted/40 text-muted-foreground')}>
                  <div class="font-semibold">{site.severity.medium}</div>
                  <div>M</div>
                </div>
                <div class={'rounded py-1 ' + (site.severity.low > 0 ? 'bg-muted text-foreground' : 'bg-muted/40 text-muted-foreground')}>
                  <div class="font-semibold">{site.severity.low}</div>
                  <div>L</div>
                </div>
              </div>
            {/if}
          </a>
        {/each}
        </FadeIn>
    {:else if sitePressure.data}
      <Card.Root class="rounded-lg">
        <Card.Content class="py-12 text-center text-sm text-muted-foreground">
          No sites yet.
        </Card.Content>
      </Card.Root>
    {:else}
      <Loader />
    {/if}
  </div>
</div>
