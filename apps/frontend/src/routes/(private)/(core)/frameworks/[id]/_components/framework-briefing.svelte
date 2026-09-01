<script lang="ts">
  import { formatRelativeDate } from '$lib/utils/format';
  import BriefingHeader from '$lib/components/domain/briefing-header.svelte';

  type Props = {
    id: string;
    name: string;
    description?: string | null;
    category?: string | null;
    source: 'catalog' | 'custom';
    providerName?: string | null;
    enabled: boolean;
    policyCount: number;
    mappingCount: number;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
  let {
    id,
    name,
    description,
    category,
    source,
    providerName,
    enabled,
    policyCount,
    mappingCount,
    createdAt,
    updatedAt,
  }: Props = $props();

  const pillBase = 'inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px tracking-[0.14em]';
  const pillMuted = `${pillBase} border-foreground/15 bg-foreground/4 text-foreground/90`;
</script>

<BriefingHeader entityType="FRAMEWORK" title={name} subtitle={description} breadcrumb={category}>
  {#snippet pills()}
    <span
      class="{pillBase} {enabled
        ? 'border-foreground/15 bg-foreground/4 text-foreground/90'
        : 'border-destructive/40 bg-destructive/6 text-destructive'}"
    >
      STATUS·{enabled ? 'ENABLED' : 'DISABLED'}
    </span>
    <span class={pillMuted}>SOURCE·{source.toUpperCase()}</span>
    {#if category}
      <span class={pillMuted}>CATEGORY·{category.toUpperCase()}</span>
    {/if}
    {#if providerName}
      <span class={pillMuted}>PROVIDER·{providerName.toUpperCase()}</span>
    {/if}
  {/snippet}

  {#snippet ribbon()}
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">POLICIES</span>
      <span class="font-semibold tabular-nums">{policyCount.toLocaleString()}</span>
    </span>
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">MAPPINGS</span>
      <span class="font-semibold tabular-nums">{mappingCount.toLocaleString()}</span>
    </span>
    {#if updatedAt}
      <span class="flex items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">UPDATED</span>
        <span class="font-semibold tabular-nums">{formatRelativeDate(updatedAt)}</span>
      </span>
    {/if}
    {#if createdAt}
      <span class="flex items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">CREATED</span>
        <span class="font-semibold tabular-nums">{formatRelativeDate(createdAt)}</span>
      </span>
    {/if}
  {/snippet}
</BriefingHeader>
