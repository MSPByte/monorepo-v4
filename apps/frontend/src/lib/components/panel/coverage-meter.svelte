<script lang="ts">
  let {
    value,
    max = 100,
    segments = 14,
  }: { value: number; max?: number; segments?: number } = $props();

  const ratio = $derived(Math.max(0, Math.min(1, value / max)));
  const filled = $derived(Math.round(ratio * segments));
  const tone = $derived(
    ratio >= 0.9
      ? 'bg-primary'
      : ratio >= 0.7
        ? 'bg-foreground/70'
        : ratio >= 0.5
          ? 'bg-warning'
          : 'bg-destructive'
  );
</script>

<div class="flex gap-[2px]" aria-hidden="true">
  {#each Array(segments) as _, i (i)}
    <span class={`h-1.5 flex-1 ${i < filled ? tone : 'bg-foreground/10'}`}></span>
  {/each}
</div>
