<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Check from '@lucide/svelte/icons/check';
  import Clock from '@lucide/svelte/icons/clock';
  import FileText from '@lucide/svelte/icons/file-text';
  import Folder from '@lucide/svelte/icons/folder';
  import Link from '@lucide/svelte/icons/link';
  import Lock from '@lucide/svelte/icons/lock';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';

  import { getAllDescendantIds, getContextChildren, getContextPath } from './_wiki-utils.js';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const contextsQuery = createQuery(() => ({
    queryKey: ['wiki.contexts.list'],
    queryFn: () => trpc.wiki.contexts.list.query(),
  }));

  const recentQuery = createQuery(() => ({
    queryKey: ['wiki.articles.recent'],
    queryFn: () => trpc.wiki.articles.recent.query(),
  }));

  const allContexts = $derived(contextsQuery.data ?? []);
  const rootContexts = $derived(getContextChildren(null, allContexts));
  const recentArticles = $derived(recentQuery.data ?? []);

  // For article counts we need the full articles list
  const articlesQuery = createQuery(() => ({
    queryKey: ['wiki.articles.list'],
    queryFn: () => trpc.wiki.articles.list.query(),
  }));
  const allArticles = $derived(articlesQuery.data ?? []);

  function getArticleCount(contextId: string): number {
    const contextIds = new Set(getAllDescendantIds(contextId, allContexts));
    return allArticles.filter((a) => contextIds.has(a.primaryContextId)).length;
  }

  function getLinkedArticleCount(contextId: string): number {
    return allArticles.filter((a) => a.linkedContexts.some((c) => c.id === contextId)).length;
  }

  const createContextMut = createMutation(() => ({
    mutationFn: (input: { name: string; description?: string; parentId: string | null }) =>
      trpc.wiki.contexts.create.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
    },
  }));

  const removeContextMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.wiki.contexts.remove.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
    },
  }));

  let addingRootContext = $state(false);
  let newContextName = $state('');
  let newContextDescription = $state('');

  function addRootContext() {
    const name = newContextName.trim();
    if (!name) return;
    createContextMut.mutate({
      name,
      description: newContextDescription.trim() || undefined,
      parentId: null,
    });
    addingRootContext = false;
    newContextName = '';
    newContextDescription = '';
  }

  function contextPath(contextId: string): string {
    return getContextPath(contextId, allContexts)
      .map((c) => c.name)
      .join(' / ');
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }
</script>

<div class="flex size-full flex-col overflow-y-auto">
  <div class="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
    <div>
      <h1 class="text-xl font-semibold">Contexts</h1>
      <p class="mt-0.5 text-sm text-muted-foreground">
        Browse by operational area, or use command search when you already know what you need.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        class="gap-1.5"
        onclick={() => (addingRootContext = true)}
      >
        <Folder class="size-3.5" />
        New Context
      </Button>
      <Button
        href="/wiki/create/new"
        size="sm"
        class="gap-1.5"
        disabled={rootContexts.length === 0}
      >
        <Plus class="size-3.5" />
        New Article
      </Button>
    </div>
  </div>

  <div class="grid gap-6 px-6 pb-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
    <section class="min-w-0">
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Top-Level Contexts
      </h2>
      {#if addingRootContext}
        <div class="mb-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
          <div class="grid gap-2 sm:grid-cols-[16rem_minmax(0,1fr)_auto]">
            <Input bind:value={newContextName} placeholder="Context name" class="h-8" />
            <Input
              bind:value={newContextDescription}
              placeholder="Short description"
              class="h-8"
              onkeydown={(e) => {
                if (e.key === 'Enter') addRootContext();
              }}
            />
            <div class="flex items-center gap-1">
              <Button size="icon-sm" title="Create context" onclick={addRootContext}>
                <Check class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Cancel"
                onclick={() => {
                  addingRootContext = false;
                  newContextName = '';
                  newContextDescription = '';
                }}
              >
                <X class="size-4" />
              </Button>
            </div>
          </div>
        </div>
      {/if}

      {#if contextsQuery.isLoading}
        <Loader />
      {:else}
        <FadeIn class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {#each rootContexts as context (context.id)}
            {@const childCount = getContextChildren(context.id, allContexts).length}
            {@const articleCount = getArticleCount(context.id)}
            {@const linkedCount = getLinkedArticleCount(context.id)}
            <div
              class="group flex min-h-32 flex-col gap-3 rounded-lg border bg-card/60 p-4 transition-colors hover:border-primary/30 hover:bg-primary/10"
            >
              <div class="flex items-start justify-between gap-3">
                <a
                  href="/wiki/category/{context.id}"
                  class="flex min-w-0 flex-1 items-center gap-2"
                >
                  <span
                    class="rounded-md bg-muted p-2 text-muted-foreground group-hover:text-primary"
                  >
                    <Folder class="size-4" />
                  </span>
                  <div>
                    <h3 class="text-sm font-semibold">{context.name}</h3>
                    <p class="text-xs text-muted-foreground">
                      {childCount} context{childCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </a>
                <AlertDialog.Root>
                  <AlertDialog.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-sm"
                        title="Delete context"
                        class="opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 class="size-3.5 text-destructive" />
                      </Button>
                    {/snippet}
                  </AlertDialog.Trigger>
                  <AlertDialog.Content>
                    <AlertDialog.Header>
                      <AlertDialog.Title>Delete {context.name}?</AlertDialog.Title>
                      <AlertDialog.Description>
                        This removes the context and child contexts. Articles are moved to the
                        parent context.
                      </AlertDialog.Description>
                    </AlertDialog.Header>
                    <AlertDialog.Footer>
                      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                      <AlertDialog.Action
                        class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
                        onclick={() => removeContextMut.mutate(context.id)}
                      >
                        Delete
                      </AlertDialog.Action>
                    </AlertDialog.Footer>
                  </AlertDialog.Content>
                </AlertDialog.Root>
              </div>
              {#if context.description}
                <p class="line-clamp-2 text-xs text-muted-foreground">{context.description}</p>
              {/if}
              <div class="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span class="flex items-center gap-1">
                  <FileText class="size-3" />
                  {articleCount} article{articleCount === 1 ? '' : 's'}
                </span>
                {#if linkedCount > 0}
                  <span class="flex items-center gap-1">
                    <Link class="size-3" />
                    {linkedCount} linked
                  </span>
                {/if}
                <a href="/wiki/category/{context.id}" class="ml-auto text-xs text-primary">
                  Open
                  <ArrowRight class="inline size-3" />
                </a>
              </div>
            </div>
          {/each}
        </FadeIn>
      {/if}
    </section>

    <aside class="min-w-0">
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Recently Updated
      </h2>
      <div class="rounded-lg border bg-card/40">
        {#each recentArticles as article, i (article.id)}
          {#if i > 0}
            <Separator />
          {/if}
          <div class="group flex items-center gap-3 px-4 py-3">
            <FileText class="size-4 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <a
                href="/wiki/{article.id}"
                class="block truncate text-sm font-medium transition-colors hover:text-primary"
              >
                {article.title}
              </a>
              <p class="truncate text-xs text-muted-foreground">
                {article.kbId} · {contextPath(article.primaryContextId)}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              {#if article.lockedBy}
                <span title="Locked by {article.lockedBy}">
                  <Lock class="size-3.5 text-warning" />
                </span>
              {/if}
              <span class="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock class="size-3" />
                {relativeTime(article.updatedAt)}
              </span>
            </div>
          </div>
        {/each}
      </div>
    </aside>
  </div>
</div>
