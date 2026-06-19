<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, nullableTextColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import OAuthGrantSheet from './_oauth-grant-sheet.svelte';
  import type { m365OAuthGrants } from '@mspbyte/drizzle';

  type OAuthGrantRow = typeof m365OAuthGrants.$inferSelect & Record<string, unknown>;

  const columns: DataTableColumn<OAuthGrantRow>[] = [
    nullableTextColumn<OAuthGrantRow>('clientDisplayName', 'Application'),
    {
      key: 'consentType',
      title: 'Consent Type',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq', 'neq'],
        options: [
          { label: 'Admin (All Principals)', value: 'AllPrincipals' },
          { label: 'User (Principal)', value: 'Principal' },
        ],
      },
    },
    nullableTextColumn<OAuthGrantRow>('resourceDisplayName', 'Resource'),
    nullableTextColumn<OAuthGrantRow>('scope', 'Scopes'),
    textColumn<OAuthGrantRow>('clientId', 'Client ID', undefined, { defaultHidden: true }),
  ];

  let selectedGrant = $state<OAuthGrantRow | null>(null);
</script>

<VendorDataTable
  table="m365_oauth_grants"
  linkId={scopeStore.currentLink || undefined}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => (selectedGrant = row as OAuthGrantRow)}
/>

<OAuthGrantSheet
  grant={selectedGrant}
  onclose={() => (selectedGrant = null)}
/>
