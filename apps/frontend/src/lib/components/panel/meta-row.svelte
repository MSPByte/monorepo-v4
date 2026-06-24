<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    label: string;
    value?: string | number | null;
    href?: string;
    mono?: boolean;
    fallback?: string;
    children?: Snippet;
  };
  let { label, value, href, mono = false, fallback = '—', children }: Props = $props();

  const display = $derived.by(() => {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'number') return value.toLocaleString();
    return String(value);
  });

  const isEmpty = $derived(display === fallback);
</script>

<div
  class="grid grid-cols-[108px_minmax(0,1fr)] items-baseline gap-3 border-b border-border/50 py-[7px] last:border-b-0"
>
  <dt class="font-mono text-[10px] uppercase leading-tight tracking-wider text-muted-foreground">
    {label}
  </dt>
  <dd class="min-w-0 text-sm">
    {#if children}
      {@render children()}
    {:else if isEmpty}
      <span class="font-mono text-[12px] text-muted-foreground/60">{fallback}</span>
    {:else if href}
      <a {href} class={`truncate hover:underline ${mono ? 'font-mono text-[13px] tabular-nums' : ''}`}>{display}</a>
    {:else if mono}
      <span class="truncate font-mono text-[13px] tabular-nums text-foreground">{display}</span>
    {:else}
      <span class="truncate">{display}</span>
    {/if}
  </dd>
</div>
