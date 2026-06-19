<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, nullableTextColumn, relativeDateColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import RiskyUserSheet from './_risky-user-sheet.svelte';
  import type { m365RiskyUsers } from '@mspbyte/drizzle';

  type RiskyUserRow = typeof m365RiskyUsers.$inferSelect & Record<string, unknown>;

  const columns: DataTableColumn<RiskyUserRow>[] = [
    textColumn<RiskyUserRow>('userPrincipalName', 'User Principal Name'),
    nullableTextColumn<RiskyUserRow>('userDisplayName', 'Display Name'),
    {
      key: 'riskLevel',
      title: 'Risk Level',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: [
          { label: 'High', value: 'high' },
          { label: 'Medium', value: 'medium' },
          { label: 'Low', value: 'low' },
          { label: 'None', value: 'none' },
        ],
      },
    },
    {
      key: 'riskState',
      title: 'Risk State',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: [
          { label: 'At Risk', value: 'atRisk' },
          { label: 'Confirmed Compromised', value: 'confirmedCompromised' },
          { label: 'Remediated', value: 'remediated' },
          { label: 'Confirmed Safe', value: 'confirmedSafe' },
          { label: 'Dismissed', value: 'dismissed' },
        ],
      },
    },
    nullableTextColumn<RiskyUserRow>('riskDetail', 'Risk Detail'),
    relativeDateColumn<RiskyUserRow>('riskLastUpdatedAt', 'Last Updated'),
  ];

  let selectedUser = $state<RiskyUserRow | null>(null);
</script>

<VendorDataTable
  table="m365_risky_users"
  linkId={scopeStore.currentLink || undefined}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => (selectedUser = row as RiskyUserRow)}
/>

<RiskyUserSheet
  user={selectedUser}
  onclose={() => (selectedUser = null)}
/>
