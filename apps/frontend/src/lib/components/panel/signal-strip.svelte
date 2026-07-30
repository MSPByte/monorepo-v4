<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    code,
    title,
    meta,
    loading = false,
    children,
    aside,
    class: className = '',
  }: {
    code?: string;
    title?: string;
    meta?: string;
    loading?: boolean;
    children: Snippet;
    aside?: Snippet;
    class?: string;
  } = $props();
</script>

<div class={cn('border-b border-border bg-muted/20', className)}>
  {#if title || meta || aside}
    <div
      class="flex items-baseline justify-between gap-3 border-b border-border/60 bg-background px-4 py-1.5"
    >
      <div class="flex min-w-0 items-baseline gap-2">
        {#if code}
          <span class="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground/70"
            >{code}</span
          >
        {/if}
        {#if title}
          <h2
            class="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground"
          >
            {title}
          </h2>
        {/if}
        {#if meta}
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70"
            >· {meta}</span
          >
        {/if}
      </div>
      {#if aside}
        <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {@render aside()}
        </div>
      {/if}
    </div>
  {/if}

  <div
    class={cn(
      'flex flex-wrap divide-x divide-border/60 sm:flex-nowrap',
      loading && 'animate-pulse opacity-60'
    )}
  >
    {@render children()}
  </div>
</div>
