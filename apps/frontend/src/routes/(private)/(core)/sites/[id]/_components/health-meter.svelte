<script lang="ts">
  let {
    label,
    score,
    max = 100,
    detail,
  }: {
    label: string;
    score: number;
    max?: number;
    detail?: string;
  } = $props();

  const ratio = $derived(Math.max(0, Math.min(1, score / max)));
  const tone = $derived(
    ratio >= 0.9 ? 'text-primary' : ratio >= 0.7 ? 'text-foreground' : ratio >= 0.5 ? 'text-warning' : 'text-destructive'
  );
  // 14 segments for a chunky meter
  const segments = 14;
  const filled = $derived(Math.round(ratio * segments));
</script>

<div class="space-y-1.5">
  <div class="flex items-baseline justify-between">
    <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
    <span class={`font-mono text-base font-semibold tabular-nums ${tone}`}>
      {score}<span class="text-[10px] text-muted-foreground">/{max}</span>
    </span>
  </div>
  <div class="flex gap-[3px]" aria-hidden="true">
    {#each Array(segments) as _, i (i)}
      <span
        class={`h-2 flex-1 ${
          i < filled
            ? ratio >= 0.9
              ? 'bg-primary'
              : ratio >= 0.7
                ? 'bg-foreground/70'
                : ratio >= 0.5
                  ? 'bg-warning'
                  : 'bg-destructive'
            : 'bg-foreground/10'
        }`}
      ></span>
    {/each}
  </div>
  {#if detail}
    <p class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{detail}</p>
  {/if}
</div>
