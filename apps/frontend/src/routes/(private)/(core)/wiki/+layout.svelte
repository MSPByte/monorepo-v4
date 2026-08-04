<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import Button from '$lib/components/ui/button/button.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import { cn } from '$lib/utils';

  import BookMarked from '@lucide/svelte/icons/book-marked';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
  import FileText from '@lucide/svelte/icons/file-text';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Hash from '@lucide/svelte/icons/hash';
  import House from '@lucide/svelte/icons/house';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import Search from '@lucide/svelte/icons/search';
  import Tag from '@lucide/svelte/icons/tag';

  import SearchModal from './_search-modal.svelte';
  import { wikiState } from './_wiki-state.svelte.js';
  import {
    getAllDescendantIds,
    getContextChildren,
    getContextPath
  } from './_wiki-utils.js';

  const { children } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const contextsQuery = createQuery(() => ({
    queryKey: ['wiki.contexts.list'],
    queryFn: () => trpc.wiki.contexts.list.query()
  }));

  const articlesQuery = createQuery(() => ({
    queryKey: ['wiki.articles.list'],
    queryFn: () => trpc.wiki.articles.list.query()
  }));

  const allContexts = $derived(contextsQuery.data ?? []);
  const allArticles = $derived(articlesQuery.data ?? []);
  const rootContexts = $derived(getContextChildren(null, allContexts));

  const contextCount = $derived(allContexts.length);
  const articleCount = $derived(allArticles.length);

  const routeId = $derived(page.route.id ?? '');
  const isArticleView = $derived(
    routeId.endsWith('/wiki/[id]') || routeId.includes('/wiki/create/')
  );
  const isTagsView = $derived(routeId.endsWith('/wiki/tags'));
  const isContextsIndex = $derived(routeId.endsWith('/wiki'));
  const isCategoryView = $derived(routeId.includes('/wiki/category/[id]'));

  const activeContextId = $derived(isCategoryView ? (page.params.id ?? '') : '');
  const activeContext = $derived(
    activeContextId ? allContexts.find((c) => c.id === activeContextId) : null
  );

  const breadcrumbPath = $derived(
    activeContextId ? getContextPath(activeContextId, allContexts) : []
  );

  // Sibling list: peers of current context. At index, this is empty (we show roots as the primary list).
  const siblings = $derived.by(() => {
    if (!activeContext) return [];
    return getContextChildren(activeContext.parentId, allContexts);
  });

  const currentChildren = $derived(
    activeContextId ? getContextChildren(activeContextId, allContexts) : []
  );

  function articleCountFor(ctxId: string): number {
    const ids = new Set(getAllDescendantIds(ctxId, allContexts));
    return allArticles.filter((a) => ids.has(a.primaryContextId)).length;
  }

  const parentContext = $derived(
    activeContext?.parentId ? allContexts.find((c) => c.id === activeContext.parentId) : null
  );

  let sidebarCollapsed = $state(false);
  const showSidebar = $derived(!isArticleView && !isTagsView);

  $effect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        wikiState.openSearch();
      }
    }

    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });
</script>

{#snippet contextRow(
  ctx: { id: string; name: string; parentId: string | null },
  active: boolean
)}
  {@const count = articleCountFor(ctx.id)}
  <a
    href="/wiki/category/{ctx.id}"
    class={cn(
      'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
      active
        ? 'bg-primary/10 font-medium text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    )}
  >
    {#if active}
      <FolderOpen class="size-3.5 shrink-0" />
    {:else}
      <Folder class="size-3.5 shrink-0" />
    {/if}
    <span class="min-w-0 flex-1 truncate">{ctx.name}</span>
    {#if count > 0}
      <span class="shrink-0 text-xs tabular-nums opacity-60">{count}</span>
    {/if}
  </a>
{/snippet}

<div class="flex size-full flex-col overflow-hidden">
  <header class="flex shrink-0 items-center justify-between gap-3 border-b bg-background px-4 py-2">
    <div class="flex min-w-0 items-center gap-2">
      {#if showSidebar}
        <button
          class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label="Toggle sidebar"
        >
          <PanelLeft class="size-4" />
        </button>
      {/if}
      <a
        href="/wiki"
        class="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:text-primary"
      >
        <BookMarked class="size-4 text-primary" />
        Wiki
      </a>
      <Separator orientation="vertical" class="h-4" />
      <Button
        variant={isContextsIndex ? 'secondary' : 'ghost'}
        size="sm"
        href="/wiki"
        class="gap-1.5"
      >
        <FileText class="size-3.5" />
        Contexts
      </Button>
      <Button
        variant={isTagsView ? 'secondary' : 'ghost'}
        size="sm"
        href="/wiki/tags"
        class="gap-1.5"
      >
        <Tag class="size-3.5" />
        Tags
      </Button>
    </div>

    <div class="flex items-center gap-2">
      <button
        onclick={() => wikiState.openSearch()}
        class="hidden min-w-72 items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:flex"
      >
        <Search class="size-3.5" />
        <span class="flex-1 text-left">Search articles, contexts, tags, KB numbers</span>
        <kbd class="rounded bg-background px-1.5 py-0 font-mono text-xs">Ctrl+K</kbd>
      </button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1 overflow-hidden">
    {#if showSidebar && !sidebarCollapsed}
      <aside class="flex w-64 shrink-0 flex-col overflow-hidden border-r bg-card/20">
        <!-- Path chips -->
        <div class="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b px-3 py-2.5 text-xs">
          <a
            href="/wiki"
            class={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
              isContextsIndex
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <House class="size-3" />
            Wiki
          </a>
          {#each breadcrumbPath as crumb, i (crumb.id)}
            <ChevronRight class="size-3 shrink-0 text-muted-foreground/60" />
            {#if i === breadcrumbPath.length - 1}
              <span class="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                {crumb.name}
              </span>
            {:else}
              <a
                href="/wiki/category/{crumb.id}"
                class="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {crumb.name}
              </a>
            {/if}
          {/each}
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          {#if contextsQuery.isLoading}
            <div class="px-3 py-3 text-xs text-muted-foreground">Loading…</div>
          {:else if rootContexts.length === 0}
            <div class="px-3 py-3 text-xs text-muted-foreground">
              No contexts yet.
              <a href="/wiki" class="text-primary hover:underline">Create one →</a>
            </div>
          {:else if !activeContext}
            <!-- At index: show roots as the primary list -->
            <div class="p-2">
              <h3 class="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Top level
              </h3>
              <div class="space-y-0.5">
                {#each rootContexts as root (root.id)}
                  {@render contextRow(root, false)}
                {/each}
              </div>
            </div>
          {:else}
            <!-- Inside a context: show siblings, then children -->
            {#if parentContext}
              <div class="border-b p-2">
                <a
                  href="/wiki/category/{parentContext.id}"
                  class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <CornerDownRight class="size-3 rotate-180" />
                  Up to {parentContext.name}
                </a>
              </div>
            {/if}

            <div class="p-2">
              <h3 class="mb-1 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>
                  {parentContext ? `In ${parentContext.name}` : 'Top level'}
                </span>
                <span class="tabular-nums opacity-60">{siblings.length}</span>
              </h3>
              <div class="space-y-0.5">
                {#each siblings as sib (sib.id)}
                  {@render contextRow(sib, sib.id === activeContextId)}
                {/each}
              </div>
            </div>

            {#if currentChildren.length > 0}
              <Separator />
              <div class="p-2">
                <h3 class="mb-1 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Inside {activeContext.name}</span>
                  <span class="tabular-nums opacity-60">{currentChildren.length}</span>
                </h3>
                <div class="space-y-0.5">
                  {#each currentChildren as child (child.id)}
                    {@render contextRow(child, false)}
                  {/each}
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </aside>
    {/if}

    <main class="min-h-0 min-w-0 flex-1 overflow-hidden">
      {@render children()}
    </main>
  </div>

  <div
    class="flex shrink-0 flex-wrap items-center gap-5 border-t bg-muted/20 px-6 py-2.5 text-xs text-muted-foreground"
  >
    <span>{articleCount} articles</span>
    <span>{contextCount} contexts</span>
    <span class="flex items-center gap-1.5">
      <kbd class="rounded bg-muted px-1.5 py-0 font-mono">Ctrl+K</kbd>
      command search
    </span>
    <span class="flex items-center gap-1.5">
      <Hash class="size-3" />
      type <kbd class="rounded bg-muted px-1 py-0 font-mono">KB001</kbd> to jump
    </span>
    <span class="ml-auto hidden items-center gap-1 md:flex">
      <Search class="size-3" />
      Views are for browsing; search is for work.
    </span>
  </div>
</div>

<SearchModal />
