<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';

  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Clock from '@lucide/svelte/icons/clock';
  import FileText from '@lucide/svelte/icons/file-text';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Link from '@lucide/svelte/icons/link';
  import Lock from '@lucide/svelte/icons/lock';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  import { getAllDescendantIds, getContextChildren, getContextPath } from '../../_wiki-utils.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const contextId = $derived(page.params.id ?? '');

  const contextsQuery = createQuery(() => ({
    queryKey: ['wiki.contexts.list'],
    queryFn: () => trpc.wiki.contexts.list.query(),
  }));

  const articlesQuery = createQuery(() => ({
    queryKey: ['wiki.articles.list', { contextId }],
    queryFn: () => trpc.wiki.articles.list.query({ contextId }),
    enabled: !!contextId,
  }));

  const allContexts = $derived(contextsQuery.data ?? []);
  const context = $derived(allContexts.find((c) => c.id === contextId));
  const breadcrumb = $derived(contextId ? getContextPath(contextId, allContexts) : []);
  const childContexts = $derived(contextId ? getContextChildren(contextId, allContexts) : []);
  const contextArticles = $derived(articlesQuery.data ?? []);
  const linkedArticles = $derived(contextArticles.filter((a) => a.contextRole === 'linked'));

  const siblingContexts = $derived.by(() => {
    if (!context) return [];
    return getContextChildren(context.parentId, allContexts);
  });

  // For child context article counts, we need the full unfiltered articles list
  const allArticlesQuery = createQuery(() => ({
    queryKey: ['wiki.articles.list'],
    queryFn: () => trpc.wiki.articles.list.query(),
  }));
  const allArticles = $derived(allArticlesQuery.data ?? []);

  function getArticleCount(ctxId: string): number {
    const contextIds = new Set(getAllDescendantIds(ctxId, allContexts));
    return allArticles.filter((a) => contextIds.has(a.primaryContextId)).length;
  }

  function getLinkedArticleCount(ctxId: string): number {
    return allArticles.filter((a) => a.linkedContexts.some((c) => c.id === ctxId)).length;
  }

  const articleCount = $derived(contextId ? getArticleCount(contextId) : 0);
  let articleSearch = $state('');
  const searchedArticles = $derived.by(() => {
    const query = articleSearch.trim().toLowerCase();
    if (!query) return contextArticles;

    return contextArticles.filter((article) => {
      const haystack = [
        article.title,
        article.kbId,
        article.createdBy?.name ?? '',
        article.primaryContextName,
        ...article.tags.map((tag) => tag.name),
        ...article.linkedContexts.map((linkedContext) => linkedContext.name),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  });

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

  let childContextDialogOpen = $state(false);
  let newContextName = $state('');
  let newContextDescription = $state('');

  function addChildContext() {
    const name = newContextName.trim();
    if (!name) return;
    createContextMut.mutate({
      name,
      description: newContextDescription.trim() || undefined,
      parentId: contextId,
    });
    childContextDialogOpen = false;
    newContextName = '';
    newContextDescription = '';
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

  function parentHref() {
    if (!context?.parentId) return '/wiki';
    return `/wiki/category/${context.parentId}`;
  }
</script>

{#if contextsQuery.isLoading}
  <Loader />
{:else if !context}
  <FadeIn class="flex size-full items-center justify-center text-muted-foreground">
    Context not found
  </FadeIn>
{:else}
  <FadeIn class="flex size-full flex-col overflow-hidden">
    <div class="flex shrink-0 flex-col gap-4 px-6 pb-4 pt-5">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Button variant="ghost" size="icon-sm" href={parentHref()} title="Back">
          <ArrowLeft class="size-4" />
        </Button>
        <a href="/wiki" class="transition-colors hover:text-foreground">Contexts</a>
        {#each breadcrumb as crumb, i (crumb.id)}
          <ChevronRight class="size-3" />
          {#if i === breadcrumb.length - 1}
            <span class="font-medium text-foreground">{crumb.name}</span>
          {:else}
            <a href="/wiki/category/{crumb.id}" class="transition-colors hover:text-foreground">
              {crumb.name}
            </a>
          {/if}
        {/each}
      </div>

      <div class="flex items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-3">
          <div class="rounded-lg bg-primary/10 p-2.5 text-primary">
            <FolderOpen class="size-5" />
          </div>
          <div class="min-w-0">
            <h1 class="text-xl font-semibold">{context.name}</h1>
            {#if context.description}
              <p class="mt-0.5 text-sm text-muted-foreground">{context.description}</p>
            {/if}
            <div class="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{articleCount} article{articleCount === 1 ? '' : 's'}</span>
              <span
                >{linkedArticles.length} linked appearance{linkedArticles.length === 1
                  ? ''
                  : 's'}</span
              >
              <span>{childContexts.length} context{childContexts.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>

        <div class="flex w-fit items-center gap-2">
          {#if siblingContexts.length > 1}
            <div class="w-44">
              <SingleSelect
                options={siblingContexts.map((sc) => ({ label: sc.name, value: sc.id }))}
                selected={context.id}
                onchange={(v) => goto(`/wiki/category/${v}`)}
              />
            </div>
          {/if}
          <Button
            variant="outline"
            size="sm"
            class="gap-1.5"
            onclick={() => (childContextDialogOpen = true)}
          >
            <Folder class="size-3.5" />
            New Context
          </Button>
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="outline" size="sm" class="gap-1.5 text-destructive">
                  <Trash2 class="size-3.5" />
                  Delete
                </Button>
              {/snippet}
            </AlertDialog.Trigger>
            <AlertDialog.Content>
              <AlertDialog.Header>
                <AlertDialog.Title>Delete {context.name}?</AlertDialog.Title>
                <AlertDialog.Description>
                  This removes this context and any child contexts. Articles are moved to the parent
                  context.
                </AlertDialog.Description>
              </AlertDialog.Header>
              <AlertDialog.Footer>
                <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                <AlertDialog.Action
                  class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
                  onclick={() => {
                    const target = parentHref();
                    removeContextMut.mutate(context.id);
                    goto(target);
                  }}
                >
                  Delete
                </AlertDialog.Action>
              </AlertDialog.Footer>
            </AlertDialog.Content>
          </AlertDialog.Root>
          <Button href="/wiki/create/new?context={contextId}" size="sm" class="gap-1.5">
            <Plus class="size-3.5" />
            New Article
          </Button>
        </div>
      </div>
    </div>

    <Separator />

    <Dialog.Root bind:open={childContextDialogOpen}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>New Context</Dialog.Title>
          <Dialog.Description>Create a subcontext under {context.name}.</Dialog.Description>
        </Dialog.Header>

        <div class="flex flex-col gap-3 px-4 py-2">
          <Input
            bind:value={newContextName}
            placeholder="Context name"
            onkeydown={(e) => {
              if (e.key === 'Enter') addChildContext();
            }}
          />
          <Input
            bind:value={newContextDescription}
            placeholder="Short description"
            onkeydown={(e) => {
              if (e.key === 'Enter') addChildContext();
            }}
          />
        </div>

        <Dialog.Footer>
          <Button
            variant="outline"
            onclick={() => {
              childContextDialogOpen = false;
              newContextName = '';
              newContextDescription = '';
            }}
          >
            Cancel
          </Button>
          <Button disabled={!newContextName.trim()} onclick={addChildContext}>Create</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>

    <div class="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] overflow-hidden">
      <aside class="flex min-h-0 flex-col border-r bg-card/30">
        <div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Subcontexts
          </h2>
          <span class="text-xs tabular-nums text-muted-foreground">{childContexts.length}</span>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          {#if childContexts.length > 0}
            <div class="space-y-1.5">
              {#each childContexts as child (child.id)}
                {@const childCount = getContextChildren(child.id, allContexts).length}
                {@const childArticleCount = getArticleCount(child.id)}
                {@const linkedCount = getLinkedArticleCount(child.id)}
                <a
                  href="/wiki/category/{child.id}"
                  class="group flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary/10"
                >
                  <span
                    class="rounded-md bg-muted p-1.5 text-muted-foreground group-hover:text-primary"
                  >
                    <Folder class="size-4" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center justify-between gap-2">
                      <h3 class="truncate text-sm font-medium">{child.name}</h3>
                      <ArrowRight
                        class="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                      />
                    </div>
                    <p class="truncate text-xs text-muted-foreground">
                      {childArticleCount} article{childArticleCount === 1 ? '' : 's'} · {childCount}
                      context{childCount === 1 ? '' : 's'}
                      {#if linkedCount > 0}
                        · {linkedCount} linked
                      {/if}
                    </p>
                  </div>
                </a>
              {/each}
            </div>
          {:else}
            <div class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No subcontexts.
            </div>
          {/if}
        </div>
      </aside>

      <section class="flex min-h-0 min-w-0 flex-col">
        <div class="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <h2 class="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Articles
          </h2>
          <div class="relative min-w-0 flex-1">
            <Search
              class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              bind:value={articleSearch}
              placeholder="Search articles…"
              class="h-8 pl-8 text-sm"
            />
          </div>
          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
            {searchedArticles.length} / {contextArticles.length}
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          {#if articlesQuery.isLoading}
            <Loader />
          {:else if searchedArticles.length > 0}
            <div class="space-y-2">
              {#each searchedArticles as article (article.id)}
                <a
                  href="/wiki/{article.id}"
                  class="group flex items-center gap-3 rounded-lg border bg-card/60 px-4 py-3 transition-colors hover:border-primary/30 hover:bg-primary/10"
                >
                  <FileText class="size-4 shrink-0 text-muted-foreground" />
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-sm font-medium group-hover:text-primary">
                        {article.title}
                      </span>
                      {#if article.contextRole === 'linked'}
                        <Badge variant="outline" class="gap-1 px-1.5 py-0 text-xs">
                          <Link class="size-3" />
                          linked
                        </Badge>
                      {/if}
                    </div>
                    <p class="truncate text-xs text-muted-foreground">
                      {article.kbId} · {article.createdBy?.name ?? ''}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    {#each article.tags.slice(0, 2) as tag (tag.id)}
                      <span
                        class="rounded-full px-1.5 py-0 text-xs"
                        style="background-color: {tag.color}18; color: {tag.color}"
                      >
                        {tag.name}
                      </span>
                    {/each}
                    {#if article.lock}
                      <span title="Locked by {article.lock.lockedBy.name}">
                        <Lock class="size-3.5 text-warning" />
                      </span>
                    {/if}
                    <span class="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock class="size-3" />
                      {relativeTime(article.updatedAt)}
                    </span>
                  </div>
                </a>
              {/each}
            </div>
          {:else if articleSearch.trim()}
            <div class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No articles match this search.
            </div>
          {:else}
            <div class="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No articles are currently home or linked here.
            </div>
          {/if}
        </div>
      </section>
    </div>
  </FadeIn>
{/if}
