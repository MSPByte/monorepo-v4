<script lang="ts">
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/vendor-data-table.svelte';
  import {
    textColumn,
    numberColumn,
    boolBadgeColumn,
  } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn, RowAction } from '$lib/components/data-table/types';
  import LicenseSheet from './_license-sheet.svelte';
  import IdentityPickerDialog from '../_actions/identity-picker-dialog.svelte';
  import UsersIcon from '@lucide/svelte/icons/users';
  import type { m365Licenses } from '@mspbyte/drizzle';

  const currentLinkId = $derived(scopeStore.currentLink || undefined);
  const canWrite = $derived(authStore.isAllowed('Vendors.Write'));

  type LicenseRow = typeof m365Licenses.$inferSelect & Record<string, unknown>;

  const columns: DataTableColumn<LicenseRow>[] = [
    textColumn<LicenseRow>('friendlyName', 'SKU Name'),
    textColumn<LicenseRow>('skuPartNumber', 'Part Number', undefined, undefined, {
      defaultHidden: true,
    }),
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

  let pickerOpen = $state(false);
  let pickerTargets = $state<LicenseRow[]>([]);
  let pickerRefetch = $state<(() => Promise<void>) | null>(null);

  const pickerLinkId = $derived(currentLinkId ?? String(pickerTargets[0]?.linkId ?? ''));
  const pickerAnchorLabel = $derived(
    pickerTargets.length === 1
      ? pickerTargets[0]?.friendlyName || pickerTargets[0]?.skuPartNumber || 'license'
      : `${pickerTargets.length} licenses`,
  );
  const pickerLicenseIds = $derived(pickerTargets.map((l) => l.id));

  function openPicker(rows: LicenseRow[], refetch: () => Promise<void>) {
    if (rows.length === 0) return;
    pickerTargets = rows;
    pickerRefetch = refetch;
    pickerOpen = true;
  }

  const rowActions: RowAction<LicenseRow>[] = $derived(
    !canWrite
      ? []
      : [
          {
            label: 'Manage Assignments',
            icon: UsersIcon,
            variant: 'outline',
            preserveSelection: true,
            onclick: (rows, fetchData) => openPicker(rows, fetchData),
          },
        ],
  );
</script>

<VendorDataTable
  table="m365_licenses"
  linkId={currentLinkId}
  groupId={scopeStore.currentGroup || undefined}
  integrationId="microsoft-365"
  {columns}
  enableRowSelection={canWrite}
  {rowActions}
  onrowclick={(row) => (selectedLicense = row as LicenseRow)}
/>

<LicenseSheet
  license={selectedLicense}
  linkId={currentLinkId ?? String(selectedLicense?.linkId ?? '')}
  onclose={() => (selectedLicense = null)}
/>

<IdentityPickerDialog
  open={pickerOpen}
  onOpenChange={(open) => (pickerOpen = open)}
  linkId={pickerLinkId}
  relation={{ kind: 'license', licenseIds: pickerLicenseIds, anchorLabel: pickerAnchorLabel }}
  onSuccess={async () => {
    if (pickerRefetch) await pickerRefetch();
  }}
/>
