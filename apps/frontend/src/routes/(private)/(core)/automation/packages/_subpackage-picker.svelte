<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
  import { Input } from '$lib/components/ui/input';
  import { Search, Package } from '@lucide/svelte';

  type PackageOption = {
    id: string;
    name: string;
    description?: string | null;
    status: 'draft' | 'active' | 'archived';
  };

  type Props = {
    open?: boolean;
    packages: PackageOption[];
    // Packages that must be filtered out — the package currently being edited
    // (can't self-reference) and any that would form a cycle.
    excludeIds?: string[];
    onAdd: (packageId: string) => void;
  };

  let { open = $bindable(false), packages, excludeIds = [], onAdd }: Props = $props();

  let search = $state('');

  const excludeSet = $derived(new Set(excludeIds));
  const filtered = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return packages
      .filter((p) => p.status === 'active')
      .filter((p) => !excludeSet.has(p.id))
      .filter((p) => {
        if (!query) return true;
        return (
          p.name.toLowerCase().includes(query) ||
          (p.description ?? '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  function add(id: string) {
    onAdd(id);
    search = '';
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="flex h-[min(80vh,720px)] w-[min(92vw,760px)] max-w-[min(92vw,760px)] flex-col overflow-hidden p-0 sm:max-w-[min(92vw,760px)]"
  >
    <Dialog.Header class="border-b bg-muted/20 px-6 py-5">
      <Dialog.Title class="text-xl font-semibold tracking-tight">Add sub-package</Dialog.Title>
      <Dialog.Description>
        Choose an active package to embed as a step. Its prompts become this step's inputs; its
        exposed outputs can be wired to later steps.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body class="p-0">

    <div class="border-b bg-background px-6 py-4">
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          oninput={(event) => (search = (event.target as HTMLInputElement).value)}
          placeholder="Search packages"
          class="h-11 rounded-lg border-border/70 pl-9 text-sm"
        />
      </div>
    </div>

    <ScrollArea.Root class="min-h-0 flex-1">
      <div class="space-y-2 p-5">
        {#if filtered.length === 0}
          <div class="rounded-xl border border-dashed p-10 text-center">
            <p class="text-sm font-medium">No active packages available</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Only active packages that don't cycle with this one can be embedded.
            </p>
          </div>
        {:else}
          {#each filtered as pkg (pkg.id)}
            <button
              type="button"
              class="w-full rounded-lg border border-border/80 bg-background p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/20"
              onclick={() => add(pkg.id)}
            >
              <div class="flex items-start gap-3">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60">
                  <Package class="size-4 text-muted-foreground" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-semibold">{pkg.name}</div>
                  {#if pkg.description}
                    <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{pkg.description}</p>
                  {/if}
                </div>
                <span
                  class="shrink-0 rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary"
                >
                  Add
                </span>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </ScrollArea.Root>

    </Dialog.Body></Dialog.Content>
</Dialog.Root>
