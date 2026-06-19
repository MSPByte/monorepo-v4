<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, boolBadgeColumn, nullableTextColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import DomainSheet from './_domain-sheet.svelte';
  import type { m365DomainConfig } from '@mspbyte/drizzle';

  type DomainRow = typeof m365DomainConfig.$inferSelect & Record<string, unknown>;

  const columns: DataTableColumn<DomainRow>[] = [
    textColumn<DomainRow>('domainName', 'Domain'),
    nullableTextColumn<DomainRow>('spfRecord', 'SPF Record', { defaultHidden: true }),
    boolBadgeColumn<DomainRow>('spfIsPermissive', 'SPF Permissive', {
      trueLabel: 'Permissive',
      falseLabel: 'Strict',
      falseVariant: 'muted',
    }),
    nullableTextColumn<DomainRow>('dmarcPolicy', 'DMARC Policy'),
    boolBadgeColumn<DomainRow>('dkimEnabled', 'DKIM', {
      trueLabel: 'Enabled',
      falseLabel: 'Disabled',
      falseVariant: 'destructive',
    }),
    boolBadgeColumn<DomainRow>('dkimSelector1Present', 'Selector 1', {
      trueLabel: 'Present',
      falseLabel: 'Missing',
      falseVariant: 'destructive',
    }),
    boolBadgeColumn<DomainRow>('dkimSelector2Present', 'Selector 2', {
      trueLabel: 'Present',
      falseLabel: 'Missing',
      falseVariant: 'destructive',
    }),
  ];

  let selectedDomain = $state<DomainRow | null>(null);
</script>

<VendorDataTable
  table="m365_domain_config"
  linkId={scopeStore.currentLink || undefined}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => (selectedDomain = row as DomainRow)}
/>

<DomainSheet
  domain={selectedDomain}
  onclose={() => (selectedDomain = null)}
/>
