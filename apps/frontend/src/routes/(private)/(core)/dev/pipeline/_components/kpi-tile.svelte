<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    value,
    detail,
    tone = 'neutral',
    children,
  }: {
    label: string;
    value: string | number;
    detail?: string;
    tone?: 'neutral' | 'warning' | 'danger' | 'success';
    children?: Snippet;
  } = $props();

  const toneClass = $derived(
    tone === 'warning'
      ? 'text-warning'
      : tone === 'danger'
        ? 'text-destructive'
        : tone === 'success'
          ? 'text-success'
          : 'text-foreground'
  );
</script>

<div class="relative border border-border/70 bg-card px-4 py-3">
  <span class="pointer-events-none absolute -left-px -top-px size-1.5 border-l border-t border-foreground/40"></span>
  <span class="pointer-events-none absolute -right-px -top-px size-1.5 border-r border-t border-foreground/40"></span>
  <span class="pointer-events-none absolute -bottom-px -left-px size-1.5 border-b border-l border-foreground/40"></span>
  <span class="pointer-events-none absolute -bottom-px -right-px size-1.5 border-b border-r border-foreground/40"></span>
  <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
  <div class={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
  {#if detail}
    <div class="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">{detail}</div>
  {/if}
  {#if children}
    <div class="mt-2">{@render children()}</div>
  {/if}
</div>
