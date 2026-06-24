<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import SectionPanel from '../_components/section-panel.svelte';
  import { useSiteContext } from '../_components/site-context';
  import { formatRelativeDate } from '$lib/utils/format';
  import Plus from '@lucide/svelte/icons/plus';
  import FileText from '@lucide/svelte/icons/file-text';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

  const ctx = useSiteContext();
  const site = $derived(ctx.site!);

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const overridesQuery = createQuery(() => ({
    queryKey: ['wiki.overrides.listForSite', site?.id],
    queryFn: () => trpc.wiki.overrides.listForSite.query({ siteId: site!.id }),
    enabled: !!site?.id,
  }));

  const recentQuery = createQuery(() => ({
    queryKey: ['wiki.articles.recent', { limit: 12 }],
    queryFn: () => trpc.wiki.articles.recent.query({ limit: 12 }),
  }));

  const typeTone: Record<string, string> = {
    addendum: 'border-primary/40 bg-primary/[0.06] text-primary',
    replacement: 'border-warning/50 bg-warning/[0.06] text-warning',
    note: 'border-foreground/15 bg-foreground/[0.04] text-foreground/80',
  };

  function formatKb(n: number) {
    return `KB${String(n).padStart(3, '0')}`;
  }
</script>

<div class="mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:p-6">
  <!-- Site-scoped overrides -->
  <SectionPanel code="W·1" title="SITE OVERRIDES">
    {#snippet aside()}
      <a href={`/wiki`} class="inline-flex items-center gap-1 hover:text-foreground">
        <Plus class="size-3" /> new override
      </a>
    {/snippet}

    {#if overridesQuery.isLoading}
      <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">loading…</p>
    {:else if !overridesQuery.data?.length}
      <div class="space-y-2 py-2">
        <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          ▯ no site-specific overrides
        </p>
        <p class="max-w-md text-sm leading-snug text-muted-foreground">
          Wiki articles apply globally. Create an override here when this site needs an addendum,
          a replacement procedure, or a tactical note that only applies inside its environment.
        </p>
      </div>
    {:else}
      <ul class="divide-y divide-border/40">
        {#each overridesQuery.data as override}
          <li>
            <a
              href={`/wiki/article/${override.articleId}`}
              class="group flex items-baseline gap-3 py-2.5 hover:bg-muted/40"
            >
              <span
                class={`inline-flex shrink-0 rounded-[3px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${typeTone[override.type] ?? typeTone.note}`}
              >
                {override.type}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <span class="font-mono text-[10px] text-muted-foreground">{formatKb(override.articleKbNumber)}</span>
                  <span class="truncate font-medium">{override.title}</span>
                </div>
                <div class="mt-0.5 truncate text-xs text-muted-foreground">
                  on <span class="text-foreground/80">{override.articleTitle}</span>
                  · updated {formatRelativeDate(override.updatedAt)}
                </div>
              </div>
              <ArrowUpRight class="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </SectionPanel>

  <!-- Sidebar: relevant articles -->
  <aside class="space-y-4">
    <SectionPanel code="W·2" title="RECENT ARTICLES">
      {#snippet aside()}
        <a href="/wiki" class="hover:text-foreground">browse all</a>
      {/snippet}
      {#if recentQuery.isLoading}
        <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">loading…</p>
      {:else if !recentQuery.data?.length}
        <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">no articles yet</p>
      {:else}
        <ul class="space-y-1.5">
          {#each recentQuery.data as article}
            <li>
              <a
                href={`/wiki/article/${article.id}`}
                class="group flex items-baseline gap-2 py-1 text-sm hover:text-primary"
              >
                <FileText class="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                <span class="font-mono text-[10px] text-muted-foreground">{article.kbId}</span>
                <span class="truncate">{article.title}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </SectionPanel>

    <SectionPanel code="W·3" title="HOW OVERRIDES WORK">
      <ul class="space-y-2 text-xs leading-snug text-muted-foreground">
        <li class="flex gap-2">
          <span class="font-mono text-foreground/70">addendum</span>
          <span>appends to the article only when read in this site's context.</span>
        </li>
        <li class="flex gap-2">
          <span class="font-mono text-foreground/70">replacement</span>
          <span>swaps out the article body entirely for this site.</span>
        </li>
        <li class="flex gap-2">
          <span class="font-mono text-foreground/70">note</span>
          <span>a sticky callout shown alongside the article.</span>
        </li>
      </ul>
    </SectionPanel>
  </aside>
</div>
