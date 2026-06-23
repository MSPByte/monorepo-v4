<script lang="ts">
  import FindingsInsightsPanel, {
    type FindingsInsightsFilter,
  } from '../_FindingsInsightsPanel.svelte';

  let { linkId }: { linkId: string | null } = $props();

  const filters: FindingsInsightsFilter[] = [
    {
      id: 'identities',
      label: 'Identities',
      match: (f) => f.resourceType === 'person' || f.resourceType === 'm365_identity',
    },
    {
      id: 'licenses',
      label: 'Licenses',
      match: (f) => f.resourceType === 'm365_license',
    },
    {
      id: 'policies',
      label: 'Conditional Access',
      match: (f) => f.resourceType === 'm365_policy',
    },
    {
      id: 'exchange',
      label: 'Exchange',
      match: (f) =>
        f.resourceType === 'm365_mailbox_forwarding' ||
        f.resourceType === 'm365_inbox_rule' ||
        f.resourceType === 'm365_exchange_config',
    },
    {
      id: 'devices',
      label: 'Devices',
      match: (f) => f.resourceType === 'asset' || f.resourceType === 'm365_device',
    },
  ];

  function moduleLabelForFinding(finding: { resourceType: string }) {
    if (finding.resourceType === 'm365_identity' || finding.resourceType === 'person') return 'Identity';
    if (finding.resourceType === 'm365_license') return 'License';
    if (finding.resourceType === 'm365_policy') return 'Policy';
    if (finding.resourceType === 'm365_mailbox_forwarding') return 'Mailbox Forwarding';
    if (finding.resourceType === 'm365_inbox_rule') return 'Inbox Rule';
    if (finding.resourceType === 'm365_exchange_config') return 'Exchange';
    if (finding.resourceType === 'm365_device' || finding.resourceType === 'asset') return 'Device';
    return 'Other';
  }
</script>

<FindingsInsightsPanel
  {linkId}
  findingsHref="/microsoft-365/findings"
  {filters}
  entityHeading="Entity"
  {moduleLabelForFinding}
/>
