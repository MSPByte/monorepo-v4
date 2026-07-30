<script lang="ts">
  type Buckets = { critical: number; high: number; medium: number; low: number };

  let {
    buckets,
    total,
    compact = false,
  }: { buckets: Buckets; total?: number; compact?: boolean } = $props();

  const sum = $derived(total ?? buckets.critical + buckets.high + buckets.medium + buckets.low);
  const segments = 20;

  const filled = $derived.by(() => {
    if (sum === 0) return { c: 0, h: 0, m: 0, l: 0 };
    const c = Math.round((buckets.critical / sum) * segments);
    const h = Math.round((buckets.high / sum) * segments);
    const m = Math.round((buckets.medium / sum) * segments);
    const l = Math.max(0, segments - c - h - m);
    return { c, h, m, l };
  });
</script>

<div class="space-y-1">
  <div class="flex gap-[2px]" aria-hidden="true">
    {#each Array(filled.c) as _, i (`c-${i}`)}
      <span class={`${compact ? 'h-1' : 'h-1.5'} flex-1 bg-destructive`}></span>
    {/each}
    {#each Array(filled.h) as _, i (`h-${i}`)}
      <span class={`${compact ? 'h-1' : 'h-1.5'} flex-1 bg-destructive/60`}></span>
    {/each}
    {#each Array(filled.m) as _, i (`m-${i}`)}
      <span class={`${compact ? 'h-1' : 'h-1.5'} flex-1 bg-warning`}></span>
    {/each}
    {#each Array(filled.l) as _, i (`l-${i}`)}
      <span class={`${compact ? 'h-1' : 'h-1.5'} flex-1 bg-foreground/15`}></span>
    {/each}
  </div>
  {#if !compact}
    <div class="flex gap-3 font-mono text-[10px] uppercase tracking-wider">
      {#if buckets.critical}
        <span class="text-destructive"><span class="tabular-nums">{buckets.critical}</span>c</span>
      {/if}
      {#if buckets.high}
        <span class="text-destructive/70"><span class="tabular-nums">{buckets.high}</span>h</span>
      {/if}
      {#if buckets.medium}
        <span class="text-warning"><span class="tabular-nums">{buckets.medium}</span>m</span>
      {/if}
      {#if buckets.low}
        <span class="text-muted-foreground"><span class="tabular-nums">{buckets.low}</span>l</span>
      {/if}
      {#if sum === 0}
        <span class="text-muted-foreground/70">all clear</span>
      {/if}
    </div>
  {/if}
</div>
