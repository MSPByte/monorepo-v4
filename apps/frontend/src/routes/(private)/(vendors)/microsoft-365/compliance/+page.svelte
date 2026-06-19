<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const integrationId = 'microsoft-365';

  const frameworksQuery = createQuery(() => ({
    queryKey: ['compliance.frameworks', integrationId, scopeStore.currentLink],
    queryFn: () =>
      trpc.compliance.frameworks.query({
        integrationId,
        linkId: scopeStore.currentLink || undefined,
      }),
  }));

  const frameworks = $derived(frameworksQuery.data ?? []);

  let selectedFrameworkId = $state<string | null>(null);
  let statusFilter = $state<'fail' | 'pass' | 'all'>('fail');

  $effect(() => {
    if (frameworks.length > 0 && !selectedFrameworkId) {
      selectedFrameworkId = frameworks[0].id;
    }
  });

  $effect(() => {
    // Reset selection when scope changes
    scopeStore.currentLink;
    selectedFrameworkId = null;
    statusFilter = 'fail';
  });

  const resultsQuery = createQuery(() => ({
    queryKey: [
      'compliance.results',
      selectedFrameworkId,
      integrationId,
      scopeStore.currentSite,
      scopeStore.currentLink,
    ],
    queryFn: () =>
      trpc.compliance.results.query({
        frameworkId: selectedFrameworkId!,
        integrationId,
        siteId: scopeStore.currentSite ?? undefined,
        linkId: scopeStore.currentLink || undefined,
      }),
    enabled: !!selectedFrameworkId,
  }));

  const results = $derived(resultsQuery.data ?? []);

  const passCount = $derived(results.filter((r) => r.result?.status === 'pass').length);
  const failCount = $derived(results.filter((r) => r.result?.status === 'fail').length);
  const unknownCount = $derived(
    results.filter((r) => !r.result || (r.result.status !== 'pass' && r.result.status !== 'fail'))
      .length
  );
  const total = $derived(results.length);
  const passRate = $derived(total > 0 ? Math.round((passCount / total) * 100) : 0);

  const filteredResults = $derived.by(() => {
    if (statusFilter === 'all') return results;
    return results.filter((r) => {
      if (statusFilter === 'fail') return r.result?.status === 'fail' || !r.result;
      if (statusFilter === 'pass') return r.result?.status === 'pass';
      return true;
    });
  });

  function passRateClass(rate: number) {
    if (rate >= 80) return 'text-success';
    if (rate >= 50) return 'text-warning';
    return 'text-destructive';
  }

  function passRateBarColor(rate: number) {
    if (rate >= 80) return 'var(--success)';
    if (rate >= 50) return 'var(--warning)';
    return 'var(--destructive)';
  }

  const SEVERITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
</script>

<div class="flex flex-col size-full gap-4 p-4 overflow-hidden">
  <h1 class="text-2xl font-bold shrink-0">Compliance</h1>

  {#if frameworksQuery.isPending}
    <Loader />
  {:else if frameworks.length === 0}
    <FadeIn class="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
      <div class="text-sm font-medium">No compliance frameworks found</div>
      <div class="text-xs">Configure frameworks in the compliance settings</div>
    </FadeIn>
  {:else}
    <!-- Summary cards -->
    <FadeIn class="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <span class="text-xs text-muted-foreground">Pass Rate</span>
        <span class="text-2xl font-bold tabular-nums {passRateClass(passRate)}">{passRate}%</span>
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <span class="text-xs text-muted-foreground">Passing</span>
        <span class="text-2xl font-bold tabular-nums text-success">{passCount}</span>
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <span class="text-xs text-muted-foreground">Failing</span>
        <span class="text-2xl font-bold tabular-nums {failCount > 0 ? 'text-destructive' : ''}"
          >{failCount}</span
        >
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <span class="text-xs text-muted-foreground">Unknown</span>
        <span class="text-2xl font-bold tabular-nums">{unknownCount}</span>
      </div>
    </FadeIn>

    <!-- Two-panel layout -->
    <FadeIn class="flex size-full gap-4 items-start overflow-hidden min-h-0">
      <!-- Left: framework selector -->
      <div class="flex flex-col gap-2 w-52 shrink-0 overflow-y-auto h-full">
        {#each frameworks as fw (fw.id)}
          {@const isActive = selectedFrameworkId === fw.id}
          <button
            class="text-left rounded-lg border p-3 transition-colors {isActive
              ? 'bg-primary/10 border-primary/30'
              : 'bg-card hover:border-primary/20 hover:bg-primary/5'}"
            onclick={() => {
              selectedFrameworkId = fw.id;
              statusFilter = 'fail';
            }}
          >
            <div class="font-medium text-sm leading-tight">{fw.name}</div>
          </button>
        {/each}
      </div>

      <!-- Right: checks + results -->
      <div class="min-w-0 flex flex-col size-full gap-3 overflow-y-auto">
        {#if selectedFrameworkId}
          <!-- Filter toggle -->
          <div class="flex items-center justify-between gap-2 shrink-0">
            <div class="flex items-center gap-2">
              {#each frameworks as fw (fw.id)}
                {#if fw.id === selectedFrameworkId}
                  <span class="font-semibold">{fw.name}</span>
                {/if}
              {/each}
              <span class="text-sm text-muted-foreground">{passRate}% pass rate</span>
            </div>
            <div class="flex items-center rounded-md border overflow-hidden text-xs shrink-0">
              <button
                class="px-3 py-1.5 transition-colors {statusFilter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'}"
                onclick={() => (statusFilter = 'all')}>All</button
              >
              <button
                class="px-3 py-1.5 transition-colors border-x {statusFilter === 'fail'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'}"
                onclick={() => (statusFilter = 'fail')}>Failures</button
              >
              <button
                class="px-3 py-1.5 transition-colors {statusFilter === 'pass'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'}"
                onclick={() => (statusFilter = 'pass')}>Passing</button
              >
            </div>
          </div>

          {#if resultsQuery.isPending}
            <Loader />
          {:else if filteredResults.length === 0}
            <FadeIn class="text-sm text-muted-foreground py-4">
              {statusFilter === 'fail'
                ? 'No failing checks for this framework.'
                : statusFilter === 'pass'
                  ? 'No passing checks for this framework.'
                  : 'No checks configured for this framework.'}
            </FadeIn>
          {:else}
            {#each filteredResults
              .slice()
              .sort((a, b) => (SEVERITY_ORDER[a.check.severity ?? ''] ?? 99) - (SEVERITY_ORDER[b.check.severity ?? ''] ?? 99)) as item (`${item.check.id}:${item.link?.id ?? 'scope'}`)}
              {@const status = item.result?.status ?? 'unknown'}
              <FadeIn class="rounded-lg border p-3 flex flex-col gap-1.5">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <span class="font-medium text-sm">{item.check.name}</span>
                    {#if item.check.description}
                      <span class="text-xs text-muted-foreground">{item.check.description}</span>
                    {/if}
                    {#if item.link}
                      <span class="text-xs text-muted-foreground"
                        >{item.link.name ?? item.link.externalId ?? 'Unknown tenant'}</span
                      >
                    {/if}
                  </div>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium shrink-0 {status ===
                    'pass'
                      ? 'bg-success/15 text-success'
                      : status === 'fail'
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-muted text-muted-foreground'}"
                  >
                    {status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Unknown'}
                  </span>
                </div>
                {#if item.check.severity}
                  <span class="text-xs text-muted-foreground capitalize"
                    >{item.check.severity} severity</span
                  >
                {/if}
              </FadeIn>
            {/each}
          {/if}
        {/if}
      </div>
    </FadeIn>
  {/if}
</div>
