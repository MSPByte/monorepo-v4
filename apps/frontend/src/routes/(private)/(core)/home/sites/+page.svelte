<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { ArrowUpRight, Building2, CheckCircle2, Search, TriangleAlert } from '@lucide/svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  let search = $state('');
  let filter = $state<'all' | 'attention' | 'clear'>('all');
  const sitePressure = createQuery(() => ({
    queryKey: ['overview.sitePressure'],
    queryFn: () => trpc.overview.sitePressure.query(),
  }));
  const sites = $derived(sitePressure.data ?? []);
  const attentionCount = $derived(sites.filter((site) => site.openFindingCount > 0).length);
  const visibleSites = $derived(
    sites
      .filter(
        (site) =>
          site.name.toLowerCase().includes(search.trim().toLowerCase()) &&
          (filter === 'all' ||
            (filter === 'attention' ? site.openFindingCount > 0 : site.openFindingCount === 0))
      )
      .sort(
        (a, b) =>
          b.severity.critical - a.severity.critical ||
          b.severity.high - a.severity.high ||
          b.severity.medium - a.severity.medium ||
          b.severity.low - a.severity.low ||
          b.openFindingCount - a.openFindingCount ||
          a.name.localeCompare(b.name)
      )
  );
  const severities = ['critical', 'high', 'medium', 'low'] as const;
</script>

<div class="home-page">
  <header class="home-heading">
    <div>
      <p class="home-eyebrow">Overview / Sites</p>
      <h1>Know where to focus</h1>
      <p>
        Find the sites that need attention. Sites with the most severe open findings appear first.
      </p>
    </div>
  </header>

  {#if sitePressure.isError}
    <section class="home-empty" role="alert">
      <div class="home-empty-icon"><TriangleAlert class="size-6" /></div>
      <h2>Site findings could not be loaded</h2>
      <p>Try again to see which sites need attention.</p>
      <Button
        variant="outline"
        disabled={sitePressure.isFetching}
        onclick={() => sitePressure.refetch()}>Try again</Button
      >
    </section>
  {:else if sitePressure.isPending}
    <div role="status">
      <span class="sr-only">Loading site findings…</span>
      <div class="home-site-grid" aria-hidden="true">
        {#each Array(6) as _}<div
            class="h-40 rounded-xl border bg-card motion-safe:animate-pulse"
          ></div>{/each}
      </div>
    </div>
  {:else if sites.length}
    <div class="home-summary" aria-label="Filter sites by findings">
      <button aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}
        ><strong>{sites.length}</strong><span>All sites</span></button
      >
      <button aria-pressed={filter === 'attention'} onclick={() => (filter = 'attention')}
        ><strong>{attentionCount}</strong><span>With open findings</span></button
      >
      <button aria-pressed={filter === 'clear'} onclick={() => (filter = 'clear')}
        ><strong>{sites.length - attentionCount}</strong><span>No open findings</span></button
      >
    </div>
    <div class="home-section-heading">
      <div>
        <h2>
          {filter === 'attention'
            ? 'Sites with open findings'
            : filter === 'clear'
              ? 'Sites without open findings'
              : 'Your sites'} <span aria-live="polite">{visibleSites.length}</span>
        </h2>
        <p>Select a site to review its details and findings.</p>
      </div>
      <div class="relative w-full sm:w-64">
        <Search class="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          class="bg-card pl-9"
          bind:value={search}
          aria-label="Search sites"
          placeholder="Search sites…"
        />
      </div>
    </div>
    {#if visibleSites.length}
      <div class="home-site-grid">
        {#each visibleSites as site (site.id)}
          <a
            href={`/sites/${site.id}`}
            class="home-site-card"
            data-severity={site.severity.critical
              ? 'critical'
              : site.severity.high
                ? 'high'
                : 'other'}
          >
            <div>
              <div>
                <h3>{site.name}</h3>
                {#if site.openFindingCount === 0}
                  <p class="home-clear"><CheckCircle2 class="size-3.5" />No open findings</p>
                {:else}<p>
                    {site.openFindingCount} open {site.openFindingCount === 1
                      ? 'finding'
                      : 'findings'}
                  </p>{/if}
              </div>
              <ArrowUpRight class="size-4 shrink-0 text-muted-foreground" />
            </div>
            {#if site.openFindingCount > 0}
              <dl class="home-severities">
                {#each severities as severity}
                  <div
                    class={site.severity[severity] > 0
                      ? `home-${severity}`
                      : 'text-muted-foreground'}
                  >
                    <dt class="capitalize">{severity}</dt>
                    <dd>{site.severity[severity]}</dd>
                  </div>
                {/each}
              </dl>
            {/if}
          </a>
        {/each}
      </div>
    {:else}
      <section class="home-empty">
        <div class="home-empty-icon"><Search class="size-6" /></div>
        <h2>No sites match this view</h2>
        <p>Try another site name or clear the filters to see all your sites.</p>
        <Button
          variant="outline"
          onclick={() => {
            search = '';
            filter = 'all';
          }}>Clear filters</Button
        >
      </section>
    {/if}
  {:else}
    <section class="home-empty">
      <div class="home-empty-icon"><Building2 class="size-6" /></div>
      <h2>No sites to show yet</h2>
      <p>Sites you have access to will appear here with their open findings.</p>
    </section>
  {/if}
</div>
