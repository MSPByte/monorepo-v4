<script lang="ts">
  import type { Snippet } from 'svelte';
  import PanelMarks from '$lib/components/ui/panel-marks.svelte';

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
  <PanelMarks />

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
