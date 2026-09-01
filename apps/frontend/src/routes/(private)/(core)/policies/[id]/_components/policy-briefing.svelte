<script lang="ts">
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import { severityLabel } from '$lib/utils/label';
  import BriefingHeader from '$lib/components/domain/briefing-header.svelte';
  import PolicyActionsMenu from './policy-actions-menu.svelte';

  type Props = {
    id: string;
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
    id,
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

  const label = $derived(severityLabel(severity));
  const severityAccent = $derived(severity >= 3);
  const findingsAccent = $derived(openFindingCount > 0);

  const pillBase = 'inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px tracking-[0.14em]';
  const pillMuted = `${pillBase} border-foreground/15 bg-foreground/4 text-foreground/90`;
</script>

<BriefingHeader
  entityType="POLICY"
  title={name}
  subtitle={description}
  breadcrumb={category ? prettyText(category) : null}
>
  {#snippet actions()}
    <PolicyActionsMenu policyId={id} policyName={name} />
  {/snippet}

  {#snippet pills()}
    <span
      class="{pillBase} {enabled
        ? 'border-foreground/15 bg-foreground/4 text-foreground/90'
        : 'border-destructive/40 bg-destructive/6 text-destructive'}"
    >
      STATUS·{enabled ? 'ENABLED' : 'DISABLED'}
    </span>
    <span
      class="{pillBase} {severityAccent
        ? 'border-destructive/40 bg-destructive/6 text-destructive'
        : 'border-foreground/15 bg-foreground/4 text-foreground/90'}"
    >
      SEVERITY·{label}
    </span>
    <span class={pillMuted}>SCOPE·{scope.toUpperCase()}</span>
    {#if dataSource}
      <span class={pillMuted}>SOURCE·{dataSource.toUpperCase()}</span>
    {/if}
    {#if origin}
      <span class={pillMuted}>ORIGIN·{origin.toUpperCase()}</span>
    {/if}
  {/snippet}

  {#snippet ribbon()}
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">FINDINGS</span>
      <span class="font-semibold tabular-nums {findingsAccent ? 'text-destructive' : ''}">
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
  {/snippet}
</BriefingHeader>
