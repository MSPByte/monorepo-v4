<script lang="ts">
  import { cn } from '$lib/utils';
  import { getContext } from 'svelte';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import * as Collapsible from '$lib/components/ui/collapsible/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import CategoryTreeItem from './_category-tree-item.svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Folder from '@lucide/svelte/icons/folder';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';

  import { getAllDescendantIds, getContextChildren } from './_wiki-utils.js';

  interface ContextItem {
    id: string;
    parentId: string | null;
    name: string;
    [key: string]: unknown;
  }

  interface ArticleItem {
    id: string;
    primaryContextId: string;
    [key: string]: unknown;
  }

  interface Props {
    category: ContextItem;
    depth?: number;
    categories: ContextItem[];
    articles: ArticleItem[];
    openIds: Set<string>;
    activeCategoryId: string;
    ontoggle: (id: string) => void;
  }

  const {
    category,
    depth = 0,
    categories,
    articles,
    openIds,
    activeCategoryId,
    ontoggle
  }: Props = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const children = $derived(getContextChildren(category.id, categories));
  const hasChildren = $derived(children.length > 0);
  const isOpen = $derived(openIds.has(category.id));
  const isActive = $derived(activeCategoryId === category.id);
  const articleCount = $derived.by(() => {
    const contextIds = new Set(getAllDescendantIds(category.id, categories));
    return articles.filter((a) => contextIds.has(a.primaryContextId)).length;
  });

  let renaming = $state(false);
  let renameValue = $state('');
  let addingChild = $state(false);
  let newChildName = $state('');

  const updateContextMut = createMutation(() => ({
    mutationFn: (input: { id: string; name: string }) =>
      trpc.wiki.contexts.update.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
    }
  }));

  const createContextMut = createMutation(() => ({
    mutationFn: (input: { name: string; parentId: string | null }) =>
      trpc.wiki.contexts.create.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
    }
  }));

  const removeContextMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.wiki.contexts.remove.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
    }
  }));

  function startRename() {
    renameValue = category.name;
    renaming = true;
  }

  function commitRename() {
    if (renameValue.trim()) {
      updateContextMut.mutate({ id: category.id, name: renameValue.trim() });
    }
    renaming = false;
  }

  function cancelRename() {
    renaming = false;
  }

  function commitAddChild() {
    const name = newChildName.trim();
    if (!name) {
      addingChild = false;
      return;
    }
    createContextMut.mutate({ name, parentId: category.id });
    if (!openIds.has(category.id)) ontoggle(category.id);
    newChildName = '';
    addingChild = false;
  }
</script>

<div>
  <div
    class={cn('group/cat flex items-center gap-0.5 rounded-md', isActive && 'bg-sidebar-accent')}
  >
    {#if hasChildren || addingChild}
      <Collapsible.Root>
        <Collapsible.Trigger
          class="p-1 rounded hover:bg-sidebar-accent/60 transition-colors shrink-0 cursor-pointer"
          onclick={() => ontoggle(category.id)}
        >
          <ChevronRight
            class={cn(
              'size-3 text-muted-foreground transition-transform duration-150',
              isOpen && 'rotate-90'
            )}
          />
        </Collapsible.Trigger>
      </Collapsible.Root>
    {:else}
      <div class="w-5 shrink-0"></div>
    {/if}

    {#if renaming}
      <div class="flex items-center gap-1 flex-1 py-1 pr-1 min-w-0">
        <input
          bind:value={renameValue}
          class="flex-1 min-w-0 text-sm bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/50"
          onkeydown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') cancelRename();
          }}
          autofocus
        />
        <button onclick={commitRename} class="text-primary hover:opacity-80">
          <Check class="size-3" />
        </button>
        <button onclick={cancelRename} class="text-muted-foreground hover:opacity-80">
          <X class="size-3" />
        </button>
      </div>
    {:else}
      <a
        href="/wiki/category/{category.id}"
        class={cn(
          'flex items-center gap-2 flex-1 px-1 py-1.5 text-sm transition-colors hover:text-foreground min-w-0',
          isActive ? 'text-sidebar-accent-foreground font-medium' : 'text-muted-foreground'
        )}
        style="padding-left: {depth * 4}px"
      >
        {#if isActive}
          <FolderOpen class="size-3.5 shrink-0 text-primary" />
        {:else}
          <Folder class="size-3.5 shrink-0" />
        {/if}
        <span class="flex-1 truncate">{category.name}</span>
        {#if articleCount > 0}
          <span class="text-xs tabular-nums opacity-60">{articleCount}</span>
        {/if}
      </a>

      <div
        class="flex items-center gap-0.5 opacity-0 group-hover/cat:opacity-100 transition-opacity pr-1 shrink-0"
      >
        <button
          class="p-0.5 rounded hover:bg-sidebar-accent/60 text-muted-foreground hover:text-foreground transition-colors"
          onclick={() => {
            addingChild = true;
            if (!openIds.has(category.id)) ontoggle(category.id);
          }}
          title="Add subcategory"
        >
          <Plus class="size-3" />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <button
                class="p-0.5 rounded hover:bg-sidebar-accent/60 text-muted-foreground hover:text-foreground transition-colors"
                title="Category options"
                {...props}
              >
                <Ellipsis class="size-3" />
              </button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content class="w-36">
            <DropdownMenu.Item class="gap-2 cursor-pointer" onclick={startRename}>
              <Pencil class="size-3.5" /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              class="gap-2 cursor-pointer text-destructive focus:text-destructive"
              onclick={() => removeContextMut.mutate(category.id)}
            >
              <Trash2 class="size-3.5" /> Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {/if}
  </div>

  <Collapsible.Root open={isOpen}>
    <Collapsible.Content>
      <div class="ml-3 border-l border-border/30 pl-1">
        {#each children as child (child.id)}
          <CategoryTreeItem
            category={child}
            depth={depth + 1}
            {categories}
            {articles}
            {openIds}
            {activeCategoryId}
            {ontoggle}
          />
        {/each}

        {#if addingChild}
          <div class="flex items-center gap-1 py-1 pl-2 pr-1">
            <Folder class="size-3 text-muted-foreground shrink-0" />
            <input
              bind:value={newChildName}
              placeholder="Context name…"
              class="flex-1 min-w-0 text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/50"
              onkeydown={(e) => {
                if (e.key === 'Enter') commitAddChild();
                if (e.key === 'Escape') {
                  addingChild = false;
                  newChildName = '';
                }
              }}
              autofocus
            />
            <button onclick={commitAddChild} class="text-primary hover:opacity-80">
              <Check class="size-3" />
            </button>
            <button
              onclick={() => {
                addingChild = false;
                newChildName = '';
              }}
              class="text-muted-foreground hover:opacity-80"
            >
              <X class="size-3" />
            </button>
          </div>
        {/if}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
</div>
