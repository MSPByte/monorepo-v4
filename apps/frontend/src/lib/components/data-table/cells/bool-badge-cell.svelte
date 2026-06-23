<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';

  let {
    value,
    trueLabel = 'Yes',
    falseLabel = 'No',
    falseVariant = 'muted',
    evaluate,
  }: {
    value: unknown;
    trueLabel?: string;
    falseLabel?: string;
    falseVariant?: 'muted' | 'destructive';
    evaluate?: (value: unknown) => boolean | undefined;
  } = $props();

  const boolValue = $derived(evaluate ? evaluate(value) : (value as boolean | undefined));

  const falseClass = $derived(
    falseVariant === 'destructive'
      ? 'bg-destructive/15 text-destructive border-destructive/30'
      : 'bg-warning/15 text-warning border-warning/30'
  );
</script>

{#if boolValue === null || boolValue === undefined}
  <span class="text-muted-foreground">—</span>
{:else}
  <Badge
    variant="outline"
    class={boolValue === undefined ? '' : boolValue ? 'bg-success/15 text-success border-success/30' : falseClass}
  >
    {boolValue === undefined ? '-' : boolValue ? trueLabel : falseLabel}
  </Badge>
{/if}
