<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { getContextPath } from './_wiki-utils.js';

  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  interface Props {
    children: Snippet;
  }

  const { children }: Props = $props();

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

  let wrapperEl = $state<HTMLDivElement | undefined>();
  let activeKbId = $state<string | null>(null);
  let popoverX = $state(0);
  let popoverY = $state(0);

  const activeArticle = $derived.by(() => {
    if (!activeKbId) return null;
    const match = activeKbId.match(/^KB(\d+)$/i);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    return allArticles.find((a) => a.kbNumber === num) ?? null;
  });

  const activeContextPath = $derived(
    activeArticle ? getContextPath(activeArticle.primaryContextId, allContexts) : []
  );

  function positionNear(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    popoverX = Math.min(rect.left, window.innerWidth - 272);
    popoverY = rect.bottom + 6;
  }

  $effect(() => {
    const wrapper = wrapperEl;
    if (!wrapper) return;

    function onMouseOver(e: MouseEvent) {
      const target = (e.target as Element).closest('[data-kb-id]') as HTMLElement | null;
      if (target) {
        activeKbId = target.dataset.kbId ?? null;
        positionNear(target);
      }
    }

    function onClick(e: MouseEvent) {
      const target = (e.target as Element).closest('[data-kb-id]') as HTMLElement | null;
      if (target?.dataset.kbId && activeArticle) {
        e.preventDefault();
        window.open(`/wiki/${activeArticle.id}`, '_blank', 'noopener,noreferrer');
      }
    }

    function onMouseOut(e: MouseEvent) {
      const related = e.relatedTarget as Element | null;
      if (!related?.closest('[data-kb-id]') && !related?.closest('.kb-popover')) {
        activeKbId = null;
      }
    }

    function onScroll() {
      activeKbId = null;
    }

    wrapper.addEventListener('mouseover', onMouseOver);
    wrapper.addEventListener('mouseout', onMouseOut);
    wrapper.addEventListener('click', onClick);
    document.addEventListener('scroll', onScroll, { capture: true });

    return () => {
      wrapper.removeEventListener('mouseover', onMouseOver);
      wrapper.removeEventListener('mouseout', onMouseOut);
      wrapper.removeEventListener('click', onClick);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  });
</script>

<div bind:this={wrapperEl} style="display: contents">
  {@render children()}
</div>

{#if activeArticle}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="kb-popover fixed z-50 w-64 rounded-lg border bg-popover text-popover-foreground shadow-lg p-3 flex flex-col gap-2"
    style="left: {popoverX}px; top: {popoverY}px;"
    onmouseleave={(e) => {
      const related = e.relatedTarget as Element | null;
      if (!related?.closest('[data-kb-id]')) activeKbId = null;
    }}
  >
    <div class="flex items-start gap-2">
      <span
        class="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 mt-0.5"
      >
        {activeArticle.kbId}
      </span>
      <p class="text-sm font-semibold leading-tight">{activeArticle.title}</p>
    </div>

    {#if activeContextPath.length > 0}
      <div class="flex items-center gap-1 flex-wrap">
        {#each activeContextPath as cat, i (cat.id)}
          {#if i > 0}
            <ChevronRight class="size-2.5 text-muted-foreground/50 shrink-0" />
          {/if}
          <span class="text-xs text-muted-foreground">{cat.name}</span>
        {/each}
      </div>
    {/if}

    {#if activeArticle.tags.length > 0}
      <div class="flex gap-1 flex-wrap">
        {#each activeArticle.tags.slice(0, 3) as tag (tag.id)}
          <span
            class="text-xs px-1.5 py-0 rounded-full border"
            style="background-color: {tag.color}18; color: {tag.color}; border-color: {tag.color}30"
          >
            {tag.name}
          </span>
        {/each}
        {#if activeArticle.tags.length > 3}
          <span class="text-xs text-muted-foreground">+{activeArticle.tags.length - 3}</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}
