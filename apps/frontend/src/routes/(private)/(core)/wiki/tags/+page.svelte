<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { cn } from '$lib/utils';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  import Check from '@lucide/svelte/icons/check';
  import Clock from '@lucide/svelte/icons/clock';
  import FileText from '@lucide/svelte/icons/file-text';
  import Lock from '@lucide/svelte/icons/lock';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Tag from '@lucide/svelte/icons/tag';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const tagsQuery = createQuery(() => ({
    queryKey: ['wiki.tags.list'],
    queryFn: () => trpc.wiki.tags.list.query(),
  }));

  const articlesQuery = createQuery(() => ({
    queryKey: ['wiki.articles.list'],
    queryFn: () => trpc.wiki.articles.list.query(),
  }));

  const allTags = $derived(tagsQuery.data ?? []);
  const allArticles = $derived(articlesQuery.data ?? []);

  const createTagMut = createMutation(() => ({
    mutationFn: (input: { name: string; color: string }) => trpc.wiki.tags.create.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.tags.list'] });
    },
  }));

  const updateTagMut = createMutation(() => ({
    mutationFn: (input: { id: string; name?: string; color?: string }) =>
      trpc.wiki.tags.update.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.tags.list'] });
    },
  }));

  const removeTagMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.wiki.tags.remove.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.tags.list'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
    },
  }));

  let selectedTagId = $state<string | null>(null);
  let tagSearch = $state('');
  let articleSearch = $state('');
  let addingTag = $state(false);
  let newTagLabel = $state('');
  let newTagColor = $state('oklch(0.62 0.188 259.8)');
  let editingId = $state<string | null>(null);
  let editLabel = $state('');
  let editColor = $state('');

  const PRESET_COLORS = [
    'oklch(0.62 0.188 259.8)',
    'oklch(0.72 0.18 148.9)',
    'oklch(0.737 0.153 74.2)',
    'oklch(0.637 0.208 25.33)',
    'oklch(0.58 0.18 290)',
    'oklch(0.75 0.18 65)',
    'oklch(0.7 0.18 340)',
    'oklch(0.55 0 0)',
  ];

  const filteredTags = $derived(
    tagSearch.trim()
      ? allTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
      : allTags
  );

  function articlesForTag(tagId: string) {
    return allArticles.filter((a) => a.tags.some((t) => t.id === tagId));
  }

  const selectedTag = $derived(selectedTagId ? allTags.find((t) => t.id === selectedTagId) : null);
  const tagArticles = $derived(selectedTagId ? articlesForTag(selectedTagId) : []);
  const searchedArticles = $derived.by(() => {
    const query = articleSearch.trim().toLowerCase();
    if (!query) return tagArticles;
    return tagArticles.filter((article) => {
      const haystack = [
        article.title,
        article.kbId,
        article.createdBy?.name ?? '',
        article.primaryContextName,
        ...article.tags.map((tag) => tag.name),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  });

  function startEdit(tag: { id: string; name: string; color: string }) {
    editingId = tag.id;
    editLabel = tag.name;
    editColor = tag.color;
  }

  function commitEdit() {
    if (editingId && editLabel.trim()) {
      updateTagMut.mutate({ id: editingId, name: editLabel.trim(), color: editColor });
    }
    editingId = null;
  }

  function commitAdd() {
    const name = newTagLabel.trim();
    if (!name) {
      addingTag = false;
      return;
    }
    createTagMut.mutate({ name, color: newTagColor });
    newTagLabel = '';
    newTagColor = 'oklch(0.62 0.188 259.8)';
    addingTag = false;
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

{#if tagsQuery.isLoading || articlesQuery.isLoading}
  <Loader />
{:else}
  <FadeIn class="flex size-full flex-col overflow-hidden">
    <div class="flex shrink-0 items-center justify-between px-6 pb-4 pt-5">
      <div>
        <h1 class="flex items-center gap-2 text-xl font-semibold">
          <Tag class="size-5 text-primary" />
          Tags
        </h1>
      </div>
      <Button size="sm" class="gap-1.5" onclick={() => (addingTag = !addingTag)}>
        <Plus class="size-3.5" />
        New Tag
      </Button>
    </div>

    <Separator />

    <div
      class="grid min-h-0 flex-1 overflow-hidden"
      class:grid-cols-[20rem_minmax(0,1fr)]={selectedTagId}
      class:grid-cols-1={!selectedTagId}
    >
      <!-- Tag list sidebar -->
      <div class="flex min-h-0 flex-col border-r bg-card/30">
        <div class="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <div class="relative min-w-0 flex-1">
            <Search
              class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input bind:value={tagSearch} placeholder="Search tags…" class="h-8 pl-8 text-sm" />
          </div>
          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filteredTags.length}
          </span>
        </div>

        {#if addingTag}
          <div class="flex items-center gap-3 border-b bg-primary/5 px-4 py-2.5">
            <div class="flex items-center gap-1">
              {#each PRESET_COLORS as color (color)}
                <button
                  class={cn(
                    'size-4 rounded-full border-2 transition-transform hover:scale-110',
                    newTagColor === color ? 'border-foreground scale-110' : 'border-transparent'
                  )}
                  style="background-color: {color}"
                  onclick={() => (newTagColor = color)}
                  aria-label="Select color"
                ></button>
              {/each}
            </div>
            <input
              bind:value={newTagLabel}
              placeholder="Tag name…"
              class="flex-1 border-b border-border/60 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/50"
              onkeydown={(e) => {
                if (e.key === 'Enter') commitAdd();
                if (e.key === 'Escape') {
                  addingTag = false;
                  newTagLabel = '';
                }
              }}
              autofocus
            />
            <button onclick={commitAdd} class="shrink-0 text-primary hover:opacity-80">
              <Check class="size-4" />
            </button>
            <button
              onclick={() => {
                addingTag = false;
                newTagLabel = '';
              }}
              class="shrink-0 text-muted-foreground hover:opacity-80"
            >
              <X class="size-4" />
            </button>
          </div>
        {/if}

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          {#if filteredTags.length > 0}
            <div class="space-y-1.5">
              {#each filteredTags as tag (tag.id)}
                {@const tagCount = tag.articleCount}
                <div class="group relative">
                  {#if editingId === tag.id}
                    <div
                      class="flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2.5"
                    >
                      <div class="flex min-w-0 flex-1 items-center gap-2">
                        <div class="flex gap-0.5">
                          {#each PRESET_COLORS as color (color)}
                            <button
                              class={cn(
                                'size-3.5 rounded-full border transition-transform hover:scale-110',
                                editColor === color
                                  ? 'border-foreground scale-110'
                                  : 'border-transparent'
                              )}
                              style="background-color: {color}"
                              aria-label="Select color"
                              onclick={() => (editColor = color)}
                            ></button>
                          {/each}
                        </div>
                        <input
                          bind:value={editLabel}
                          class="min-w-0 flex-1 border-b border-border bg-transparent text-sm outline-none"
                          onkeydown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') editingId = null;
                          }}
                          autofocus
                        />
                        <button onclick={commitEdit} class="text-primary">
                          <Check class="size-3.5" />
                        </button>
                        <button onclick={() => (editingId = null)} class="text-muted-foreground">
                          <X class="size-3.5" />
                        </button>
                      </div>
                    </div>
                  {:else}
                    <button
                      class={cn(
                        'group flex w-full items-center gap-3 rounded-md border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/10',
                        selectedTagId === tag.id && 'border-primary/30 bg-primary/10'
                      )}
                      onclick={() => {
                        selectedTagId = selectedTagId === tag.id ? null : tag.id;
                        articleSearch = '';
                      }}
                    >
                      <span
                        class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                        style="background-color: {tag.color}18; color: {tag.color}; border: 1px solid {tag.color}30"
                      >
                        <span
                          class="inline-block size-1.5 rounded-full"
                          style="background-color: {tag.color}"
                        ></span>
                        {tag.name}
                      </span>
                      <span class="text-xs tabular-nums text-muted-foreground">
                        {tagCount} article{tagCount === 1 ? '' : 's'}
                      </span>
                    </button>
                    <div
                      class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <button
                        onclick={() => startEdit(tag)}
                        class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Edit tag"
                      >
                        <Pencil class="size-3" />
                      </button>
                      <AlertDialog.Root>
                        <AlertDialog.Trigger>
                          {#snippet child({ props })}
                            <button
                              {...props}
                              class="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              title="Delete tag"
                            >
                              <Trash2 class="size-3" />
                            </button>
                          {/snippet}
                        </AlertDialog.Trigger>
                        <AlertDialog.Content>
                          <AlertDialog.Header>
                            <AlertDialog.Title>Delete {tag.name}?</AlertDialog.Title>
                            <AlertDialog.Description>
                              This removes the tag and unassigns it from any articles that currently
                              use it.
                            </AlertDialog.Description>
                          </AlertDialog.Header>
                          <AlertDialog.Footer>
                            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                            <AlertDialog.Action
                              class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
                              onclick={() => {
                                removeTagMut.mutate(tag.id);
                                if (selectedTagId === tag.id) selectedTagId = null;
                              }}
                            >
                              Delete
                            </AlertDialog.Action>
                          </AlertDialog.Footer>
                        </AlertDialog.Content>
                      </AlertDialog.Root>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div
              class="flex flex-col items-center justify-center py-12 text-center text-muted-foreground"
            >
              <Tag class="mb-2 size-8 opacity-30" />
              <p class="text-sm">No tags found</p>
            </div>
          {/if}
        </div>
      </div>

      <!-- Article detail panel -->
      {#if selectedTagId}
        <section class="flex min-h-0 min-w-0 flex-col">
          <div class="flex h-12 shrink-0 items-center gap-3 border-b px-4">
            {#if selectedTag}
              <span
                class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                style="background-color: {selectedTag.color}18; color: {selectedTag.color}; border: 1px solid {selectedTag.color}30"
              >
                {selectedTag.name}
              </span>
            {/if}
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
              {searchedArticles.length} / {tagArticles.length}
            </span>
            <button
              onclick={() => (selectedTagId = null)}
              class="text-muted-foreground hover:text-foreground"
            >
              <X class="size-4" />
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-4">
            {#if searchedArticles.length > 0}
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
                      </div>
                      <p class="truncate text-xs text-muted-foreground">
                        {article.kbId} · {article.createdBy?.name ?? ''}
                      </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      {#each article.tags
                        .filter((t) => t.id !== selectedTagId)
                        .slice(0, 2) as tag (tag.id)}
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
                No articles with this tag.
              </div>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  </FadeIn>
{/if}
