<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { Pencil, Trash2 } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Button from '$lib/components/ui/button/button.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { serializeFilters } from '$lib/components/data-table/utils/filters';
  import type { TableFilter } from '$lib/components/data-table/types';
  type Tone = 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
  type ChartPoint = { label: string; value: number; scopeLinkId?: string };
  type Filter = { column: string; operator: string; value?: string | number | boolean };
  type Tile = {
    key: string;
    id?: string;
    title: string;
    kind?: string;
    tone: Tone;
    caption: string;
    width?: string;
    height?: string;
    format?: string;
    route?: string | null;
    filters?: Filter[];
    groupBy?: string;
    thresholds?: Array<{ at: number | string; tone: Tone }>;
  };
  let {
    tile,
    editable = false,
    onedit,
    onremove,
  }: { tile: Tile; editable?: boolean; onedit?: () => void; onremove?: () => void } = $props();
  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  let refreshKey = $state(0);
  const query = createQuery(() => ({
    queryKey: ['dashboards.runTile', tile.id ?? tile.key, refreshKey],
    queryFn: () =>
      tile.id ? trpc.dashboards.runTile.mutate({ tileId: tile.id }) : Promise.resolve({ value: 0 }),
    enabled: Boolean(tile.id),
  }));
  $effect(() => {
    const refresh = () => refreshKey++;
    window.addEventListener('reports:scope-changed', refresh);
    return () => window.removeEventListener('reports:scope-changed', refresh);
  });
  function toneFor(value: number): Tone {
    return (
      [...(tile.thresholds ?? [])]
        .map((threshold) => ({ ...threshold, at: Number(threshold.at) }))
        .filter((threshold) => Number.isFinite(threshold.at) && threshold.at >= 0)
        .sort((a, b) => a.at - b.at)
        .filter((threshold) => value >= threshold.at)
        .at(-1)?.tone ?? tile.tone
    );
  }
  function textClass(tone: Tone) {
    return tone === 'primary'
      ? 'text-primary'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-500'
        : tone === 'danger'
          ? 'text-destructive'
          : tone === 'success'
            ? 'text-emerald-600 dark:text-emerald-500'
            : 'text-foreground';
  }
  function fillClass(tone: Tone) {
    return tone === 'primary'
      ? 'bg-primary/80'
      : tone === 'warning'
        ? 'bg-amber-500/85'
        : tone === 'danger'
          ? 'bg-destructive/85'
          : tone === 'success'
            ? 'bg-emerald-500/85'
            : 'bg-foreground/70';
  }
  const totalTone = $derived(toneFor(query.data?.value ?? 0));
  const value = $derived(
    query.isLoading
      ? '…'
      : query.isError
        ? '—'
        : tile.format === 'percent'
          ? `${query.data?.value ?? 0}%`
          : (query.data?.value ?? 0).toLocaleString()
  );
  const chart = $derived((query.data as { chart?: ChartPoint[] } | undefined)?.chart ?? []);
  const max = $derived(Math.max(...chart.map((item) => item.value), 1));
  function drilldownHref(extra?: Filter, scopeLinkId?: string) {
    if (!tile.route) return undefined;
    const filters: TableFilter[] = [...(tile.filters ?? []), ...(extra ? [extra] : [])].map(
      (filter, index) => ({
        id: `dashboard-${index}-${filter.column}`,
        field: filter.column,
        operator: filter.operator as TableFilter['operator'],
        value: filter.value,
      })
    );
    const params = new URLSearchParams({ filters: serializeFilters(filters) });
    if (scopeLinkId) params.set('linkId', scopeLinkId);
    return `${tile.route}?${params}`;
  }
</script>

<article
  class="group relative flex min-h-36 flex-col overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-foreground/20 {tile.height ===
  'tall'
    ? 'min-h-72'
    : tile.height === 'compact'
      ? 'min-h-28'
      : ''}"
>
  <div class="flex items-start justify-between gap-3">
    <a
      href={drilldownHref()}
      class="text-muted-foreground cursor-pointer text-left text-[11px] font-semibold uppercase tracking-[0.14em] hover:text-foreground"
      >{tile.title}</a
    >{#if tile.kind === 'bar' || tile.kind === 'line' || tile.kind === 'donut'}<span
        class="font-mono text-sm font-semibold tabular-nums {textClass(totalTone)}">{value}</span
      >{/if}{#if editable}<div class="flex opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" class="size-7" onclick={onedit} aria-label="Edit widget"
          ><Pencil class="size-3.5" /></Button
        ><Button
          variant="ghost"
          size="icon"
          class="size-7"
          onclick={onremove}
          aria-label="Remove widget"><Trash2 class="size-3.5" /></Button
        >
      </div>{/if}
  </div>
  {#if query.isLoading}<div class="flex flex-1 items-center justify-center">
      <Loader />
    </div>{:else if tile.kind === 'bar' || tile.kind === 'line' || tile.kind === 'donut'}<div
      class="mt-3 flex min-h-0 flex-1 items-end gap-2"
    >
      {#each chart as item}{@const itemTone = toneFor(item.value)}<a
          href={drilldownHref(
            item.scopeLinkId
              ? undefined
              : tile.groupBy
                ? {
                    column: tile.groupBy,
                    operator: 'eq',
                    value: item.label === 'Unspecified' ? undefined : item.label,
                  }
                : undefined,
            item.scopeLinkId
          )}
          class="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1"
          ><span class="font-mono text-[10px] font-medium tabular-nums {textClass(itemTone)}"
            >{item.value}</span
          >
          <div
            class="w-full rounded-sm transition-opacity hover:opacity-70 {fillClass(itemTone)}"
            style={`height: ${Math.max(8, (item.value / max) * 110)}px`}
          ></div>
          <span class="text-muted-foreground w-full truncate text-center text-[10px]"
            >{item.label}</span
          ></a
        >{/each}{#if !chart.length}<span class="text-muted-foreground text-sm"
          >No chart data in this scope.</span
        >{/if}
    </div>{:else}<a
      href={drilldownHref()}
      class="mt-auto cursor-pointer text-left font-mono text-4xl font-semibold tabular-nums {textClass(
        totalTone
      )}">{value}</a
    >{/if}
  {#if tile.caption}<p class="text-muted-foreground mt-3 text-xs">
      {tile.caption}
    </p>{:else if query.isError}<p class="text-destructive mt-3 text-xs">
      Could not load this widget.
    </p>{/if}
</article>
