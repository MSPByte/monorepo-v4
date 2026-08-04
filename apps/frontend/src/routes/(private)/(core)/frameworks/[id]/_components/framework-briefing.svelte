<script lang="ts">
  import { formatRelativeDate } from '$lib/utils/format';

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
</script>

<header class="border-b border-foreground/15 bg-card">
  <!-- Identity row -->
  <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-4">
    <div class="flex items-baseline gap-3">
      <div class="min-w-0">
        <div
          class="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          <span class="font-semibold text-foreground/80">FRAMEWORK</span>
          {#if category}
            <span class="text-foreground/40">·</span>
            <span class="truncate">{category}</span>
          {/if}
        </div>
        <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">{name}</h1>
        {#if description}
          <p class="mt-0.5 max-w-3xl truncate text-xs text-muted-foreground">{description}</p>
        {/if}
      </div>
    </div>
  </div>

  <!-- Categorical pills -->
  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-6 pb-2 font-mono text-[10.5px]">
    <span
      class={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px tracking-[0.14em] ${
        enabled
          ? 'border-foreground/15 bg-foreground/4 text-foreground/90'
          : 'border-destructive/40 bg-destructive/6 text-destructive'
      }`}
    >
      STATUS·{enabled ? 'ENABLED' : 'DISABLED'}
    </span>
    <span
      class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
    >
      SOURCE·{source.toUpperCase()}
    </span>
    {#if category}
      <span
        class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
      >
        CATEGORY·{category.toUpperCase()}
      </span>
    {/if}
    {#if providerName}
      <span
        class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
      >
        PROVIDER·{providerName.toUpperCase()}
      </span>
    {/if}
  </div>

  <!-- Metric ribbon -->
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 bg-muted/30 px-6 py-2.5 font-mono text-[12px] text-foreground"
  >
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
  </div>
</header>
