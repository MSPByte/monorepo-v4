<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import type { DataTableColumn, RowAction, TableView } from '$lib/components/data-table/types';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import {
    boolBadgeColumn,
    nullableTextColumn,
    relativeDateColumn,
    textColumn,
  } from '$lib/components/data-table/column-defs';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import Loader from '$lib/components/transition/loader.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import { formatStringProper } from '$lib/utils/format';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';

  import type { sophosEndpointsWithSite } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type EndpointRow = typeof sophosEndpointsWithSite.$inferSelect & Record<string, unknown>;
  const STALE_ENDPOINT_DAYS = 60;

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

  const NOW = Date.now();
  const staleCutoff = new Date(NOW - STALE_ENDPOINT_DAYS * 86_400_000).toISOString();

  const columns: DataTableColumn<EndpointRow>[] = $derived([
    ...(!currentLinkId
      ? [
          textColumn<EndpointRow>('siteName', 'Site', undefined, {
            width: '180px',
          }),
        ]
      : []),
    textColumn<EndpointRow>('hostname', 'Hostname'),
    nullableTextColumn<EndpointRow>('platform', 'Platform', {
      width: '120px',
      sortable: true,
    }),
    {
      ...nullableTextColumn<EndpointRow>('type', 'Type', {
        width: '110px',
        sortable: true,
      }),
      filter: {
        type: 'select',
        operators: ['eq'],
        options: [
          { label: 'Computer', value: 'computer' },
          { label: 'Server', value: 'server' },
        ],
      },
    },
    boolBadgeColumn<EndpointRow>(
      'online',
      'Online',
      {
        trueLabel: 'Online',
        falseLabel: 'Offline',
        falseVariant: 'destructive',
      },
      { width: '100px' }
    ),
    boolBadgeColumn<EndpointRow>(
      'hasMdr',
      'MDR',
      {
        trueLabel: 'MDR',
        falseLabel: 'None',
      },
      { width: '90px' }
    ),
    boolBadgeColumn<EndpointRow>(
      'tamperProtectionEnabled',
      'Tamper',
      {
        trueLabel: 'Enabled',
        falseLabel: 'Disabled',
        falseVariant: 'destructive',
      },
      {
        width: '110px',
        filter: {
          label: 'Tamper Protection',
          type: 'boolean',
          operators: ['eq', 'neq'],
          defaultOperator: 'eq',
        },
      }
    ),
    boolBadgeColumn<EndpointRow>(
      'needsUpgrade',
      'Upgrade',
      {
        trueLabel: 'Current',
        falseLabel: 'Upgrade',
        falseVariant: 'destructive',
        evaluate: (value) => !value,
      },
      { width: '110px' }
    ),
    {
      key: 'health',
      title: 'Health',
      sortable: true,
      searchable: true,
      cell: healthColumn,
    },
    relativeDateColumn<EndpointRow>('lastHeartbeatAt', 'Last Heartbeat', {
      width: '150px',
      filter: {
        type: 'date',
        operators: ['lt', 'gt'],
        defaultOperator: 'lt',
      },
    }),
  ] as DataTableColumn<EndpointRow>[]);

  let drawerEndpoint = $state<EndpointRow | null>(null);

  const views: TableView<EndpointRow>[] = [
    {
      id: 'stale',
      label: 'Stale',
      filters: [{ field: 'lastHeartbeatAt', operator: 'lt', value: staleCutoff }],
      sort: { field: 'lastHeartbeatAt', dir: 'asc' },
    },
  ];

  const canWriteAssets = $derived(authStore.isAllowed('Assets.Write'));
  const canDeleteAssets = $derived(authStore.isAllowed('Assets.Delete'));
  const selectedEndpointId = $derived(
    drawerEndpoint?.['id'] ? String(drawerEndpoint['id']) : undefined
  );

  const tamperProtectionQuery = createQuery(() => ({
    queryKey: ['vendor.sophosEndpointTamperProtection', selectedEndpointId],
    queryFn: () =>
      trpc.vendor.sophosEndpointTamperProtection.query({ endpointId: selectedEndpointId! }),
    enabled: !!selectedEndpointId,
  }));

  const rowActions: RowAction<EndpointRow>[] = $derived([
    ...(canWriteAssets
      ? [
          {
            label: 'Enable Tamper',
            icon: ShieldCheckIcon,
            variant: 'outline',
            disabled: (rows: EndpointRow[]) =>
              rows.length === 0 || rows.every((row) => row['tamperProtectionEnabled'] === true),
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = rows.map((row) => String(row['id'])).filter(Boolean);
              if (ids.length === 0) return;

              setProgress(
                `Requesting tamper protection enablement for ${ids.length} endpoint${ids.length === 1 ? '' : 's'}...`
              );
              const result = await trpc.vendor.enableSophosEndpointTamperProtection.mutate({ ids });
              setProgress('Refreshing endpoint data...');
              await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
              await fetchData();

              if (result.failed > 0 && result.updated > 0) {
                toast.warning(
                  `Enabled tamper protection on ${result.updated} endpoint${result.updated === 1 ? '' : 's'}, ${result.failed} failed`
                );
              } else if (result.failed > 0) {
                toast.error(
                  `Failed to enable tamper protection on ${result.failed} endpoint${result.failed === 1 ? '' : 's'}`
                );
              } else if (result.updated > 0) {
                toast.success(
                  `Enabled tamper protection on ${result.updated} endpoint${result.updated === 1 ? '' : 's'}`
                );
              } else {
                toast.info('Selected endpoints already have tamper protection enabled');
              }
            },
          } satisfies RowAction<EndpointRow>,
        ]
      : []),
    ...(canDeleteAssets
      ? [
          {
            label: 'Delete',
            icon: Trash2Icon,
            variant: 'destructive',
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = rows.map((row) => String(row['id'])).filter(Boolean);
              if (ids.length === 0) return;

              setProgress(`Deleting ${ids.length} endpoint${ids.length === 1 ? '' : 's'}...`);
              const result = await trpc.vendor.deleteSophosEndpoints.mutate({ ids });
              setProgress('Refreshing endpoint data...');
              await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
              await fetchData();

              if (result.failed > 0 && result.deleted > 0) {
                toast.warning(
                  `Deleted ${result.deleted} endpoint${result.deleted === 1 ? '' : 's'}, ${result.failed} failed`
                );
              } else if (result.failed > 0) {
                toast.error(
                  `Failed to delete ${result.failed} endpoint${result.failed === 1 ? '' : 's'}`
                );
              } else {
                toast.success(
                  `Deleted ${result.deleted} endpoint${result.deleted === 1 ? '' : 's'} from Sophos`
                );
              }
            },
          } satisfies RowAction<EndpointRow>,
        ]
      : []),
  ]);

  function relativeTime(ts?: number | string | null) {
    if (!ts) return 'Never';
    const diff = NOW - new Date(ts).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }
</script>

{#snippet healthColumn({ value }: { row: EndpointRow; value: string })}
  {#if value === 'good'}
    <Badge variant="outline" class="bg-success/15 text-success border-success/30">Good</Badge>
  {:else}
    <Badge variant="outline" class="bg-warning/15 text-warning border-warning/30"
      >{formatStringProper(value)}</Badge
    >
  {/if}
{/snippet}

{#if scopeStore.currentSite && siteLinkQuery.isLoading}
  <Loader />
{:else if scopeStore.currentSite && !currentLinkId}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">No Sophos Partner integration for this site.</div>
  </div>
{:else}
  <VendorDataTable
    table="sophos_endpoints_with_site"
    linkId={currentLinkId ?? undefined}
    integrationId="sophos-partner"
    scopeColumn={false}
    {columns}
    {views}
    enableRowSelection={canWriteAssets || canDeleteAssets}
    {rowActions}
    onrowclick={(row) => (drawerEndpoint = row)}
    defaultSort={{ field: 'siteName', dir: 'asc' }}
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
          {#if ep['hasMdr']}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary/15 text-primary"
            >
              MDR
            </span>
          {/if}
          {#if ep['needsUpgrade']}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-warning/20 text-warning"
            >
              Needs Upgrade
            </span>
          {/if}
          {#if !ep['tamperProtectionEnabled']}
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-destructive/15 text-destructive"
            >
              Tamper Off
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-3 text-xs">
          {#each [{ label: 'OS', value: ep['osName'] }, { label: 'Platform', value: ep['platform'] }, { label: 'Type', value: ep['type'] }, { label: 'Lockdown', value: ep['lockdown'] }, { label: 'Tamper Protection', value: ep['tamperProtectionEnabled'] ? 'Enabled' : 'Disabled' }, { label: 'Needs Upgrade', value: ep['needsUpgrade'] ? 'Yes' : 'No' }, { label: 'MDR Managed', value: ep['hasMdr'] ? 'Yes' : 'No' }, { label: 'Last Heartbeat', value: relativeTime(ep['lastHeartbeatAt'] as string | null) }] as item}
            <div>
              <div class="text-muted-foreground mb-0.5">{item.label}</div>
              <div
                class={cn(
                  'font-medium capitalize',
                  item.label === 'Tamper Protection' && !ep['tamperProtectionEnabled']
                    ? 'text-destructive'
                    : item.label === 'Needs Upgrade' && ep['needsUpgrade']
                      ? 'text-warning'
                      : ''
                )}
              >
                {item.value ? String(item.value) : '—'}
              </div>
            </div>
          {/each}
        </div>

        <div class="border-t pt-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-medium">Tamper Codes</div>
              <div class="text-xs text-muted-foreground">
                {#if tamperProtectionQuery.data?.lastSeenAt}
                  Last seen {relativeTime(tamperProtectionQuery.data.lastSeenAt)}
                {:else}
                  Not synced
                {/if}
              </div>
            </div>
          </div>

          {#if tamperProtectionQuery.isLoading}
            <Loader />
          {:else if tamperProtectionQuery.data}
            <div class="space-y-3 text-xs">
              <div>
                <div class="text-muted-foreground mb-1">Current Code</div>
                <div class="rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm break-all">
                  {tamperProtectionQuery.data.password}
                </div>
              </div>

              <div>
                <div class="text-muted-foreground mb-1">
                  Previous Codes ({tamperProtectionQuery.data.previous.length})
                </div>
                {#if tamperProtectionQuery.data.previous.length > 0}
                  <div class="flex flex-col gap-1.5">
                    {#each tamperProtectionQuery.data.previous as code}
                      <div class="rounded-md border bg-muted/20 px-3 py-2 font-mono break-all">
                        {code}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="rounded-md border border-dashed p-3 text-muted-foreground">
                    No previous tamper codes.
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No tamper code has been synced for this endpoint.
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
