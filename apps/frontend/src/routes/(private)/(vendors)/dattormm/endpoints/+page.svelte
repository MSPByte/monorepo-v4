<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { relativeDateColumn } from '$lib/components/data-table';
  import { nullableTextColumn, textColumn } from '$lib/components/data-table/column-defs';
  import Loader from '$lib/components/transition/loader.svelte';

  import type { dattoEndpoints } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type EndpointRow = typeof dattoEndpoints.$inferSelect & Record<string, unknown>;

  // ── Resolve the link for this site ──────────────────────────────────────
  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'dattormm', scopeStore.currentSite],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'dattormm',
        siteId: scopeStore.currentSite!,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLinkId = $derived(
    scopeStore.currentSite ? (siteLinkQuery.data?.[0]?.id ?? null) : undefined
  );

  const columns: DataTableColumn<EndpointRow>[] = [
    textColumn('hostname', 'Hostname'),
    textColumn('category', 'Category'),
    textColumn('os', 'OS'),
    nullableTextColumn('ipAddress', 'IP Address'),
    nullableTextColumn('extAddress', 'External IP'),
    relativeDateColumn('lastHeartbeatAt', 'Last Heartbeat'),
    relativeDateColumn('lastRebootAt', 'Last Reboot'),
  ];

  let drawerEndpoint = $state<EndpointRow | null>(null);
  let activeTab = $state<'Details' | 'UDFs'>('Details');

  $effect(() => {
    if (drawerEndpoint) activeTab = 'Details';
  });

  const udfEntries = $derived.by(() => {
    const udfs = drawerEndpoint?.['udfs'];
    if (!udfs || typeof udfs !== 'object') return [];
    return Object.entries(udfs as Record<string, unknown>).filter(([, v]) => v != null && v !== '');
  });

  function absoluteDate(ts?: number | string | null) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
</script>

{#if scopeStore.currentSite && siteLinkQuery.isLoading}
  <Loader />
{:else if scopeStore.currentSite && !currentLinkId}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">No DattoRMM integration for this site.</div>
  </div>
{:else}
  <VendorDataTable
    table="datto_endpoints"
    linkId={currentLinkId ?? undefined}
    integrationId="dattormm"
    scopeColumn="site"
    {columns}
    onrowclick={(row) => (drawerEndpoint = row)}
  />
{/if}

<!-- Endpoint detail sheet -->
<Sheet.Root
  open={!!drawerEndpoint}
  onOpenChange={(open) => {
    if (!open) drawerEndpoint = null;
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if drawerEndpoint}
      {@const ep = drawerEndpoint}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{String(ep['hostname'] ?? '—')}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 flex-wrap mt-1">
          <span
            class={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
              ep['online'] ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
            )}
          >
            {ep['online'] ? 'Online' : 'Offline'}
          </span>
          {#if ep['category']}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground capitalize"
            >
              {String(ep['category'])}
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex gap-1 border-b">
          {#each ['Details', 'UDFs'] as const as tab}
            <button
              onclick={() => (activeTab = tab)}
              class={cn(
                'px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab}
            </button>
          {/each}
        </div>

        {#if activeTab === 'Details'}
          <div class="grid grid-cols-2 gap-3 text-xs">
            {#each [{ label: 'OS', value: ep['os'] }, { label: 'Category', value: ep['category'] }, { label: 'IP Address', value: ep['ipAddress'] }, { label: 'External IP', value: ep['extAddress'] }, { label: 'Last Heartbeat', value: absoluteDate(ep['lastHeartbeatAt'] as string | null) }, { label: 'Last Reboot', value: absoluteDate(ep['lastReboootAt'] as string | null) }] as item}
              <div>
                <div class="text-muted-foreground mb-0.5">{item.label}</div>
                <div class="font-medium font-mono">{item.value ? String(item.value) : '—'}</div>
              </div>
            {/each}
          </div>
        {:else if activeTab === 'UDFs'}
          {#if udfEntries.length === 0}
            <div class="text-sm text-muted-foreground">No user-defined fields.</div>
          {:else}
            <div class="flex flex-col gap-2">
              {#each udfEntries as [key, value]}
                <div class="rounded border bg-card px-3 py-2">
                  <div class="text-xs text-muted-foreground">{key}</div>
                  <div class="text-sm font-medium mt-0.5 font-mono break-all">{String(value)}</div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
