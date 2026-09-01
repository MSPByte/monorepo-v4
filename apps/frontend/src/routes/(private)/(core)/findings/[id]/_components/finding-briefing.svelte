<script lang="ts">
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import BriefingHeader from '$lib/components/domain/briefing-header.svelte';

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
</script>

<BriefingHeader
  entityType="FINDING"
  {title}
  subtitle={evidenceSummary}
  breadcrumb={policyName}
  class="pb-2"
>
  {#snippet pills()}
    <FindingSeverityBadge {severity} />
    <FindingStatusBadge {status} />
  {/snippet}
</BriefingHeader>
