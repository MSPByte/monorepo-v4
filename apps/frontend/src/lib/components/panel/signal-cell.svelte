<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    code,
    label,
    value,
    detail,
    tone = 'default',
    onclick,
    href,
    children,
    class: className = '',
  }: {
    code?: string;
    label: string;
    value?: string | number;
    detail?: string;
    tone?: 'default' | 'primary' | 'warning' | 'destructive' | 'muted';
    onclick?: () => void;
    href?: string;
    children?: Snippet;
    class?: string;
  } = $props();

  const toneClass = $derived(
    tone === 'destructive'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'primary'
          ? 'text-primary'
          : tone === 'muted'
            ? 'text-muted-foreground'
            : 'text-foreground'
  );

  const interactive = $derived(!!onclick || !!href);
  const Tag = $derived(href ? 'a' : onclick ? 'button' : 'div');
</script>

<svelte:element
  this={Tag}
  {href}
  {onclick}
  type={Tag === 'button' ? 'button' : undefined}
  role={Tag === 'div' ? undefined : Tag === 'button' ? 'button' : 'link'}
  class={cn(
    'group relative flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-2.5 text-left transition-colors',
    interactive && 'cursor-pointer hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus-visible:outline-none',
    className,
  )}
>
  <div class="flex items-baseline gap-1.5 min-w-0">
    {#if code}
      <span class="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/70">{code}</span>
    {/if}
    <span class="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
    {#if interactive}
      <span class="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        filter →
      </span>
    {/if}
  </div>

  {#if children}
    {@render children()}
  {:else if value !== undefined}
    <div class={cn('font-mono text-xl font-semibold leading-none tabular-nums', toneClass)}>
      {value}
    </div>
  {/if}

  {#if detail}
    <div class="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
      {detail}
    </div>
  {/if}
</svelte:element>
