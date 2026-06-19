<script lang="ts">
  import { tick } from 'svelte';
  import ListTree from '@lucide/svelte/icons/list-tree';
  import { applyArticleHeadingIds, extractArticleOutline } from './_article-outline.js';

  let {
    json,
    container = null,
    class: className = '',
  } = $props<{
    json: unknown;
    container?: HTMLElement | null;
    class?: string;
  }>();

  const outline = $derived(extractArticleOutline(json));

  $effect(() => {
    outline;
    container;

    tick().then(() => {
      applyArticleHeadingIds(container, outline);
    });
  });

  function jumpTo(id: string) {
    const heading = container?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<aside class={`hidden xl:flex w-60 shrink-0 flex-col border-r bg-background/80 ${className}`}>
  <div class="sticky top-0 flex max-h-full flex-col overflow-hidden">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      <ListTree class="size-3.5 text-muted-foreground" />
      <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Outline
      </span>
    </div>

    <div class="flex-1 overflow-y-auto py-2">
      {#if outline.length > 0}
        <nav class="flex flex-col gap-0.5 px-2">
          {#each outline as item (item.id)}
            <button
              type="button"
              onclick={() => jumpTo(item.id)}
              class="min-h-7 rounded px-2 py-1 text-left text-xs leading-5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              style={`margin-left: ${(item.level - 1) * 0.75}rem;`}
              title={item.text}
            >
              <span class="line-clamp-2">{item.text}</span>
            </button>
          {/each}
        </nav>
      {:else}
        <p class="px-3 py-2 text-xs leading-5 text-muted-foreground/70">
          Add headings to build an outline.
        </p>
      {/if}
    </div>
  </div>
</aside>
