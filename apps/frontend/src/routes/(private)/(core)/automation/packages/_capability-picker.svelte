<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
  import { Input } from '$lib/components/ui/input';
  import { Search, X } from '@lucide/svelte';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  type Capability = inferRouterOutputs<AppRouter>['packages']['capabilities'][number];
  type Props = {
    open?: boolean;
    target: 'main' | 'onSuccess' | 'onFailure';
    capabilities: Capability[];
    onAdd: (capabilityId: string) => void;
  };

  let { open = $bindable(false), target, capabilities, onAdd }: Props = $props();

  let search = $state('');
  let vendorFilters = $state<string[]>([]);
  let categoryFilters = $state<string[]>([]);

  const catalog = $derived(
    capabilities.map((capability) => ({
      ...capability,
      searchText: [
        capability.name,
        capability.vendor,
        capability.category,
        capability.description,
        capability.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }))
  );
  const vendors = $derived(
    [...new Set(catalog.map((capability) => capability.vendor))].sort((a, b) => a.localeCompare(b))
  );
  const categories = $derived(
    [...new Set(catalog.map((capability) => capability.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    )
  );
  const filteredCapabilities = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return catalog.filter((capability) => {
      if (vendorFilters.length > 0 && !vendorFilters.includes(capability.vendor)) return false;
      if (categoryFilters.length > 0 && !categoryFilters.includes(capability.category))
        return false;
      return !query || capability.searchText.includes(query);
    });
  });

  function toggleFilter(current: string[], value: string) {
    return current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
  }

  function clearFilters() {
    search = '';
    vendorFilters = [];
    categoryFilters = [];
  }

  function formatVendorLabel(value: string) {
    return value.replace(/[_-]+/g, ' ').toUpperCase();
  }

  function formatCategoryLabel(value: string) {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function add(capabilityId: string) {
    onAdd(capabilityId);
    search = '';
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="flex h-[min(88vh,820px)] w-[min(96vw,1320px)] max-w-[min(96vw,1320px)] flex-col overflow-hidden p-0 sm:max-w-[min(96vw,1320px)]"
  >
    <Dialog.Header class="border-b bg-muted/20 px-6 py-5">
      <Dialog.Title class="text-xl font-semibold tracking-tight">
        {target === 'main'
          ? 'Add capability'
          : target === 'onSuccess'
            ? 'Add success reaction'
            : 'Add failure reaction'}
      </Dialog.Title>
      <Dialog.Description>
        {target === 'main'
          ? 'Search the catalog, narrow the list, then insert the next step.'
          : 'Choose the next one-way reaction for this terminal lane.'}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body class="p-0">

    <div class="border-b bg-background px-6 py-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="relative max-w-2xl flex-1">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            oninput={(event) => (search = (event.target as HTMLInputElement).value)}
            placeholder="Search capability, vendor, category, or id"
            class="h-11 rounded-lg border-border/70 pl-9 text-sm"
          />
        </div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span class="rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono"
            >{filteredCapabilities.length} shown</span
          >
          <span class="rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono"
            >{catalog.length} total</span
          >
        </div>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 lg:grid-cols-[280px_1fr]">
      <aside class="flex min-h-0 flex-col border-r bg-muted/[0.18]">
        <div class="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div
              class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Filters
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              {vendorFilters.length + categoryFilters.length} active
            </div>
          </div>
          <button
            type="button"
            class="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onclick={clearFilters}
            disabled={!search && vendorFilters.length === 0 && categoryFilters.length === 0}
            >Clear</button
          >
        </div>
        <ScrollArea.Root class="min-h-0 flex-1">
          <div class="space-y-6 p-5">
            <div class="space-y-3">
              <div
                class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Vendors
              </div>
              <div class="flex flex-wrap gap-2">
                {#each vendors as vendor}
                  <button
                    type="button"
                    class="rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.08em] transition-colors {vendorFilters.includes(
                      vendor
                    )
                      ? 'border-primary/40 bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground/80 hover:border-foreground/20 hover:bg-background'}"
                    onclick={() => (vendorFilters = toggleFilter(vendorFilters, vendor))}
                    >{formatVendorLabel(vendor)}</button
                  >
                {/each}
              </div>
            </div>
            <div class="space-y-3">
              <div
                class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Categories
              </div>
              <div class="flex flex-wrap gap-2">
                {#each categories as category}
                  <button
                    type="button"
                    class="rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors {categoryFilters.includes(
                      category
                    )
                      ? 'border-primary/20 bg-primary/12 text-primary'
                      : 'border-border bg-background text-foreground/80 hover:border-foreground/20 hover:bg-background'}"
                    onclick={() => (categoryFilters = toggleFilter(categoryFilters, category))}
                    >{formatCategoryLabel(category)}</button
                  >
                {/each}
              </div>
            </div>
          </div>
        </ScrollArea.Root>
      </aside>

      <div class="flex min-h-0 flex-col">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/[0.08] px-6 py-3"
        >
          <div class="text-sm font-medium text-foreground">Capability results</div>
          {#if search || vendorFilters.length > 0 || categoryFilters.length > 0}
            <div class="flex flex-wrap items-center gap-2">
              {#each vendorFilters as vendor}
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-primary"
                  >{formatVendorLabel(vendor)}<button
                    type="button"
                    class="text-primary/70 hover:text-primary"
                    onclick={() =>
                      (vendorFilters = vendorFilters.filter((value) => value !== vendor))}
                    aria-label={`Remove ${vendor} vendor filter`}><X class="size-3" /></button
                  ></span
                >
              {/each}
              {#each categoryFilters as category}
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] text-primary"
                  >{formatCategoryLabel(category)}<button
                    type="button"
                    class="text-primary/70 hover:text-primary"
                    onclick={() =>
                      (categoryFilters = categoryFilters.filter((value) => value !== category))}
                    aria-label={`Remove ${category} category filter`}><X class="size-3" /></button
                  ></span
                >
              {/each}
            </div>
          {/if}
        </div>
        <ScrollArea.Root class="min-h-0 flex-1"
          ><div class="p-4 md:p-5">
            {#if filteredCapabilities.length === 0}
              <div class="rounded-xl border border-dashed p-10 text-center">
                {#if catalog.length === 0}
                  <p class="text-sm font-medium">No connected capabilities yet</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Connect an integration and establish any required active link to add its actions here.
                  </p>
                {:else}
                  <p class="text-sm font-medium">No matching capabilities</p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Adjust the search or clear some filters to see more results.
                  </p>
                {/if}
              </div>
            {:else}
              <div class="grid gap-3 xl:grid-cols-2">
                {#each filteredCapabilities as capability (capability.id)}
                  <button
                    type="button"
                    class="w-full rounded-xl border border-border/80 bg-background p-4 text-left transition-colors hover:border-primary/30 hover:bg-muted/20"
                    onclick={() => add(capability.id)}
                  >
                    <div class="flex h-full items-start justify-between gap-4">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-sm font-semibold text-foreground"
                            >{capability.name}</span
                          ><span
                            class="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-background"
                            >{formatVendorLabel(capability.vendor)}</span
                          ><span
                            class="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
                            >{formatCategoryLabel(capability.category)}</span
                          >
                        </div>
                        {#if capability.description}<p
                            class="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground"
                          >
                            {capability.description}
                          </p>{/if}
                        <div class="mt-3 font-mono text-[11px] text-muted-foreground/80">
                          {capability.id}
                        </div>
                      </div>
                      <span
                        class="shrink-0 rounded-full border border-primary/20 bg-primary/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary"
                        >Add</span
                      >
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div></ScrollArea.Root
        >
      </div>
    </div>

    </Dialog.Body></Dialog.Content>
</Dialog.Root>
