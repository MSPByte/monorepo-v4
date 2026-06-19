<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, boolBadgeColumn, nullableTextColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import TeamsSheet from './_teams-sheet.svelte';
  import type { m365TeamsConfig } from '@mspbyte/drizzle';

  type TeamsRow = typeof m365TeamsConfig.$inferSelect & Record<string, unknown>;

  const columns: DataTableColumn<TeamsRow>[] = [
    textColumn<TeamsRow>('externalId', 'Policy'),
    boolBadgeColumn<TeamsRow>('allowAnonymousUsersToJoinMeeting', 'Anon. Join', {
      trueLabel: 'Allowed',
      falseLabel: 'Blocked',
      falseVariant: 'muted',
    }),
    boolBadgeColumn<TeamsRow>('allowExternalParticipantGiveRequestControl', 'Ext. Control', {
      trueLabel: 'Allowed',
      falseLabel: 'Blocked',
      falseVariant: 'muted',
    }),
    boolBadgeColumn<TeamsRow>('allowPSTNUsersToBypassLobby', 'PSTN Bypass', {
      trueLabel: 'Allowed',
      falseLabel: 'Blocked',
      falseVariant: 'muted',
    }),
    nullableTextColumn<TeamsRow>('autoAdmittedUsers', 'Auto-Admit'),
    boolBadgeColumn<TeamsRow>('allowFederatedUsers', 'Federation', {
      trueLabel: 'Allowed',
      falseLabel: 'Blocked',
      falseVariant: 'muted',
    }),
  ];

  let selectedPolicy = $state<TeamsRow | null>(null);
</script>

<VendorDataTable
  table="m365_teams_config"
  linkId={scopeStore.currentLink || undefined}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => (selectedPolicy = row as TeamsRow)}
/>

<TeamsSheet
  policy={selectedPolicy}
  onclose={() => (selectedPolicy = null)}
/>
