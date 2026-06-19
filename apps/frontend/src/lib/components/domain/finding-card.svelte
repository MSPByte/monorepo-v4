<script lang="ts">
  import FindingSeverityBadge from './finding-severity-badge.svelte';
  import FindingStatusBadge from './finding-status-badge.svelte';
  import { formatRelativeDate } from '$lib/utils/format';

  let {
    finding,
    siteName = 'Unknown site',
    resourceName = 'Affected resource',
    policyName = 'Policy',
  }: {
    finding: {
      id: string;
      title: string;
      severity: number;
      status: string;
      evidenceSummary: string;
      recommendation: string;
      lastSeenAt: string;
    };
    siteName?: string;
    resourceName?: string;
    policyName?: string;
  } = $props();
</script>

<a
  href={`/findings/${finding.id}`}
  class="block rounded-lg border bg-background p-4 transition-colors hover:bg-accent/40"
>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="font-medium leading-tight">{finding.title}</div>
        <div class="text-xs text-muted-foreground">
          {siteName} · {resourceName} · {policyName}
        </div>
      </div>
      <div class="flex shrink-0 gap-2">
        <FindingSeverityBadge severity={finding.severity} />
        <FindingStatusBadge status={finding.status} />
      </div>
    </div>
    <div class="grid gap-2 text-sm md:grid-cols-[1fr_1fr_auto]">
      <div>
        <div class="text-xs text-muted-foreground">Evidence</div>
        <div>{finding.evidenceSummary}</div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">Recommendation</div>
        <div>{finding.recommendation}</div>
      </div>
      <div class="text-xs text-muted-foreground md:text-right">
        Last seen {formatRelativeDate(finding.lastSeenAt)}
      </div>
    </div>
  </div>
</a>
