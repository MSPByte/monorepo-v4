<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import type { createTrpcClient } from '$lib/trpc';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import {
    boolBadgeColumn,
    dateColumn,
    nullableTextColumn,
    numberColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';

  import type { sophosLicensesWithSite } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type LicenseRow = typeof sophosLicensesWithSite.$inferSelect & Record<string, unknown>;

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

  const columns: DataTableColumn<LicenseRow>[] = $derived([
    ...(!currentLinkId
      ? [
          textColumn<LicenseRow>('siteName', 'Site', undefined, {
            width: '180px',
          }),
        ]
      : []),
    textColumn<LicenseRow>('name', 'Name'),
    textColumn<LicenseRow>('code', 'Code', undefined, { width: '190px' }),
    nullableTextColumn<LicenseRow>('type', 'Type', {
      width: '120px',
      sortable: true,
      searchable: true,
    }),
    boolBadgeColumn<LicenseRow>(
      'perpetual',
      'Term',
      {
        trueLabel: 'Perpetual',
        falseLabel: 'Termed',
      },
      { width: '110px' }
    ),
    boolBadgeColumn<LicenseRow>(
      'unlimited',
      'Limit',
      {
        trueLabel: 'Unlimited',
        falseLabel: 'Limited',
      },
      { width: '110px' }
    ),
    numberColumn<LicenseRow>('quantity', 'Qty', undefined, { width: '80px' }),
    numberColumn<LicenseRow>('usageCount', 'Used', undefined, {
      width: '80px',
    }),
    dateColumn<LicenseRow>('startedAt', 'Starts', { width: '120px' }),
    dateColumn<LicenseRow>('endsAt', 'Ends', { width: '120px' }),
  ] as DataTableColumn<LicenseRow>[]);
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
    table="sophos_licenses_with_site"
    linkId={currentLinkId ?? undefined}
    integrationId="sophos-partner"
    scopeColumn={false}
    {columns}
  />
{/if}
