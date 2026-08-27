<script lang="ts">
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import PolicyActionsMenu from './policy-actions-menu.svelte';

  type Props = {
    policyId: string;
    name: string;
    description?: string | null;
    category?: string | null;
    scope: string;
    dataSource?: string | null;
    origin?: string | null;
    enabled: boolean;
    severity: number;
    openFindingCount: number;
    frameworkCount: number;
    assignmentCount: number;
    lastEvaluation?: string | null;
    updatedAt?: string | null;
  };
  let {
    policyId,
    name,
    description,
    category,
    scope,
    dataSource,
    origin,
    enabled,
    severity,
    openFindingCount,
    frameworkCount,
    assignmentCount,
    lastEvaluation,
    updatedAt,
  }: Props = $props();

  const severityLabels: Record<number, string> = {
    4: 'CRITICAL',
    3: 'HIGH',
    2: 'MEDIUM',
    1: 'LOW',
  };
  const severityLabel = $derived(severityLabels[severity] ?? 'INFO');
  const severityAccent = $derived(severity >= 3);
  const findingsAccent = $derived(openFindingCount > 0);
</script>

<header class="border-b border-foreground/15 bg-card">
  <!-- Identity row -->
  <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-4">
    <div class="min-w-0 flex-1">
      <div
        class="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
      >
        <span class="font-semibold text-foreground/80">POLICY</span>
        {#if category}
          <span class="text-foreground/40">·</span>
          <span class="truncate">{prettyText(category)}</span>
        {/if}
      </div>
      <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">{name}</h1>
      {#if description}
        <p class="mt-0.5 max-w-3xl truncate text-xs text-muted-foreground">{description}</p>
      {/if}
    </div>
    <PolicyActionsMenu {policyId} policyName={name} />
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
      class={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px tracking-[0.14em] ${
        severityAccent
          ? 'border-destructive/40 bg-destructive/6 text-destructive'
          : 'border-foreground/15 bg-foreground/4 text-foreground/90'
      }`}
    >
      SEVERITY·{severityLabel}
    </span>
    <span
      class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
    >
      SCOPE·{scope.toUpperCase()}
    </span>
    {#if dataSource}
      <span
        class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
      >
        SOURCE·{dataSource.toUpperCase()}
      </span>
    {/if}
    {#if origin}
      <span
        class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
      >
        ORIGIN·{origin.toUpperCase()}
      </span>
    {/if}
  </div>

  <!-- Metric ribbon -->
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 bg-muted/30 px-6 py-2.5 font-mono text-[12px] text-foreground"
  >
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">FINDINGS</span>
      <span class={`font-semibold tabular-nums ${findingsAccent ? 'text-destructive' : ''}`}>
        {openFindingCount.toLocaleString()}
      </span>
    </span>
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">FRAMEWORKS</span>
      <span class="font-semibold tabular-nums">{frameworkCount.toLocaleString()}</span>
    </span>
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">ASSIGNMENTS</span>
      <span class="font-semibold tabular-nums">{assignmentCount.toLocaleString()}</span>
    </span>
    {#if lastEvaluation}
      <span class="flex items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">EVALUATED</span>
        <span class="font-semibold tabular-nums">{formatRelativeDate(lastEvaluation)}</span>
      </span>
    {/if}
    {#if updatedAt}
      <span class="flex items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">UPDATED</span>
        <span class="font-semibold tabular-nums">{formatRelativeDate(updatedAt)}</span>
      </span>
    {/if}
  </div>
</header>
