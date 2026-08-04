<script lang="ts">
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import {
    textColumn,
    boolBadgeColumn,
    nullableTextColumn,
  } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn, RowAction } from '$lib/components/data-table/types';
  import GroupSheet from './_group-sheet.svelte';
  import IdentityPickerDialog from '../_actions/identity-picker-dialog.svelte';
  import UsersIcon from '@lucide/svelte/icons/users';
  import type { m365Groups } from '@mspbyte/drizzle';

  type GroupRow = typeof m365Groups.$inferSelect & Record<string, unknown>;

  const canWrite = $derived(authStore.isAllowed('Vendors.Write'));
  const currentLinkId = $derived(scopeStore.currentLink || undefined);

  const columns: DataTableColumn<GroupRow>[] = [
    textColumn<GroupRow>('name', 'Name'),
    boolBadgeColumn<GroupRow>('mailEnabled', 'Mail-enabled', {
      trueLabel: 'Yes',
      falseLabel: 'No',
      falseVariant: 'muted',
    }),
    boolBadgeColumn<GroupRow>('securityEnabled', 'Security', {
      trueLabel: 'Yes',
      falseLabel: 'No',
      falseVariant: 'muted',
    }),
    nullableTextColumn<GroupRow>('description', 'Description'),
  ];

  let selectedGroup = $state<GroupRow | null>(null);

  // Identity picker (manage members) shared across row-action + sheet.
  let pickerOpen = $state(false);
  let pickerTargets = $state<GroupRow[]>([]);
  let pickerRefetch = $state<(() => Promise<void>) | null>(null);

  const pickerLinkId = $derived(currentLinkId ?? String(pickerTargets[0]?.linkId ?? ''));
  const pickerAnchorLabel = $derived(
    pickerTargets.length === 1
      ? pickerTargets[0]?.name || 'group'
      : `${pickerTargets.length} groups`,
  );
  const pickerGroupIds = $derived(pickerTargets.map((g) => g.id));

  function openPicker(rows: GroupRow[], refetch: () => Promise<void>) {
    if (rows.length === 0) return;
    pickerTargets = rows;
    pickerRefetch = refetch;
    pickerOpen = true;
  }

  const rowActions: RowAction<GroupRow>[] = $derived(
    !canWrite
      ? []
      : [
          {
            label: 'Manage Members',
            icon: UsersIcon,
            variant: 'outline',
            preserveSelection: true,
            onclick: (rows, fetchData) => openPicker(rows, fetchData),
          },
        ],
  );
</script>

<VendorDataTable
  table="m365_groups"
  linkId={currentLinkId}
  integrationId="microsoft-365"
  {columns}
  enableRowSelection={canWrite}
  {rowActions}
  onrowclick={(row) => (selectedGroup = row as GroupRow)}
/>

<GroupSheet
  group={selectedGroup}
  linkId={currentLinkId ?? String(selectedGroup?.linkId ?? '')}
  onclose={() => (selectedGroup = null)}
/>

<IdentityPickerDialog
  open={pickerOpen}
  onOpenChange={(open) => (pickerOpen = open)}
  linkId={pickerLinkId}
  relation={{ kind: 'group', groupIds: pickerGroupIds, anchorLabel: pickerAnchorLabel }}
  onSuccess={async () => {
    if (pickerRefetch) await pickerRefetch();
  }}
/>
