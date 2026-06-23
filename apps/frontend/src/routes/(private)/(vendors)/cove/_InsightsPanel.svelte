<script lang="ts">
  import FindingsInsightsPanel, {
    type FindingsInsightsFilter,
  } from '../_FindingsInsightsPanel.svelte';

  let { linkId }: { linkId: string | null } = $props();

  const filters: FindingsInsightsFilter[] = [
    {
      id: 'errors',
      label: 'Errors',
      match: (f) => f.policyId.includes('error') || f.title.toLowerCase().includes('error'),
    },
    {
      id: 'stale',
      label: 'Stale Backup',
      match: (f) => f.policyId.includes('stale') || f.title.toLowerCase().includes('stale'),
    },
  ];

  function moduleLabelForFinding(finding: { policyId: string; title: string }) {
    if (finding.policyId.includes('error')) return 'Errors';
    if (finding.policyId.includes('stale')) return 'Stale Backup';
    return finding.title;
  }
</script>

<FindingsInsightsPanel
  {linkId}
  findingsHref="/cove/findings"
  {filters}
  entityHeading="Endpoint"
  {moduleLabelForFinding}
/>
