<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    entityType,
    title,
    subtitle,
    breadcrumb,
    pills,
    ribbon,
    actions,
    class: className,
  }: {
    entityType: string;
    title: string;
    subtitle?: string | null;
    breadcrumb?: string | null;
    pills: Snippet;
    ribbon?: Snippet;
    actions?: Snippet;
    class?: string;
  } = $props();
</script>

<header class={cn('border-b border-foreground/15 bg-card', className)}>
  <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-4">
    <div class="flex items-baseline gap-3">
      <div class="min-w-0 flex-1">
        <div
          class="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          <span class="font-semibold text-foreground/80">{entityType}</span>
          {#if breadcrumb}
            <span class="text-foreground/40">·</span>
            <span class="truncate">{breadcrumb}</span>
          {/if}
        </div>
        <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">{title}</h1>
        {#if subtitle}
          <p class="mt-0.5 max-w-3xl truncate text-xs text-muted-foreground">{subtitle}</p>
        {/if}
      </div>
    </div>
    {#if actions}
      {@render actions()}
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-6 pb-2 font-mono text-[10.5px]">
    {@render pills()}
  </div>

  {#if ribbon}
    <div
      class="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 bg-muted/30 px-6 py-2.5 font-mono text-[12px] text-foreground"
    >
      {@render ribbon()}
    </div>
  {/if}
</header>
