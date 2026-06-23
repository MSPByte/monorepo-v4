<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import { cn } from '$lib/utils';
  import InsightsPanel from './_InsightsPanel.svelte';
  import GlobalLinksOverview, { type LinkOverviewRow } from '../_GlobalLinksOverview.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const overviewQuery = createQuery(() => ({
    queryKey: ['vendor.linkOverview', 'microsoft-365'],
    queryFn: () => trpc.vendor.linkOverview.query({ integrationId: 'microsoft-365' }),
    enabled: !scopeStore.currentLink,
  }));

  const tenantStatsQuery = createQuery(() => ({
    queryKey: ['vendor.m365TenantStats', scopeStore.currentLink],
    queryFn: () => trpc.vendor.m365TenantStats.query({ linkId: scopeStore.currentLink! }),
    enabled: !!scopeStore.currentLink,
  }));

  const identityStats = $derived(
    tenantStatsQuery.data?.identities ?? { total: 0, noMfa: 0, stale: 0 }
  );
  const licenseStats = $derived(tenantStatsQuery.data?.licenses ?? { skus: 0, unused: 0 });
  const policyStats = $derived(tenantStatsQuery.data?.policies ?? { total: 0, enabled: 0 });

  const mfaPct = $derived.by(() => {
    const { total, noMfa } = identityStats;
    if (!total) return 0;
    return Math.round(((total - noMfa) / total) * 100);
  });

  const metricsLoading = $derived(tenantStatsQuery.isPending);
  const overviewRows = $derived((overviewQuery.data ?? []) as LinkOverviewRow[]);

  function selectTenant(row: LinkOverviewRow) {
    scopeStore.currentLink = row.linkId;
    goto('/microsoft-365');
  }
</script>

{#if scopeStore.currentLink}
  <div class="flex flex-col size-full overflow-hidden">
    <div class="flex items-center gap-5 px-4 py-2.5 border-b shrink-0 flex-wrap">
      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline gap-1.5">
          <span class="text-lg font-semibold tabular-nums">
            {metricsLoading ? '—' : identityStats.total}
          </span>
          <span class="text-xs text-muted-foreground">Identities</span>
        </div>
        {#if !metricsLoading && identityStats.stale > 0}
          <span class="text-[11px] text-warning tabular-nums">{identityStats.stale} stale</span>
        {/if}
      </div>

      <div class="w-px h-8 bg-border shrink-0"></div>

      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline gap-1.5">
          <span
            class={cn(
              'text-lg font-semibold tabular-nums',
              !metricsLoading && identityStats.noMfa > 0 && 'text-destructive'
            )}
          >
            {metricsLoading ? '—' : identityStats.noMfa}
          </span>
          <span class="text-xs text-muted-foreground">No MFA</span>
        </div>
        {#if !metricsLoading}
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] text-muted-foreground tabular-nums">{mfaPct}% coverage</span>
            <div class="w-12 h-1 rounded-full bg-border overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500"
                style="width:{mfaPct}%;background:var(--success)"
              ></div>
            </div>
          </div>
        {/if}
      </div>

      <div class="w-px h-8 bg-border shrink-0"></div>

      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline gap-1.5">
          <span
            class={cn(
              'text-lg font-semibold tabular-nums',
              !metricsLoading && licenseStats.unused > 0 && 'text-destructive'
            )}
          >
            {metricsLoading ? '—' : licenseStats.unused}
          </span>
          <span class="text-xs text-muted-foreground">Unused Seats</span>
        </div>
        {#if !metricsLoading}
          <span class="text-[11px] text-muted-foreground tabular-nums">
            {licenseStats.skus} SKUs
          </span>
        {/if}
      </div>

      <div class="w-px h-8 bg-border shrink-0"></div>

      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline gap-1.5">
          <span class="tabular-nums">
            {metricsLoading ? '—' : policyStats.enabled} CA Policies
          </span>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-hidden">
      <InsightsPanel linkId={scopeStore.currentLink} />
    </div>
  </div>
{:else}
  <GlobalLinksOverview
    rows={overviewRows}
    isLoading={overviewQuery.isPending}
    isPending={overviewQuery.isPending}
    vendorName="Microsoft 365"
    totalLabel="Total Tenants"
    nameColumnLabel="Tenant"
    searchPlaceholder="Search tenants..."
    emptyEntityLabel="tenants"
    showDispositionColumn={false}
    showNotesColumn={false}
    onrowclick={selectTenant}
  />
{/if}
