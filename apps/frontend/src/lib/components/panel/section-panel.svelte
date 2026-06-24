<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    code,
    title,
    aside,
    children,
    class: className = '',
  }: {
    code?: string;
    title: string;
    aside?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();
</script>

<section class={`relative bg-card ${className}`}>
  <!-- corner registration marks -->
  <span class="pointer-events-none absolute -left-px -top-px size-1.5 border-l border-t border-foreground/40"></span>
  <span class="pointer-events-none absolute -right-px -top-px size-1.5 border-r border-t border-foreground/40"></span>
  <span class="pointer-events-none absolute -bottom-px -left-px size-1.5 border-b border-l border-foreground/40"></span>
  <span class="pointer-events-none absolute -bottom-px -right-px size-1.5 border-b border-r border-foreground/40"></span>

  <header class="flex items-baseline justify-between gap-3 border border-border/70 border-b-foreground/30 bg-muted/40 px-4 py-2">
    <div class="flex items-baseline gap-2">
      {#if code}
        <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{code}</span>
      {/if}
      <h2 class="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground">{title}</h2>
    </div>
    {#if aside}
      <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {@render aside()}
      </div>
    {/if}
  </header>

  <div class="border border-t-0 border-border/70 px-4 py-3">
    {@render children()}
  </div>
</section>
