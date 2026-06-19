<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { goto } from '$app/navigation';
  import { cn } from '$lib/utils';
  import InsightsPanel from './_InsightsPanel.svelte';
  import GlobalSitesOverview, {
    type GlobalOverviewExtraColumn,
    type GlobalOverviewRow,
  } from '../_GlobalSitesOverview.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  // ── Global overview ──────────────────────────────────────────────────────
  const overviewQuery = createQuery(() => ({
    queryKey: ['vendor.m365TenantOverview'],
    queryFn: () => trpc.vendor.m365TenantOverview.query(),
    enabled: !scopeStore.currentLink,
  }));

  // ── Per-tenant data ───────────────────────────────────────────────────────
  const tenantStatsQuery = createQuery(() => ({
    queryKey: ['vendor.m365TenantStats', scopeStore.currentLink],
    queryFn: () => trpc.vendor.m365TenantStats.query({ linkId: scopeStore.currentLink! }),
    enabled: !!scopeStore.currentLink,
  }));

  function refreshTenantAlerts() {
    queryClient.invalidateQueries({
      queryKey: ['alerts.insightGroups', 'microsoft-365', scopeStore.currentLink, 'active'],
    });
    queryClient.invalidateQueries({ queryKey: ['vendor.m365TenantOverview'] });
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
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

  const overviewRows = $derived(overviewQuery.data ?? []);

  const globalOverviewColumns: GlobalOverviewExtraColumn[] = [
    {
      key: 'complianceFailures',
      label: 'Compliance Failures',
      widthClass: 'w-40',
      emptyWhenZero: true,
      badgeClass: () => 'bg-destructive/15 text-destructive',
    },
  ];

  function selectTenant(row: GlobalOverviewRow) {
    scopeStore.currentLink = row.linkId;
    goto('/microsoft-365');
  }
</script>

{#if scopeStore.currentLink}
  <!-- ── Per-tenant dashboard ──────────────────────────────────────────── -->
  <div class="flex flex-col size-full overflow-hidden">
    <!-- Compact metrics strip -->
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

    <!-- Insights panel fills remaining space -->
    <div class="flex-1 overflow-hidden">
      <InsightsPanel linkId={scopeStore.currentLink} onalertchange={refreshTenantAlerts} />
    </div>
  </div>
{:else}
  <!-- ── Global tenants overview ───────────────────────────────────────── -->
  <GlobalSitesOverview
    rows={overviewRows}
    isLoading={overviewQuery.isPending}
    isPending={overviewQuery.isPending}
    vendorName="Microsoft 365"
    totalLabel="Total Tenants"
    nameColumnLabel="Tenant"
    searchPlaceholder="Search tenants..."
    emptyEntityLabel="tenants"
    extraColumns={globalOverviewColumns}
    showDispositionColumn={false}
    showNotesColumn={false}
    onrowclick={selectTenant}
  />
{/if}
