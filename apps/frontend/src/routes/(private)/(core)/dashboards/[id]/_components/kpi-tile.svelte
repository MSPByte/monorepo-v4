<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { Pencil, Trash2 } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Button from '$lib/components/ui/button/button.svelte';

  type Tone = 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
  type TileDraft = {
    key: string;
    id?: string;
    title: string;
    reportId: string;
    tone: Tone;
    caption: string;
  };

  let {
    tile,
    editable = false,
    onedit,
    onremove,
  }: {
    tile: TileDraft;
    editable?: boolean;
    onedit?: () => void;
    onremove?: () => void;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  // Any change to the tile's report/aggregation invalidates the value.
  // Scope changes trigger a listener registered here so tiles refresh live.
  let refreshKey = $state(0);

  const query = createQuery(() => ({
    queryKey: ['dashboards.runTile', tile.reportId, refreshKey],
    queryFn: async () => {
      if (!tile.reportId) return { value: 0 };
      return trpc.dashboards.runTile.mutate({
        reportId: tile.reportId,
        viz: {
          aggregation: 'count',
          tone: tile.tone,
          format: 'number',
        },
      });
    },
    enabled: Boolean(tile.reportId),
  }));

  $effect(() => {
    const refresh = () => {
      refreshKey++;
    };
    window.addEventListener('reports:scope-changed', refresh);
    return () => window.removeEventListener('reports:scope-changed', refresh);
  });

  const toneClass = $derived(
    tile.tone === 'primary'
      ? 'text-primary'
      : tile.tone === 'warning'
        ? 'text-amber-600 dark:text-amber-500'
        : tile.tone === 'danger'
          ? 'text-destructive'
          : tile.tone === 'success'
            ? 'text-emerald-600 dark:text-emerald-500'
            : 'text-foreground',
  );

  const displayValue = $derived.by(() => {
    if (query.isLoading) return '…';
    if (query.isError) return '—';
    return (query.data?.value ?? 0).toLocaleString();
  });
</script>

<div
  class="group bg-background hover:border-foreground/20 relative flex flex-col gap-1 rounded-lg border p-4 shadow-sm transition-colors"
>
  <div class="text-muted-foreground flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider">
    {tile.title}
  </div>
  <div class="mt-1 font-mono text-3xl font-semibold tabular-nums {toneClass}">
    {displayValue}
  </div>
  {#if tile.caption}
    <div class="text-muted-foreground mt-1 text-xs">
      {tile.caption}
    </div>
  {:else if query.isError}
    <div class="text-destructive mt-1 text-xs">Failed to load.</div>
  {/if}

  {#if editable}
    <div
      class="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
    >
      {#if onedit}
        <Button
          variant="ghost"
          size="icon"
          class="size-6"
          onclick={onedit}
          aria-label="Edit tile"
        >
          <Pencil class="size-3.5" />
        </Button>
      {/if}
      {#if onremove}
        <Button
          variant="ghost"
          size="icon"
          class="size-6"
          onclick={onremove}
          aria-label="Remove tile"
        >
          <Trash2 class="size-3.5" />
        </Button>
      {/if}
    </div>
  {/if}
</div>
