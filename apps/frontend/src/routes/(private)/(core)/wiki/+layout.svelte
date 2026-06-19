<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import Button from '$lib/components/ui/button/button.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';

  import BookMarked from '@lucide/svelte/icons/book-marked';
  import FileText from '@lucide/svelte/icons/file-text';
  import Hash from '@lucide/svelte/icons/hash';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Tag from '@lucide/svelte/icons/tag';

  import SearchModal from './_search-modal.svelte';
  import { wikiState } from './_wiki-state.svelte.js';

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

  const contextCount = $derived(contextsQuery.data?.length ?? 0);
  const articleCount = $derived(articlesQuery.data?.length ?? 0);

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

<div class="flex size-full flex-col overflow-hidden">
  <header class="flex shrink-0 items-center justify-between gap-3 border-b bg-background px-4 py-2">
    <div class="flex min-w-0 items-center gap-2">
      <a
        href="/wiki"
        class="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:text-primary"
      >
        <BookMarked class="size-4 text-primary" />
        Wiki
      </a>
      <Separator orientation="vertical" class="h-4" />
      <Button variant="ghost" size="sm" href="/wiki" class="gap-1.5">
        <FileText class="size-3.5" />
        Contexts
      </Button>
      <Button variant="ghost" size="sm" href="/wiki/tags" class="gap-1.5">
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

  <main class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </main>

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
