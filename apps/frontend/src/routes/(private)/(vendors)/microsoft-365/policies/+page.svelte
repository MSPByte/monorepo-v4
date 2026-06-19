<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, nullableTextColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import PolicySheet from './_policy-sheet.svelte';
  import type { PolicyRow } from './_types.js';

  const columns: DataTableColumn<PolicyRow>[] = [
    textColumn<PolicyRow>('name', 'Policy Name'),
    {
      key: 'policyState',
      title: 'State',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: [
          { label: 'Enabled', value: 'enabled' },
          { label: 'Report Only', value: 'enabledForReportingButNotEnforced' },
          { label: 'Disabled', value: 'disabled' },
        ],
      },
    },
    nullableTextColumn<PolicyRow>('description', 'Description'),
  ];

  let selectedPolicy = $state<PolicyRow | null>(null);
</script>

<VendorDataTable
  table="m365_policies"
  linkId={scopeStore.currentLink || undefined}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => (selectedPolicy = row as PolicyRow)}
/>

<PolicySheet
  policy={selectedPolicy}
  linkId={scopeStore.currentLink || String(selectedPolicy?.linkId ?? '')}
  onclose={() => (selectedPolicy = null)}
/>
