<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { Plus, Layers, ArrowUpRight, Search, ChevronLeft, ChevronRight } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const canManage = $derived(authStore.isAllowed('Frameworks.Write'));
  const search = $derived(page.url.searchParams.get('search') ?? '');
  const status = $derived(page.url.searchParams.get('status') ?? 'all');
  const sort = $derived(page.url.searchParams.get('sort') ?? 'findings');
  const currentPage = $derived(
    Math.max(1, Math.min(100000, Math.floor(Number(page.url.searchParams.get('page')) || 1)))
  );
  let searchDraft = $state('');
  $effect(() => {
    searchDraft = search;
  });
  const input = $derived({
    page: currentPage,
    pageSize: 12,
    globalSearch: search || undefined,
    globalSearchColumns: ['name', 'description'],
    sortColumn: sort === 'name' ? 'name' : sort === 'policies' ? 'policyCount' : 'openFindings',
    sortDirection: sort === 'name' ? ('asc' as const) : ('desc' as const),
    filters:
      status === 'enabled' || status === 'disabled'
        ? [{ column: 'enabled', operator: 'eq' as const, value: status === 'enabled' }]
        : [],
  });
  const frameworksQuery = createQuery(() => ({
    queryKey: ['frameworks.tableData', input],
    queryFn: () => trpc.frameworks.tableData.query(input),
  }));
  function updateSearch(values: Record<string, string>) {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    void goto(url, { noScroll: true, keepFocus: true });
  }
</script>

<svelte:head><title>Frameworks · MSPByte</title></svelte:head>
<div class="size-full overflow-auto">
  <div class="framework-page">
    <header class="framework-heading">
      <div>
        <p class="framework-eyebrow">Compliance / Frameworks</p>
        <h1>Frameworks</h1>
        <p class="framework-description">
          Define your standards, assign them to customers, and keep track of the policies that need
          attention.
        </p>
      </div>
      {#if canManage}<Button href="/frameworks/builder"
          ><Plus class="size-4" />Create framework</Button
        >{/if}
    </header>
    <div class="framework-toolbar">
      <h2>
        Framework library {#if frameworksQuery.data}<span
            class="ml-2 text-xs font-normal text-muted-foreground"
            >{frameworksQuery.data.total}</span
          >{/if}
      </h2>
      <div class="framework-filters">
        <form
          class="flex gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            updateSearch({ search: searchDraft.trim() });
          }}
        >
          <Input
            aria-label="Search frameworks"
            placeholder="Search frameworks…"
            bind:value={searchDraft}
            class="w-full sm:w-56"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="Search"
            ><Search class="size-4" /></Button
          >
        </form>
        <SingleSelect
          class="w-36"
          aria-label="Framework status"
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'disabled', label: 'Disabled' },
          ]}
          selected={status}
          allowClear={false}
          onchange={(value) => updateSearch({ status: value })}
        />
        <SingleSelect
          class="w-48"
          aria-label="Sort frameworks"
          options={[
            { value: 'findings', label: 'Most open findings' },
            { value: 'name', label: 'Name A–Z' },
            { value: 'policies', label: 'Most policies' },
          ]}
          selected={sort}
          allowClear={false}
          onchange={(value) => updateSearch({ sort: value })}
        />
      </div>
    </div>
    {#if search || status !== 'all'}<div
        class="mb-4 flex items-center gap-3 text-xs text-muted-foreground"
      >
        <span>{search ? `Results for “${search}”` : 'Filtered frameworks'}</span><Button
          size="xs"
          variant="ghost"
          onclick={() => updateSearch({ search: '', status: '' })}>Clear filters</Button
        >
      </div>{/if}
    {#if frameworksQuery.isError}
      <div class="framework-state" role="alert">
        <h2>Frameworks couldn’t be loaded</h2>
        <p>Try again to refresh the library.</p>
        <Button variant="outline" onclick={() => frameworksQuery.refetch()}>Try again</Button>
      </div>
    {:else if frameworksQuery.isPending}
      <div class="framework-state" role="status">
        <Layers class="size-6 text-primary" />
        <p>Loading frameworks…</p>
      </div>
    {:else if !frameworksQuery.data?.rows.length}
      <div class="framework-state">
        <span class="framework-icon"><Layers class="size-5" /></span>
        <h2>
          {search || status !== 'all' || currentPage > 1
            ? 'No frameworks match this view'
            : 'Build your first framework'}
        </h2>
        <p>
          {search || status !== 'all' || currentPage > 1
            ? 'Try a different search or clear the filters to see your library.'
            : 'Start with a standard your customers share, then add policies and choose where they apply.'}
        </p>
        {#if search || status !== 'all' || currentPage > 1}<Button
            variant="outline"
            onclick={() => updateSearch({ search: '', status: '' })}>Reset view</Button
          >{:else if canManage}<Button href="/frameworks/builder"
            ><Plus class="size-4" />Create framework</Button
          >{/if}
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border bg-card">
        <div class="framework-library-columns framework-library-labels" aria-hidden="true">
          <span>Framework</span><span>Status</span><span>Policies</span><span>Open findings</span
          ><span></span>
        </div>
        <ul aria-label="Framework library" class="divide-y">
          {#each frameworksQuery.data.rows as framework (framework.id)}
            <li>
              <a
                class="framework-library-columns framework-library-row"
                href={`/frameworks/${framework.id}`}
              >
                <div class="flex min-w-0 items-center gap-3">
                  <span
                    class="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground"
                    ><Layers class="size-4" /></span
                  >
                  <div class="min-w-0">
                    <h3 class="truncate text-sm font-medium" title={framework.name}>
                      {framework.name}
                    </h3>
                    <p class="mt-1 truncate text-xs text-muted-foreground">
                      {framework.description || framework.category || 'No description added'}
                    </p>
                  </div>
                </div>
                <div>
                  <Badge variant={framework.enabled ? 'secondary' : 'outline'}
                    >{framework.enabled ? 'Enabled' : 'Disabled'}</Badge
                  >
                </div>
                <div class="framework-library-metric">
                  <span class="tabular-nums">{framework.policyCount}</span><span
                    class="text-xs text-muted-foreground md:hidden"
                  >
                    policies</span
                  >{#if !framework.policyCount}<span
                      class="ml-2 text-xs text-muted-foreground max-md:hidden">Not set up</span
                    >{/if}
                </div>
                <div class="framework-library-metric">
                  <span
                    class={framework.openFindings
                      ? 'font-medium tabular-nums text-warning'
                      : 'tabular-nums text-muted-foreground'}>{framework.openFindings}</span
                  ><span class="text-xs text-muted-foreground md:hidden"> open findings</span>
                </div>
                <ArrowUpRight class="size-4 text-muted-foreground max-md:hidden" />
              </a>
            </li>
          {/each}
        </ul>
      </div>
      <div class="framework-pagination">
        <span
          >Showing {(currentPage - 1) * 12 + 1}–{Math.min(
            currentPage * 12,
            frameworksQuery.data.total
          )} of {frameworksQuery.data.total} frameworks</span
        >
        <div class="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onclick={() => updateSearch({ page: String(currentPage - 1) })}
            ><ChevronLeft class="size-4" />Previous</Button
          ><span
            >Page {currentPage} of {Math.max(1, Math.ceil(frameworksQuery.data.total / 12))}</span
          ><Button
            variant="outline"
            size="sm"
            disabled={currentPage * 12 >= frameworksQuery.data.total}
            onclick={() => updateSearch({ page: String(currentPage + 1) })}
            >Next<ChevronRight class="size-4" /></Button
          >
        </div>
      </div>
    {/if}
  </div>
</div>
