<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import type { DataTableColumn, TableView } from '$lib/components/data-table/types';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { BACKUP_STATUS_COLORS, BACKUP_STATUS_LABEL } from './_backup-status';
  import Loader from '$lib/components/transition/loader.svelte';
  import { textColumn } from '$lib/components/data-table/column-defs';

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  import type { coveEndpointsWithSite } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type EndpointRow = typeof coveEndpointsWithSite.$inferSelect & Record<string, unknown>;

  const siteLinkQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'cove', scopeStore.currentSite],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'cove',
        siteId: scopeStore.currentSite!,
      }),
    enabled: !!scopeStore.currentSite,
  }));

  const currentLinkId = $derived(
    scopeStore.currentSite ? (siteLinkQuery.data?.[0]?.id ?? null) : undefined
  );

  const columns: DataTableColumn<EndpointRow>[] = $derived([
    ...(!currentLinkId
      ? [
          textColumn<EndpointRow>('siteName', 'Site', undefined, {
            width: '180px',
          }),
        ]
      : []),
    { key: 'status', title: 'Status', width: '110px', sortable: true, cell: statusCell },
    {
      key: 'endpointName',
      title: 'Endpoint',
      sortable: true,
      searchable: true,
      cell: endpointCell,
    },
    { key: 'type', title: 'Type', width: '110px', sortable: true, cell: mutedCell },
    {
      key: 'hostname',
      title: 'Hostname',
      width: '180px',
      sortable: true,
      searchable: true,
      cell: mutedCell,
    },
    { key: 'errors', title: 'Errors', width: '90px', sortable: true, cell: errorsCell },
    { key: 'usedStorage', title: 'Used', width: '110px', sortable: true, cell: usedStorageCell },
    {
      key: 'selectedSize',
      title: 'Selected',
      width: '110px',
      sortable: true,
      cell: selectedSizeCell,
    },
    { key: 'last28Days', title: 'Last 28 Days', width: '170px', cell: historyCell },
    {
      key: 'lastSuccessAt',
      title: 'Last Success',
      width: '130px',
      sortable: true,
      cell: lastSuccessCell,
    },
  ]);

  let drawerEndpoint = $state<EndpointRow | null>(null);

  const NOW = Date.now();

  function relativeTime(ts?: number | null) {
    if (!ts) return 'Never';
    const diff = NOW - ts;
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }

  function statusBadgeClass(status: string) {
    if (status === 'active') return 'bg-success/15 text-success';
    if (status === 'inactive') return 'bg-muted text-muted-foreground';
    return 'bg-destructive/15 text-destructive';
  }
</script>

{#snippet statusCell({ row }: { row: EndpointRow; value: unknown })}
  <span
    class={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize',
      statusBadgeClass(String(row['status'] ?? 'error'))
    )}
  >
    {String(row['status'] ?? 'unknown')}
  </span>
{/snippet}

{#snippet endpointCell({ row }: { row: EndpointRow; value: unknown })}
  <div class="flex flex-col gap-0.5">
    <span class="font-medium text-sm">{String(row['endpointName'] ?? '—')}</span>
    <span class="text-xs text-muted-foreground">{String(row['hostname'] ?? '')}</span>
  </div>
{/snippet}

{#snippet mutedCell({ value }: { row: EndpointRow; value: unknown })}
  <span class="text-sm text-muted-foreground">{value ? String(value) : '—'}</span>
{/snippet}

{#snippet errorsCell({ row }: { row: EndpointRow; value: unknown })}
  {@const errors = Number(row['errors'] ?? 0)}
  <span
    class={cn(
      'inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 rounded text-xs font-medium',
      errors > 0 ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'
    )}
  >
    {errors}
  </span>
{/snippet}

{#snippet usedStorageCell({ row }: { row: EndpointRow; value: unknown })}
  <span class="text-xs">{formatBytes(Number(row['usedStorage'] ?? 0))}</span>
{/snippet}

{#snippet selectedSizeCell({ row }: { row: EndpointRow; value: unknown })}
  <span class="text-xs">{formatBytes(Number(row['selectedSize'] ?? 0))}</span>
{/snippet}

{#snippet historyCell({ row }: { row: EndpointRow; value: unknown })}
  <div class="flex gap-px">
    {#each String(row['last28Days'] ?? '')
      .split('')
      .reverse() as code}
      <div
        class={cn('h-4 w-1.5 rounded-sm', BACKUP_STATUS_COLORS[code] ?? 'bg-muted-foreground/20')}
        title={BACKUP_STATUS_LABEL[code] ?? 'Unknown'}
      ></div>
    {/each}
  </div>
{/snippet}

{#snippet lastSuccessCell({ row }: { row: EndpointRow; value: unknown })}
  {@const lastSuccess = row['lastSuccessAt']
    ? new Date(String(row['lastSuccessAt'])).getTime()
    : null}
  <span
    class={cn(
      'text-xs',
      !lastSuccess || NOW - lastSuccess > 7 * 86_400_000
        ? 'text-destructive'
        : 'text-muted-foreground'
    )}
  >
    {relativeTime(lastSuccess)}
  </span>
{/snippet}

{#if scopeStore.currentSite && siteLinkQuery.isLoading}
  <Loader />
{:else if scopeStore.currentSite && !currentLinkId}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">No Cove integration for this site.</div>
  </div>
{:else}
  <VendorDataTable
    table="cove_endpoints_with_site"
    linkId={currentLinkId ?? undefined}
    integrationId="cove"
    scopeColumn={false}
    {columns}
    defaultSort={{ field: 'siteName', dir: 'asc' }}
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
        <Sheet.Title>{String(ep['endpointName'] ?? ep['hostname'] ?? '—')}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 flex-wrap mt-1">
          {#if ep['status']}
            <span
              class={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                statusBadgeClass(String(ep['status']))
              )}
            >
              {String(ep['status'])}
            </span>
          {/if}
          {#if ep['type']}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground"
            >
              {String(ep['type'])}
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- Storage -->
        <div>
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Storage
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded border bg-card px-3 py-2">
              <div class="text-xs text-muted-foreground">Used Storage</div>
              <div class="text-sm font-semibold mt-0.5">
                {formatBytes(Number(ep['usedStorage'] ?? 0))}
              </div>
            </div>
            <div class="rounded border bg-card px-3 py-2">
              <div class="text-xs text-muted-foreground">Selected Size</div>
              <div class="text-sm font-semibold mt-0.5">
                {formatBytes(Number(ep['selectedSize'] ?? 0))}
              </div>
            </div>
          </div>
        </div>

        <!-- Backup History -->
        <div>
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Backup History
          </div>
          <div class="rounded border bg-card px-3 py-3 flex flex-col gap-3">
            {#if ep['last28Days']}
              <div>
                <div class="text-xs text-muted-foreground mb-1.5">Last 28 Days</div>
                <div class="flex gap-px">
                  {#each String(ep['last28Days']).split('').reverse() as code}
                    <div
                      class="h-5 w-2 rounded-sm {BACKUP_STATUS_COLORS[code] ??
                        'bg-muted-foreground/20'}"
                      title={BACKUP_STATUS_LABEL[code] ?? 'Unknown'}
                    ></div>
                  {/each}
                </div>
              </div>
            {/if}
            <div class="grid grid-cols-2 gap-2">
              <div>
                <div class="text-xs text-muted-foreground">Last Success</div>
                <div class="text-sm font-medium mt-0.5">
                  {relativeTime(
                    ep['lastSuccessAt'] ? new Date(String(ep['lastSuccessAt'])).getTime() : null
                  )}
                </div>
              </div>
              <div>
                <div class="text-xs text-muted-foreground">Errors</div>
                <div class="mt-0.5">
                  {#if Number(ep['errors'] ?? 0) > 0}
                    <span
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-destructive/15 text-destructive"
                    >
                      {Number(ep['errors'])}
                    </span>
                  {:else}
                    <span
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-success/15 text-success"
                    >
                      0
                    </span>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Details -->
        <div>
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Details
          </div>
          <div class="flex flex-col gap-2">
            {#each [{ label: 'Hostname', value: ep['hostname'] }, { label: 'Profile', value: ep['profile'] }, { label: 'Retention Policy', value: ep['retentionPolicy'] }, { label: 'LSV Status', value: ep['lsvStatus'] }] as item}
              {#if item.value}
                <div class="rounded border bg-card px-3 py-2">
                  <div class="text-xs text-muted-foreground">{item.label}</div>
                  <div class="text-sm font-medium mt-0.5">{String(item.value)}</div>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
