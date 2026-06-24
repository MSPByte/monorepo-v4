<script lang="ts">
  import Callsign from '$lib/components/panel/callsign.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import { formatRelativeDate } from '$lib/utils/format';

  type Props = {
    id: string;
    title: string;
    severity: number;
    status: string;
    siteId: string | null;
    siteName: string;
    policyName: string;
    resourceName: string;
    linkName: string | null | undefined;
    firstSeenAt: string;
    lastSeenAt: string;
    evidenceSummary: string;
  };
  let {
    id,
    title,
    severity,
    status,
    siteId,
    siteName,
    policyName,
    resourceName,
    linkName,
    firstSeenAt,
    lastSeenAt,
    evidenceSummary,
  }: Props = $props();

  const severityLabel = $derived(
    severity >= 4 ? 'CRITICAL' : severity === 3 ? 'HIGH' : severity === 2 ? 'MEDIUM' : 'LOW'
  );
</script>

<header class="border-b border-foreground/15 bg-card pb-2">
  <!-- Identity row -->
  <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-4">
    <div class="flex items-baseline gap-3">
      <div class="min-w-0">
        <div
          class="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          <span class="font-semibold text-foreground/80">FINDING</span>
          <span class="text-foreground/40">·</span>
          <span class="truncate">{policyName}</span>
        </div>
        <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">{title}</h1>
        {#if evidenceSummary}
          <p class="mt-0.5 max-w-4xl truncate text-xs text-muted-foreground">{evidenceSummary}</p>
        {/if}
      </div>
    </div>
  </div>

  <!-- Categorical pills -->
  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-6 pb-2 font-mono text-[10.5px]">
    <Callsign prefix="FIND" {id} title="Finding callsign — first 4 chars of ID" />
    <FindingSeverityBadge {severity} />
    <FindingStatusBadge {status} />
  </div>
</header>
