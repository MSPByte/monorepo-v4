<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import * as Command from '$lib/components/ui/command/index.js';
  import { cn } from '$lib/utils';
  import { getContextPath } from './_wiki-utils.js';

  import AlignLeft from '@lucide/svelte/icons/align-left';
  import FileText from '@lucide/svelte/icons/file-text';
  import Folder from '@lucide/svelte/icons/folder';
  import Hash from '@lucide/svelte/icons/hash';
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import Search from '@lucide/svelte/icons/search';
  import Tag from '@lucide/svelte/icons/tag';

  import { wikiState } from './_wiki-state.svelte.js';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const articlesQuery = createQuery(() => ({
    queryKey: ['wiki.articles.list'],
    queryFn: () => trpc.wiki.articles.list.query()
  }));

  const contextsQuery = createQuery(() => ({
    queryKey: ['wiki.contexts.list'],
    queryFn: () => trpc.wiki.contexts.list.query()
  }));

  const allArticles = $derived(articlesQuery.data ?? []);
  const allContexts = $derived(contextsQuery.data ?? []);

  type ArticleItem = (typeof allArticles)[number];

  type SearchScope = 'title' | 'tag' | 'body' | 'override' | 'context';

  type ArticleSearchResult = {
    type: 'article';
    article: ArticleItem;
    score: number;
    fields: SearchScope[];
    snippet: string;
  };

  type ContextSearchResult = {
    type: 'context';
    id: string;
    name: string;
    path: string;
    score: number;
  };

  const SCOPES: Array<{ id: SearchScope; label: string }> = [
    { id: 'title', label: 'Title' },
    { id: 'tag', label: 'Tags' },
    { id: 'body', label: 'Body' },
    { id: 'context', label: 'Contexts' }
  ];

  const PREFIX_TO_SCOPE: Record<string, SearchScope> = {
    title: 'title',
    tag: 'tag',
    tags: 'tag',
    body: 'body',
    content: 'body',
    context: 'context',
    ctx: 'context'
  };

  let query = $state('');
  let selectedScopes = $state<SearchScope[]>(['title', 'tag', 'body', 'context']);

  const parsed = $derived.by(() => {
    const raw = query.trim();
    const prefixMatch = raw.match(/^([a-z]+):(.*)$/i);
    const prefixScope = prefixMatch ? PREFIX_TO_SCOPE[prefixMatch[1].toLowerCase()] : undefined;
    return {
      raw,
      text: (prefixScope ? prefixMatch?.[2] : raw)?.trim().toLowerCase() ?? '',
      forcedScope: prefixScope
    };
  });

  const activeScopes = $derived(parsed.forcedScope ? [parsed.forcedScope] : selectedScopes);
  const q = $derived(parsed.text);

  function contextPath(contextId: string): string {
    return getContextPath(contextId, allContexts)
      .map((c) => c.name)
      .join(' / ');
  }

  function includesQuery(text: string, search: string): boolean {
    if (!search) return false;
    const normalized = text.toLowerCase();
    const tokens = search.split(/\s+/).filter(Boolean);
    return tokens.every((token) => normalized.includes(token));
  }

  function getSnippet(text: string, search: string): string {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    const idx = cleaned.toLowerCase().indexOf(search);
    if (idx === -1) return cleaned.slice(0, 110) + (cleaned.length > 110 ? '...' : '');
    const start = Math.max(0, idx - 36);
    const end = Math.min(cleaned.length, idx + 84);
    return (
      (start > 0 ? '...' : '') + cleaned.slice(start, end) + (end < cleaned.length ? '...' : '')
    );
  }

  function toggleScope(scope: SearchScope) {
    if (parsed.forcedScope) return;
    if (selectedScopes.includes(scope)) {
      selectedScopes =
        selectedScopes.length === 1 ? selectedScopes : selectedScopes.filter((s) => s !== scope);
    } else {
      selectedScopes = [...selectedScopes, scope];
    }
  }

  const articleResults = $derived.by<ArticleSearchResult[]>(() => {
    if (!q) return [];

    return allArticles
      .map((article) => {
        const fields: SearchScope[] = [];
        let score = 0;
        let snippet = '';

        const titleText = `${article.kbId} ${article.title}`;
        const tagText = article.tags.map((t) => t.name).join(' ');
        const bodyText = article.contentText;
        const ctxText = [
          contextPath(article.primaryContextId),
          ...article.linkedContexts.map((c) => c.name)
        ].join(' ');

        if (activeScopes.includes('title') && includesQuery(titleText, q)) {
          fields.push('title');
          score += article.title.toLowerCase() === q ? 120 : 80;
          snippet ||= `${article.kbId} / ${contextPath(article.primaryContextId)}`;
        }

        if (activeScopes.includes('tag') && includesQuery(tagText, q)) {
          fields.push('tag');
          score += 55;
          snippet ||= `Tags: ${tagText}`;
        }

        if (activeScopes.includes('context') && includesQuery(ctxText, q)) {
          fields.push('context');
          score += 45;
          snippet ||= contextPath(article.primaryContextId);
        }

        if (activeScopes.includes('body') && includesQuery(bodyText, q)) {
          fields.push('body');
          score += 25;
          snippet ||= getSnippet(bodyText, q);
        }

        if (fields.length === 0) return null;
        return { type: 'article' as const, article, score, fields, snippet };
      })
      .filter((result): result is ArticleSearchResult => !!result)
      .sort((a, b) => b.score - a.score || b.article.updatedAt.localeCompare(a.article.updatedAt))
      .slice(0, 12);
  });

  const contextResults = $derived.by<ContextSearchResult[]>(() => {
    if (!q || !activeScopes.includes('context')) return [];

    return allContexts
      .map((context) => {
        const path = contextPath(context.id);
        const text = [context.name, path, context.description ?? ''].join(' ');
        if (!includesQuery(text, q)) return null;
        return {
          type: 'context' as const,
          id: context.id,
          name: context.name,
          path,
          score: context.name.toLowerCase() === q ? 90 : 40
        };
      })
      .filter((result): result is ContextSearchResult => !!result)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, 8);
  });

  const directKbMatch = $derived.by(() => {
    const match = q.match(/^kb(\d+)$/i);
    if (!match) return undefined;
    const num = parseInt(match[1], 10);
    return allArticles.find((a) => a.kbNumber === num);
  });

  const hasResults = $derived(
    articleResults.length > 0 || contextResults.length > 0 || !!directKbMatch
  );

  function navigate(id: string) {
    wikiState.closeSearch();
    query = '';
    goto(`/wiki/${id}`);
  }

  function navigateContext(contextId: string) {
    wikiState.closeSearch();
    query = '';
    goto(`/wiki/category/${contextId}`);
  }

  function fieldIcon(field: SearchScope) {
    return field === 'title'
      ? FileText
      : field === 'tag'
        ? Tag
        : field === 'context'
          ? Folder
          : field === 'override'
            ? MessageSquareText
            : AlignLeft;
  }
</script>

<Command.Dialog
  bind:open={wikiState.searchOpen}
  shouldFilter={false}
  title="Search Knowledge Base"
  description="Search articles, contexts, tags, and body content"
  class="sm:max-w-2xl"
>
  {#snippet children()}
    <Command.Input
      bind:value={query}
      placeholder="Search all wiki content... try tag:troubleshooting, title:gateway"
    />

    <div class="flex flex-wrap items-center gap-1 border-b px-3 py-2">
      <span class="mr-1 text-xs text-muted-foreground">Search in</span>
      {#each SCOPES as scope (scope.id)}
        <button
          class={cn(
            'rounded-full border px-2 py-0.5 text-xs transition-colors',
            activeScopes.includes(scope.id)
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground',
            parsed.forcedScope && parsed.forcedScope !== scope.id && 'opacity-40'
          )}
          onclick={() => toggleScope(scope.id)}
        >
          {scope.label}
        </button>
      {/each}
      {#if parsed.forcedScope}
        <span class="ml-auto text-xs text-muted-foreground"> Prefix filter active </span>
      {/if}
    </div>

    <Command.List class="max-h-[520px]">
      {#if !hasResults && q.length > 0}
        <Command.Empty>No results for "{parsed.text}"</Command.Empty>
      {:else if q.length === 0}
        <Command.Empty class="py-8 text-center text-sm text-muted-foreground">
          Start typing to search. Use prefixes like <span class="font-mono">tag:</span>,
          <span class="font-mono">title:</span>, <span class="font-mono">body:</span>, or
          <span class="font-mono">context:</span>.
        </Command.Empty>
      {/if}

      {#if directKbMatch}
        <Command.Group heading="Direct KB Match">
          <Command.Item
            value="{directKbMatch.kbId} {directKbMatch.title}"
            onSelect={() => navigate(directKbMatch!.id)}
            class="flex-col items-start gap-0.5 py-2"
          >
            <div class="flex w-full items-center gap-2">
              <Hash class="size-3.5 shrink-0 text-primary" />
              <span class="font-medium">{directKbMatch.kbId} - {directKbMatch.title}</span>
            </div>
            <span class="pl-5 text-xs text-muted-foreground">
              {contextPath(directKbMatch.primaryContextId)}
            </span>
          </Command.Item>
        </Command.Group>
      {/if}

      {#if articleResults.length > 0}
        {#if directKbMatch}
          <Command.Separator />
        {/if}
        <Command.Group heading="Articles">
          {#each articleResults as result (result.article.id)}
            <Command.Item
              value="{result.article.kbId} {result.article.title} {result.fields.join(' ')} {result.snippet}"
              onSelect={() => navigate(result.article.id)}
              class="flex-col items-start gap-1 py-2"
            >
              <div class="flex w-full items-center gap-2">
                <FileText class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate font-medium">{result.article.title}</span>
                <span class="shrink-0 font-mono text-xs text-muted-foreground"
                  >{result.article.kbId}</span
                >
              </div>
              <div class="flex flex-wrap items-center gap-1.5 pl-5">
                {#each result.fields as field (field)}
                  {@const Icon = fieldIcon(field)}
                  <span
                    class="inline-flex items-center gap-1 rounded border px-1.5 py-0 text-xs text-muted-foreground"
                  >
                    <Icon class="size-3" />
                    {field}
                  </span>
                {/each}
                {#each result.article.tags.slice(0, 3) as tag (tag.id)}
                  <span
                    class="rounded px-1.5 py-0 text-xs"
                    style="background-color: {tag.color}18; color: {tag.color}; border: 1px solid {tag.color}30"
                  >
                    {tag.name}
                  </span>
                {/each}
              </div>
              <p class="line-clamp-1 pl-5 text-xs text-muted-foreground">
                {result.snippet || contextPath(result.article.primaryContextId)}
              </p>
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}

      {#if contextResults.length > 0}
        {#if directKbMatch || articleResults.length > 0}
          <Command.Separator />
        {/if}
        <Command.Group heading="Contexts">
          {#each contextResults as ctx (ctx.id)}
            <Command.Item
              value="{ctx.id} {ctx.name} {ctx.path}"
              onSelect={() => navigateContext(ctx.id)}
              class="flex-col items-start gap-0.5 py-2"
            >
              <div class="flex w-full items-center gap-2">
                <Folder class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate font-medium">{ctx.name}</span>
              </div>
              <span class="pl-5 text-xs text-muted-foreground">{ctx.path}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}
    </Command.List>

    <div
      class="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground"
    >
      <span class="flex items-center gap-1">
        <Search class="size-3" />
        Client-side search over cached data.
      </span>
      <span class="ml-auto">
        <kbd class="rounded bg-muted px-1 py-0 font-mono text-xs">Esc</kbd> close
      </span>
    </div>
  {/snippet}
</Command.Dialog>
