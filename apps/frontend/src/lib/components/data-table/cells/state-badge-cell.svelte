<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';

  type Variant = 'info' | 'warn' | 'destructive' | 'critical' | 'success';

  let {
    value,
    transform,
    evaluate,
  }: {
    value: unknown;
    transform?: (value: unknown) => string;
    evaluate?: (value: unknown) => Variant;
  } = $props();

  const variant = $derived(evaluate ? evaluate(value) : null);
  const variantClass = $derived.by(() => {
    switch (variant) {
      case 'warn':
        return 'bg-warning/15 text-warning border border-warning/30';
      case 'success':
        return 'bg-success/15 text-success border border-success/30';
      case 'destructive':
        return 'bg-destructive/15 text-destructive border border-destructive/30';
      case 'critical':
        return 'bg-destructive/15 text-destructive border border-destructive/70';
      default:
        return 'bg-muted/15 text-muted-foreground border border-muted/30';
    }
  });
</script>

{#if variant === null || variant === undefined}
  <span class="text-muted-foreground">—</span>
{:else}
  <Badge variant="outline" class={variantClass}>
    {transform ? transform(value) : value}
  </Badge>
{/if}
