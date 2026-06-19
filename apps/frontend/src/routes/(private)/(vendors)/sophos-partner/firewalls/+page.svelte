<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import {
    boolBadgeColumn,
    nullableTextColumn,
    relativeDateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import * as Sheet from '$lib/components/ui/sheet/index.js';

  import type { sophosFirewallsWithSite } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type FirewallRow = typeof sophosFirewallsWithSite.$inferSelect & Record<string, unknown>;

  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'sophos-partner', scopeStore.currentSite],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'sophos-partner',
        siteId: scopeStore.currentSite!,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLinkId = $derived(
    scopeStore.currentSite ? (siteLinkQuery.data?.[0]?.id ?? null) : undefined
  );

  const columns: DataTableColumn<FirewallRow>[] = $derived([
    ...(!currentLinkId
      ? [
          textColumn<FirewallRow>('siteName', 'Site', undefined, {
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
    nullableTextColumn<FirewallRow>('hostname', 'Hostname', {
      width: '170px',
      sortable: true,
      searchable: true,
    }),
    nullableTextColumn<FirewallRow>('serialNumber', 'Serial', {
      width: '150px',
      searchable: true,
    }),
    nullableTextColumn<FirewallRow>('externalIp', 'External IP', {
      width: '140px',
      searchable: true,
    }),
    nullableTextColumn<FirewallRow>('firmwareVersion', 'Firmware', {
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

  function relativeTime(ts?: string | number | null) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
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
    integrationId="sophos-partner"
    scopeColumn={false}
    {columns}
    onrowclick={(row) => (drawerFirewall = drawerFirewall?.['id'] === row['id'] ? null : row)}
  />
{/if}

<!-- Firewall detail sheet -->
<Sheet.Root
  open={!!drawerFirewall}
  onOpenChange={(open) => {
    if (!open) drawerFirewall = null;
  }}
>
  <Sheet.Content side="right" class="w-80 flex flex-col p-0">
    {#if drawerFirewall}
      {@const fw = drawerFirewall}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{String(fw['name'] ?? '—')}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 mt-1">
          <span
            class={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
              fw['connected'] ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
            )}
          >
            {fw['connected'] ? 'Online' : 'Offline'}
          </span>
          {#if fw['upgradeToVersion']}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-warning/20 text-warning"
            >
              Upgrade Available
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Details
        </div>
        {#each [{ label: 'Hostname', value: fw['hostname'] }, { label: 'Model', value: fw['model'] }, { label: 'Serial', value: fw['serialNumber'] }, { label: 'External IP', value: fw['externalIp'] }, { label: 'Firmware', value: fw['firmwareVersion'] }, { label: 'Upgrade To', value: fw['upgradeToVersion'] }, { label: 'Managing', value: fw['managing'] }, { label: 'Reporting', value: fw['reporting'] }, { label: 'Suspended', value: fw['suspended'] ? 'Yes' : null }, { label: 'Last Change', value: relativeTime(fw['lastChangeAt'] as string | null) }] as item}
          {#if item.value}
            <div class="flex justify-between text-xs gap-2">
              <span class="text-muted-foreground shrink-0">{item.label}</span>
              <span class="font-medium text-right font-mono">{String(item.value)}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
