<script lang="ts">
  import type { ProfileFact } from '../_profile/client-profile.types';
  import SourceGlyph from './source-glyph.svelte';
  import { formatRelativeDate } from '$lib/utils/format';

  let { label, fact }: { label: string; fact: ProfileFact } = $props();

  const isNotApplicable = $derived(fact.applicable === 'not_applicable');
  const isUnknown = $derived(
    fact.applicable === 'unknown' ||
      fact.value === null ||
      fact.value === undefined ||
      fact.value === '' ||
      (Array.isArray(fact.value) && fact.value.length === 0)
  );

  function labelForValue(value: string) {
    const special: Record<string, string> = {
      critical: 'Critical',
      mission_critical: 'Critical',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      active: 'Active',
      prospect: 'Prospect',
      former: 'Former',
      internal: 'Internal',
      standard: 'Standard',
      premium: 'Premium',
      enterprise: 'Enterprise',
      yes: 'Yes',
      no: 'No',
      unknown: 'Unknown',
      on_call: 'On call',
      cab_only: 'CAB only',
      business_hours: 'Business hours',
      extended_hours: 'Extended hours',
      '24x7': '24/7',
    };
    return (
      special[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    );
  }

  const display = $derived.by(() => {
    if (isNotApplicable) return 'N/A';
    if (isUnknown) return '—';
    if (Array.isArray(fact.value)) return fact.value.map(labelForValue).join(', ');
    if (typeof fact.value === 'boolean') return fact.value ? 'Yes' : 'No';
    if (typeof fact.value === 'number') return fact.value.toLocaleString();
    return labelForValue(String(fact.value));
  });
</script>

<div
  class="grid grid-cols-[108px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border/50 py-[7px] last:border-b-0"
>
  <dt class="font-mono text-[10px] uppercase leading-tight tracking-wider text-muted-foreground">
    {label}
  </dt>
  <dd class="flex min-w-0 items-center gap-2 text-sm">
    {#if isNotApplicable}
      <span class="size-2"></span>
      <span class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60"
        >not applicable</span
      >
    {:else if isUnknown}
      <span class="size-2"></span>
      <span class="font-mono text-[12px] text-muted-foreground/60">unknown</span>
    {:else}
      <SourceGlyph source={fact.source} />
      {#if fact.source === 'user_options'}
        <span
          class="inline-flex items-center rounded-[3px] bg-foreground/[0.07] px-1.5 py-px text-[12px] font-medium text-foreground"
          >{display}</span
        >
      {:else if fact.source === 'user_flex'}
        <span class="truncate italic text-foreground/95">{display}</span>
      {:else if fact.source === 'generated'}
        <span class="truncate font-mono text-[13px] tabular-nums text-foreground">{display}</span>
      {:else}
        <span class="truncate">{display}</span>
      {/if}
    {/if}
  </dd>
  <dd class="whitespace-nowrap text-right font-mono text-[10px] text-muted-foreground/60">
    {#if fact.source === 'generated' && fact.origin}
      <span class="hidden lg:inline">{fact.origin}</span>
      {#if fact.updatedAt}
        <span class="ml-1 hidden xl:inline">· {formatRelativeDate(fact.updatedAt)}</span>
      {/if}
    {/if}
  </dd>
</div>
