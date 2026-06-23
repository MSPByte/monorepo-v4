<script lang="ts">
  import FindingsInsightsPanel, {
    type FindingsInsightsFilter,
  } from '../_FindingsInsightsPanel.svelte';

  let { linkId }: { linkId: string | null } = $props();

  const filters: FindingsInsightsFilter[] = [
    {
      id: 'tamper',
      label: 'Tamper Protection',
      match: (f) => f.policyId.includes('tamper'),
    },
    {
      id: 'endpoints',
      label: 'Endpoints',
      match: (f) => f.resourceType === 'sophos_endpoint',
    },
    {
      id: 'firewalls',
      label: 'Firewalls',
      match: (f) => f.resourceType === 'sophos_firewall',
    },
    {
      id: 'updates',
      label: 'Updates Needed',
      match: (f) => f.policyId.includes('update') || f.title.toLowerCase().includes('update'),
    },
    {
      id: 'stale',
      label: 'Stale',
      match: (f) => f.policyId.includes('stale') || f.title.toLowerCase().includes('stale'),
    },
  ];

  function moduleLabelForFinding(finding: { resourceType: string; policyId: string }) {
    if (finding.policyId.includes('tamper')) return 'Tamper';
    if (finding.resourceType === 'sophos_firewall') return 'Firewall';
    if (finding.resourceType === 'sophos_endpoint') return 'Endpoint';
    if (finding.resourceType === 'sophos_license') return 'License';
    return 'Other';
  }
</script>

<FindingsInsightsPanel
  {linkId}
  findingsHref="/sophos-partner/findings"
  {filters}
  entityHeading="Endpoint"
  {moduleLabelForFinding}
/>
