<script lang="ts">
  import type { ProfileMetric } from '../_profile/client-profile.types';
  import SourceGlyph from './source-glyph.svelte';

  let { metric }: { metric: ProfileMetric } = $props();

  const display = $derived.by(() => {
    if (!metric.supported) return 'not collected';
    if (metric.value === null || metric.value === undefined || metric.value === '') return '—';
    if (typeof metric.value === 'number') return metric.value.toLocaleString();
    return String(metric.value);
  });
</script>

<div
  class="grid grid-cols-[108px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border/50 py-[7px] last:border-b-0"
>
  <dt class="font-mono text-[10px] uppercase leading-tight tracking-wider text-muted-foreground">
    {metric.label}
  </dt>
  <dd class="flex min-w-0 items-center gap-2 text-sm">
    {#if !metric.supported}
      <span class="size-2"></span>
      <span class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">not collected</span>
    {:else}
      <SourceGlyph source="generated" />
      <span class="truncate font-mono text-[13px] tabular-nums text-foreground">{display}</span>
    {/if}
  </dd>
  <dd class="whitespace-nowrap text-right font-mono text-[10px] text-muted-foreground/60">
    {#if metric.supported}
      <span class="hidden lg:inline">{metric.origin}</span>
    {/if}
  </dd>
</div>
