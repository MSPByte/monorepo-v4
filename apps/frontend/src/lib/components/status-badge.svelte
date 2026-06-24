<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants';

  const badgeVariants = tv({
    base: 'border rounded-sm text-xs h-fit gap-1.5 px-2 pt-0.5',
    variants: {
      variant: {
        default: 'border-success/50 text-success bg-success/10',
        critical: 'border-destructive/75 text-destructive bg-destructive/15',
        high: 'border-destructive/50 text-destructive bg-destructive/5',
        medium: 'border-warning/50 text-warning bg-warning/10',
        low: 'border-foreground/50 text-foreground bg-foreground/10',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    href,
    class: className,
    variant = 'default',
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    variant?: BadgeVariant;
  } = $props();
</script>

<svelte:element
  this={href ? 'a' : 'span'}
  bind:this={ref}
  data-slot="badge"
  {href}
  class={cn(badgeVariants({ variant }), className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
