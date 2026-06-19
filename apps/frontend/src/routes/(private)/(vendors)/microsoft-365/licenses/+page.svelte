<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, numberColumn, boolBadgeColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import LicenseSheet from './_license-sheet.svelte';
  import type { m365Licenses } from '@mspbyte/drizzle';

  const currentLinkId = $derived(scopeStore.currentLink || undefined);

  type LicenseRow = typeof m365Licenses.$inferSelect & Record<string, unknown>;

  const columns: DataTableColumn<LicenseRow>[] = [
    textColumn<LicenseRow>('friendlyName', 'SKU Name'),
    textColumn<LicenseRow>('skuPartNumber', 'Part Number', undefined, { defaultHidden: true }),
    numberColumn<LicenseRow>('consumedUnits', 'Assigned'),
    numberColumn<LicenseRow>('totalUnits', 'Total'),
    numberColumn<LicenseRow>('warningUnits', 'Expiring'),
    boolBadgeColumn<LicenseRow>('enabled', 'Status', {
      trueLabel: 'Active',
      falseLabel: 'Inactive',
      falseVariant: 'muted',
    }),
  ];

  let selectedLicense = $state<LicenseRow | null>(null);
</script>

<VendorDataTable
  table="m365_licenses"
  linkId={currentLinkId}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => (selectedLicense = row as LicenseRow)}
/>

<LicenseSheet
  license={selectedLicense}
  linkId={currentLinkId ?? String(selectedLicense?.linkId ?? '')}
  onclose={() => (selectedLicense = null)}
/>
