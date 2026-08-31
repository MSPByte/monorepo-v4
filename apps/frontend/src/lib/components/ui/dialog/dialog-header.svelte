<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  data-slot="dialog-header"
  class={cn('flex shrink-0 flex-col gap-2 border-b border-b-foreground/20 bg-muted/40 p-4', className)}
  {...restProps}
>
  {@render children?.()}
</div>
