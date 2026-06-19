<!-- TODO: Findings Implementation -->
<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, boolBadgeColumn, relativeDateColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import IdentitySheet from './_identity-sheet.svelte';
  import type { m365Identities } from '@mspbyte/drizzle';

  const currentLinkId = $derived(scopeStore.currentLink || undefined);

  type IdentityRow = typeof m365Identities.$inferSelect & Record<string, unknown>;

  let selectedIdentity = $state<IdentityRow | null>(null);

  const columns: DataTableColumn<IdentityRow>[] = [
    textColumn<IdentityRow>('name', 'Name'),
    textColumn<IdentityRow>('email', 'Email'),
    {
      key: 'type',
      title: 'Type',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq'],
        options: [
          { label: 'Member', value: 'member' },
          { label: 'Guest', value: 'guest' },
          { label: 'Service', value: 'service' },
        ],
      },
    },
    boolBadgeColumn<IdentityRow>('enabled', 'Status', {
      trueLabel: 'Enabled',
      falseLabel: 'Disabled',
      falseVariant: 'destructive',
    }),
    boolBadgeColumn<IdentityRow>('mfaEnforced', 'MFA', {
      trueLabel: 'Enforced',
      falseLabel: 'Not Enforced',
      falseVariant: 'destructive',
    }),
    relativeDateColumn<IdentityRow>('lastSignInAt', 'Last Sign-in'),
  ];

  function openDrawer(identity: IdentityRow) {
    selectedIdentity = identity;
  }
</script>

<VendorDataTable
  table="m365_identities"
  linkId={currentLinkId}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => openDrawer(row as IdentityRow)}
/>

<IdentitySheet
  identity={selectedIdentity}
  linkId={currentLinkId ?? String(selectedIdentity?.linkId ?? '')}
  onclose={() => (selectedIdentity = null)}
/>
