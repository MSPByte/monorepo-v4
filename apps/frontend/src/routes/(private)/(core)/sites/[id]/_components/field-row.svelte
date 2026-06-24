<script lang="ts" generics="T">
  import type { Field } from '../_profile/client-profile.types';
  import SourceGlyph from './source-glyph.svelte';
  import { formatRelativeDate } from '$lib/utils/format';

  type Props = {
    label: string;
    field: Field<T>;
    fallback?: string;
    format?: (v: T) => string;
  };
  let { label, field, fallback = '—', format }: Props = $props();

  const display = $derived.by(() => {
    const v = field.value;
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
      return fallback;
    }
    if (format) return format(v);
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'number') return v.toLocaleString();
    return String(v);
  });
</script>

<div
  class="grid grid-cols-[108px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border/50 py-[7px] last:border-b-0"
>
  <dt class="font-mono text-[10px] uppercase leading-tight tracking-wider text-muted-foreground">
    {label}
  </dt>
  <dd class="flex min-w-0 items-center gap-2 text-sm">
    <SourceGlyph source={field.source} />
    {#if display === fallback && field.value !== 0}
      <span class="font-mono text-[12px] text-muted-foreground/60">{fallback}</span>
    {:else if field.source === 'user_options'}
      <span class="inline-flex items-center rounded-[3px] bg-foreground/[0.07] px-1.5 py-px font-mono text-[11.5px] font-medium uppercase tracking-wider text-foreground">{display}</span>
    {:else if field.source === 'user_flex'}
      <span class="truncate italic text-foreground/95">{display}</span>
    {:else if field.source === 'generated'}
      <span class="truncate font-mono text-[13px] tabular-nums text-foreground">{display}</span>
    {:else}
      <span class="truncate">{display}</span>
    {/if}
  </dd>
  <dd class="whitespace-nowrap text-right font-mono text-[10px] text-muted-foreground/60">
    {#if field.source === 'generated' && field.origin}
      <span class="hidden lg:inline">{field.origin}</span>
      {#if field.updatedAt}
        <span class="ml-1 hidden xl:inline">· {formatRelativeDate(field.updatedAt)}</span>
      {/if}
    {/if}
  </dd>
</div>
