<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, boolBadgeColumn, nullableTextColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import GroupSheet from './_group-sheet.svelte';
  import type { m365Groups } from '@mspbyte/drizzle';

  type GroupRow = typeof m365Groups.$inferSelect & Record<string, unknown>;

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
</script>

<VendorDataTable
  table="m365_groups"
  linkId={scopeStore.currentLink || undefined}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => (selectedGroup = row as GroupRow)}
/>

<GroupSheet
  group={selectedGroup}
  linkId={scopeStore.currentLink || String(selectedGroup?.linkId ?? '')}
  onclose={() => (selectedGroup = null)}
/>
