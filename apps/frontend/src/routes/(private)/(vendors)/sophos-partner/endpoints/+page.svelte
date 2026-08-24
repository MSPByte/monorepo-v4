<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
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
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import Progress from '$lib/components/ui/progress/progress.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import { formatStringProper } from '$lib/utils/format';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import ShieldOffIcon from '@lucide/svelte/icons/shield-off';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import ArrowRightLeftIcon from '@lucide/svelte/icons/arrow-right-left';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';

  import type { sophosEndpointsWithSite } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type EndpointRow = typeof sophosEndpointsWithSite.$inferSelect & Record<string, unknown>;

  const siteLinkQuery = createQuery(() => ({
    queryKey: [
      'integrationLinks.list',
      'sophos-partner',
      scopeStore.currentSite,
      scopeStore.currentGroup,
    ],
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

  const NOW = Date.now();

  const columns: DataTableColumn<EndpointRow>[] = $derived([
    ...(!currentLinkId
      ? [
          textColumn<EndpointRow>('siteName', 'Site', undefined, undefined, {
            width: '180px',
          }),
        ]
      : []),
    textColumn<EndpointRow>('hostname', 'Hostname'),
    nullableTextColumn<EndpointRow>('platform', 'Platform', undefined, {
      width: '120px',
      sortable: true,
    }),
    {
      ...nullableTextColumn<EndpointRow>('type', 'Type', undefined, {
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
      'Upgradeable',
      {
        trueLabel: 'Available',
        falseLabel: 'Current',
        falseVariant: 'muted',
      },
      {
        width: '110px',
        filter: {
          label: 'Upgradeable',
          type: 'boolean',
          operators: ['eq', 'neq'],
          defaultOperator: 'eq',
        },
      }
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

  const canWriteAssets = $derived(authStore.isAllowed('Assets.Write'));
  const canDeleteAssets = $derived(authStore.isAllowed('Assets.Delete'));

  type MoveDialogState = {
    rows: EndpointRow[];
    sourceLinkId: string;
    sourceSiteId: string | null;
    sourceSiteName: string | null;
    fetchData: () => Promise<void>;
    targetSiteId?: string;
    starting: boolean;
    jobId?: string;
    status?: {
      status: string;
      requested: number;
      succeeded: number;
      failed: number;
      pending?: number;
      error?: string | null;
    };
    pollError?: string;
  };

  let moveDialog = $state<MoveDialogState | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const sophosLinksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'sophos-partner', 'all'],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'sophos-partner',
        status: 'active',
      }),
  }));

  const sitesListQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const moveTargetOptions = $derived.by(() => {
    if (!moveDialog) return [] as { value: string; label: string }[];
    const linkedSiteIds = new Set(
      (sophosLinksQuery.data ?? [])
        .filter((l) => !!l.siteId && l.status !== 'disabled')
        .map((l) => l.siteId as string)
    );
    return (sitesListQuery.data ?? [])
      .filter((s) => linkedSiteIds.has(s.id) && s.id !== moveDialog!.sourceSiteId)
      .map((s) => ({ value: s.id, label: s.name }));
  });

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  onDestroy(stopPolling);

  async function pollMigration(jobId: string) {
    if (!moveDialog || moveDialog.jobId !== jobId) return;
    try {
      const status = await trpc.vendor.sophosEndpointMigrationStatus.query({ id: jobId });
      if (!moveDialog || moveDialog.jobId !== jobId) return;
      moveDialog.status = status;
      moveDialog.pollError = undefined;
      if (
        status.status === 'completed' ||
        status.status === 'failed' ||
        status.status === 'partial'
      ) {
        stopPolling();
        await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
        await moveDialog.fetchData();
        if (status.status === 'completed') {
          toast.success(`Moved ${status.succeeded} endpoint${status.succeeded === 1 ? '' : 's'}`);
        } else if (status.status === 'partial') {
          toast.warning(`Moved ${status.succeeded}, failed ${status.failed}`);
        } else {
          toast.error(
            `Migration failed for all ${status.failed} endpoint${status.failed === 1 ? '' : 's'}`
          );
        }
        return;
      }
    } catch (err) {
      if (!moveDialog || moveDialog.jobId !== jobId) return;
      moveDialog.pollError = err instanceof Error ? err.message : String(err);
    }
    pollTimer = setTimeout(() => pollMigration(jobId), 3000);
  }

  async function startMove() {
    if (!moveDialog || !moveDialog.targetSiteId || moveDialog.starting) return;
    moveDialog.starting = true;
    try {
      const result = await trpc.vendor.startSophosEndpointMigration.mutate({
        ids: moveDialog.rows.map((r) => String(r['id'])),
        toSiteId: moveDialog.targetSiteId,
      });
      if (!moveDialog) return;
      moveDialog.jobId = result.id;
      moveDialog.status = {
        status: 'running',
        requested: result.requested,
        succeeded: 0,
        failed: 0,
        pending: result.requested,
      };
      pollMigration(result.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to start migration: ${msg}`);
      if (moveDialog) moveDialog.starting = false;
    }
  }

  function closeMoveDialog() {
    stopPolling();
    moveDialog = null;
  }
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
            label: 'Move to Site',
            icon: ArrowRightLeftIcon,
            variant: 'outline',
            disabled: (rows: EndpointRow[]) => {
              if (rows.length === 0) return true;
              const linkIds = new Set(rows.map((r) => String(r['linkId'] ?? '')));
              return linkIds.size !== 1;
            },
            onclick: async (rows, fetchData) => {
              if (rows.length === 0) return;
              const linkIds = new Set(rows.map((r) => String(r['linkId'] ?? '')));
              if (linkIds.size !== 1) {
                toast.error('All selected endpoints must belong to the same source site');
                return;
              }
              moveDialog = {
                rows,
                sourceLinkId: String(rows[0]!['linkId'] ?? ''),
                sourceSiteId: (rows[0]!['siteId'] as string | null) ?? null,
                sourceSiteName: (rows[0]!['siteName'] as string | null) ?? null,
                fetchData,
                starting: false,
              };
            },
          } satisfies RowAction<EndpointRow>,
          {
            label: 'Upgrade Endpoints',
            icon: ArrowUpIcon,
            variant: 'outline',
            disabled: (rows: EndpointRow[]) =>
              rows.length === 0 || rows.every((row) => row['needsUpgrade'] !== true),
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = rows.map((row) => String(row['id'])).filter(Boolean);
              if (ids.length === 0) return;
              const upgradeable = rows.filter((row) => row['needsUpgrade'] === true).length;
              setProgress(
                `Requesting software upgrades for ${upgradeable} endpoint${upgradeable === 1 ? '' : 's'} across their Sophos sites...`
              );
              const result = await trpc.vendor.upgradeSophosEndpointSoftware.mutate({ ids });
              setProgress('Refreshing endpoint data...');
              await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
              await fetchData();
              if (result.failed > 0 && result.upgraded > 0) {
                toast.warning(
                  `Requested upgrades for ${result.upgraded} endpoint${result.upgraded === 1 ? '' : 's'}, ${result.failed} failed`
                );
              } else if (result.failed > 0) {
                toast.error(
                  `Failed to request upgrades for ${result.failed} endpoint${result.failed === 1 ? '' : 's'}`
                );
              } else if (result.upgraded > 0) {
                toast.success(
                  `Requested upgrades for ${result.upgraded} endpoint${result.upgraded === 1 ? '' : 's'}`
                );
              } else {
                toast.info('No selected endpoints have an available software upgrade');
              }
            },
          } satisfies RowAction<EndpointRow>,
          {
            label: 'Disable Tamper',
            icon: ShieldOffIcon,
            variant: 'destructive',
            disabled: (rows: EndpointRow[]) =>
              rows.length === 0 || rows.every((row) => row['tamperProtectionEnabled'] === false),
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = rows.map((row) => String(row['id'])).filter(Boolean);
              if (ids.length === 0) return;

              setProgress(
                `Requesting tamper protection disablement for ${ids.length} endpoint${ids.length === 1 ? '' : 's'}...`
              );
              const result = await trpc.vendor.disableSophosEndpointTamperProtection.mutate({
                ids,
              });
              setProgress('Refreshing endpoint data...');
              await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
              await fetchData();

              const failures = result.results.filter((endpoint) => !endpoint.success);
              if (failures.length > 0) {
                console.error('Failed to disable Sophos tamper protection', {
                  batchId: result.batchId,
                  failures: failures.map(({ id, hostname, externalId, error }) => ({
                    id,
                    hostname,
                    externalId,
                    error: error ?? 'Unknown error',
                  })),
                });
              }

              if (result.failed > 0 && result.updated > 0) {
                toast.warning(
                  `Disabled tamper protection on ${result.updated} endpoint${result.updated === 1 ? '' : 's'}, ${result.failed} failed`
                );
              } else if (result.failed > 0) {
                toast.error(
                  `Failed to disable tamper protection on ${result.failed} endpoint${result.failed === 1 ? '' : 's'}`
                );
              } else if (result.updated > 0) {
                toast.success(
                  `Disabled tamper protection on ${result.updated} endpoint${result.updated === 1 ? '' : 's'}`
                );
              } else {
                toast.info('Selected endpoints already have tamper protection disabled');
              }
            },
          } satisfies RowAction<EndpointRow>,
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
    groupId={scopeStore.currentGroup ?? undefined}
    integrationId="sophos-partner"
    scopeColumn={false}
    {columns}
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

<!-- Move endpoints to site dialog -->
<Dialog.Root
  open={!!moveDialog}
  onOpenChange={(open) => {
    if (!open) closeMoveDialog();
  }}
>
  <Dialog.Content class="sm:max-w-lg">
    {#if moveDialog}
      {@const state = moveDialog.status}
      {@const jobActive = !!moveDialog.jobId && !!state && state.status === 'running'}
      {@const jobDone =
        !!state &&
        (state.status === 'completed' || state.status === 'failed' || state.status === 'partial')}
      <Dialog.Header>
        <Dialog.Title>Move endpoints to another site</Dialog.Title>
        <Dialog.Description>
          Migrates {moveDialog.rows.length} endpoint{moveDialog.rows.length === 1 ? '' : 's'} from
          <span class="font-medium">{moveDialog.sourceSiteName ?? 'current site'}</span> to the target
          Sophos tenant.
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>

      <div class="flex flex-col gap-4 text-sm">
        {#if !moveDialog.jobId}
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium text-muted-foreground" for="move-target-site">
              Target site
            </label>
            {#if sophosLinksQuery.isLoading || sitesListQuery.isLoading}
              <Loader />
            {:else}
              <SingleSelect
                options={moveTargetOptions}
                bind:selected={moveDialog.targetSiteId}
                placeholder="Select target site..."
                searchPlaceholder="Search sites..."
                disabled={moveDialog.starting}
              />
              {#if moveTargetOptions.length === 0}
                <div class="text-xs text-muted-foreground">
                  No other sites have an active Sophos Partner integration.
                </div>
              {/if}
            {/if}
          </div>
          <div class="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            The Sophos migration runs asynchronously. You can close this dialog and return later —
            the move will continue on Sophos, and endpoint records will be repointed once complete.
          </div>
        {:else if state}
          {@const total = state.requested || 1}
          {@const done = state.succeeded + state.failed}
          {@const pct = Math.round((done / total) * 100)}
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium">
                {#if state.status === 'running'}
                  Running...
                {:else if state.status === 'completed'}
                  Completed
                {:else if state.status === 'partial'}
                  Partial
                {:else}
                  Failed
                {/if}
              </span>
              <span class="text-muted-foreground">{done} / {total}</span>
            </div>
            <Progress value={pct} />
            <div class="grid grid-cols-3 gap-2 text-xs">
              <div class="rounded-md border p-2">
                <div class="text-muted-foreground">Succeeded</div>
                <div class="font-medium text-success">{state.succeeded}</div>
              </div>
              <div class="rounded-md border p-2">
                <div class="text-muted-foreground">Failed</div>
                <div class="font-medium text-destructive">{state.failed}</div>
              </div>
              <div class="rounded-md border p-2">
                <div class="text-muted-foreground">Pending</div>
                <div class="font-medium">
                  {state.pending ?? Math.max(0, state.requested - state.succeeded - state.failed)}
                </div>
              </div>
            </div>
            {#if moveDialog.pollError}
              <div
                class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
              >
                Poll error: {moveDialog.pollError}
              </div>
            {/if}
          </div>
        {/if}
      </div>


      </Dialog.Body><Dialog.Footer>
        {#if !moveDialog.jobId}
          <Button variant="outline" onclick={closeMoveDialog} disabled={moveDialog.starting}>
            Cancel
          </Button>
          <Button
            onclick={startMove}
            disabled={!moveDialog.targetSiteId ||
              moveDialog.starting ||
              moveTargetOptions.length === 0}
          >
            {moveDialog.starting ? 'Starting...' : 'Move'}
          </Button>
        {:else if jobActive}
          <Button variant="outline" onclick={closeMoveDialog}>Close (keeps running)</Button>
        {:else if jobDone}
          <Button onclick={closeMoveDialog}>Done</Button>
        {/if}
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
