<script lang="ts">
  type Buckets = { critical?: number; high?: number; medium?: number; low?: number };

  let { buckets }: { buckets: Buckets } = $props();

  // Colors track the status-badge variants: destructive (crit/high), warning (med),
  // muted (low). Keeps home page in sync with FindingSeverityBadge tokens.
</script>

<div class="flex shrink-0 items-center gap-1 text-[11px] font-medium tabular-nums">
  {#if buckets.critical}
    <span
      class="rounded-sm border border-destructive/75 bg-destructive/15 px-1.5 py-px text-destructive"
      title="Critical"
    >
      {buckets.critical}<span class="ml-0.5 text-[10px]">C</span>
    </span>
  {/if}
  {#if buckets.high}
    <span
      class="rounded-sm border border-destructive/50 bg-destructive/5 px-1.5 py-px text-destructive"
      title="High"
    >
      {buckets.high}<span class="ml-0.5 text-[10px]">H</span>
    </span>
  {/if}
  {#if buckets.medium}
    <span
      class="rounded-sm border border-warning/50 bg-warning/10 px-1.5 py-px text-warning"
      title="Medium"
    >
      {buckets.medium}<span class="ml-0.5 text-[10px]">M</span>
    </span>
  {/if}
  {#if buckets.low}
    <span
      class="rounded-sm border border-foreground/25 bg-foreground/5 px-1.5 py-px text-muted-foreground"
      title="Low"
    >
      {buckets.low}<span class="ml-0.5 text-[10px]">L</span>
    </span>
  {/if}
</div>
