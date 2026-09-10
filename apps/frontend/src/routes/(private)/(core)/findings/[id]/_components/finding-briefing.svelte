<script lang="ts">
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';


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

<header class="fq-briefing">
  <div class="flex flex-wrap items-center gap-2"><span class="fq-eyebrow">Finding</span><FindingSeverityBadge {severity} /><FindingStatusBadge {status} /></div>
  <h1>{title}</h1>
  <div class="fq-briefing-context">
    {#if siteId}<a href={`/sites/${siteId}`}>{siteName}</a>{:else}<span>{siteName}</span>{/if}
    <span aria-hidden="true">/</span><span>{resourceName}</span><span aria-hidden="true">/</span><span>{policyName}</span>
  </div>
  {#if evidenceSummary}<p>{evidenceSummary}</p>{/if}
</header>
