<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import type { createTrpcClient } from '$lib/trpc';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import VendorDataTable from '$lib/components/data-table/vendor-data-table.svelte';
  import {
    boolBadgeColumn,
    nullableTextColumn,
    relativeDateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import SophosFirewallDetailSheet from '$lib/components/domain/sophos-firewall-detail-sheet.svelte';

  import type { sophosFirewallsWithSite } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type FirewallRow = typeof sophosFirewallsWithSite.$inferSelect & Record<string, unknown>;

  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'sophos-partner', scopeStore.currentSite, scopeStore.currentGroup],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'sophos-partner',
        siteId: scopeStore.currentSite!,
        groupId: scopeStore.currentGroup ?? undefined,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLinkId = $derived(
    scopeStore.currentSite ? (siteLinkQuery.data?.[0]?.id ?? null) : undefined
  );

  const columns: DataTableColumn<FirewallRow>[] = $derived([
    ...(!currentLinkId
      ? [
          textColumn<FirewallRow>('siteName', 'Site', undefined, undefined, {
            width: '180px',
          }),
        ]
      : []),
    boolBadgeColumn<FirewallRow>(
      'connected',
      'Status',
      {
        trueLabel: 'Online',
        falseLabel: 'Offline',
        falseVariant: 'destructive',
      },
      { width: '100px' }
    ),
    textColumn<FirewallRow>('name', 'Name'),
    nullableTextColumn<FirewallRow>('hostname', 'Hostname', undefined, {
      width: '170px',
      sortable: true,
      searchable: true,
    }),
    nullableTextColumn<FirewallRow>('serialNumber', 'Serial', undefined, {
      width: '150px',
      searchable: true,
    }),
    nullableTextColumn<FirewallRow>('externalIp', 'External IP', undefined, {
      width: '140px',
      searchable: true,
    }),
    nullableTextColumn<FirewallRow>('firmwareVersion', 'Firmware', undefined, {
      width: '130px',
      sortable: true,
      searchable: true,
    }),
    boolBadgeColumn<FirewallRow>(
      'upgradeToVersion',
      'Upgrade',
      {
        trueLabel: 'Current',
        falseLabel: 'Available',
        falseVariant: 'destructive',
        evaluate: (value) => !value,
      },
      { width: '110px' }
    ),
    relativeDateColumn<FirewallRow>('lastChangeAt', 'Last Change', {
      width: '140px',
    }),
  ] as DataTableColumn<FirewallRow>[]);

  let drawerFirewall = $state<FirewallRow | null>(null);
</script>

{#if scopeStore.currentSite && siteLinkQuery.isLoading}
  <div class="flex items-center justify-center size-full text-sm text-muted-foreground">
    Loading…
  </div>
{:else if scopeStore.currentSite && !currentLinkId}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">No Sophos Partner integration for this site.</div>
  </div>
{:else}
  <VendorDataTable
    table="sophos_firewalls_with_site"
    linkId={currentLinkId ?? undefined}
    groupId={scopeStore.currentGroup ?? undefined}
    integrationId="sophos-partner"
    scopeColumn={false}
    {columns}
    onrowclick={(row) => (drawerFirewall = drawerFirewall?.['id'] === row['id'] ? null : row)}
  />
{/if}

<SophosFirewallDetailSheet
  open={!!drawerFirewall}
  firewall={drawerFirewall}
  onOpenChange={(open) => {
    if (!open) drawerFirewall = null;
  }}
/>
