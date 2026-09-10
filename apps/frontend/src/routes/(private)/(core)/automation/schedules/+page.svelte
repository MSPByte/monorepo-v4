<script lang="ts">
  import '../workspace.css';
  import type { SignalStripApi } from '$lib/components/data-table/types';
  import { CalendarClock, Plus } from '@lucide/svelte';
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { DataTable } from '$lib/components/data-table';
  import type { DataTableColumn, PaginationInput } from '$lib/components/data-table/types';
  import { stateColumn, textColumn } from '$lib/components/data-table/column-defs';
  import Button from '$lib/components/ui/button/button.svelte';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
  import Pencil from '@lucide/svelte/icons/pencil';
  import X from '@lucide/svelte/icons/x';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { prettyText } from '$lib/utils/format';

  type ScheduleSnapshot = {
    id: string;
    name: string;
    version?: number;
    steps: unknown;
    prompts?: unknown;
    outcomeSteps?: unknown;
    runInputState?: {
      siteModes?: Record<string, 'select' | 'create'>;
      skippedStepIndexes?: number[];
    };
    scheduledBy?: string;
  };

  type ScheduleRow = {
    id: string;
    packageId: string;
    packageSnapshot: ScheduleSnapshot;
    runtimeInputs: Record<string, unknown>;
    siteId: string | null;
    siteName: string | null;
    linkId: string | null;
    linkName: string | null;
    packageRunId: string | null;
    packageVersion: number;
    scheduledLocalTime: string;
    timeZone: string;
    status: 'scheduled' | 'dispatching' | 'dispatched' | 'canceled';
    createdByUserId: string;
    scheduledBy?: string | null;
    createdAt: string;
  };

  type ScheduleTableRow = ScheduleRow & {
    packageName: string;
    target: string;
    searchBlob: string;
    [key: string]: unknown;
  };

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canRun = $derived(authStore.isAllowed('Packages.Run'));
  let newScheduleOpen = $state(false);
  let scheduleSummary = $state<{
    total: number;
    scheduled: number;
    dispatched: number;
    canceled: number;
  } | null>(null);
  const views = [
    {
      id: 'upcoming',
      label: 'Upcoming',
      isDefault: true,
      filters: [{ field: 'status', operator: 'eq' as const, value: 'scheduled' }],
    },
    {
      id: 'started',
      label: 'Started',
      filters: [{ field: 'status', operator: 'eq' as const, value: 'dispatched' }],
    },
    {
      id: 'canceled',
      label: 'Canceled',
      filters: [{ field: 'status', operator: 'eq' as const, value: 'canceled' }],
    },
  ];
  function localDate(value: string) {
    const date = new Date(value + (value.endsWith('Z') ? '' : 'Z'));
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(date);
  }
  let reviewSchedule = $state<ScheduleRow | null>(null);
  let deleteTarget = $state<ScheduleTableRow | null>(null);
  let refreshKey = $state(0);

  const cancel = createMutation(() => ({
    mutationFn: (id: string) => trpc.packageRuns.cancelSchedule.mutate({ id }),
    onSuccess: () => {
      toast.success('Schedule canceled');
      refreshKey++;
      void queryClient.invalidateQueries({ queryKey: ['packageRuns.schedules'] });
    },
    onError: (error) => toast.error(error.message ?? 'Unable to cancel schedule'),
  }));

  const deleteSchedule = createMutation(() => ({
    mutationFn: (id: string) => trpc.packageRuns.deleteSchedule.mutate({ id }),
    onSuccess: () => {
      toast.success('Schedule deleted');
      deleteTarget = null;
      refreshKey++;
      void queryClient.invalidateQueries({ queryKey: ['packageRuns.schedules'] });
    },
    onError: (error) => toast.error(error.message ?? 'Unable to delete schedule'),
  }));

  function compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a ?? '').localeCompare(String(b ?? ''));
  }

  const columns: DataTableColumn<ScheduleTableRow>[] = [
    textColumn<ScheduleTableRow>('packageName', 'Package', 'Search packages', undefined, {
      width: '280px',
      cell: scheduleIdentity,
      cellComponent: undefined,
    }),
    stateColumn<ScheduleTableRow>(
      'status',
      'Status',
      {
        transform: (value) =>
          ({
            scheduled: 'Scheduled',
            dispatching: 'Starting',
            dispatched: 'Started',
            canceled: 'Canceled',
          })[String(value)] ?? prettyText(String(value ?? '')),
        evaluate: (value) =>
          value === 'scheduled' ? 'success' : value === 'dispatched' ? 'info' : 'warn',
      },
      {
        filter: {
          type: 'select',
          operators: ['eq'],
          options: [
            { label: 'Scheduled', value: 'scheduled' },
            { label: 'Starting', value: 'dispatching' },
            { label: 'Started', value: 'dispatched' },
            { label: 'Canceled', value: 'canceled' },
          ],
        },
      }
    ),
    textColumn<ScheduleTableRow>(
      'scheduledLocalTime',
      'Scheduled for',
      'Search date and time',
      undefined,
      { width: '240px', cell: scheduleTime, cellComponent: undefined }
    ),
    {
      ...textColumn<ScheduleTableRow>('timeZone', 'Time zone', 'Search timezone', undefined, {
        width: '180px',
      }),
      defaultHidden: true,
    },
    textColumn<ScheduleTableRow>('target', 'Client / connection', 'Search site or integration'),
    textColumn<ScheduleTableRow>('scheduledBy', 'Scheduled by', 'Search scheduler', undefined, {
      width: '180px',
    }),
    {
      key: 'actions',
      title: '',
      sortable: false,
      hideable: false,
      width: '48px',
      cell: scheduleActions,
    },
  ];

  async function fetchData(
    input: PaginationInput
  ): Promise<{ rows: ScheduleTableRow[]; total: number }> {
    const schedules = await trpc.packageRuns.schedules.query({ limit: 200 });
    const rows = schedules.map((schedule) => {
      const snapshot = schedule.packageSnapshot as ScheduleSnapshot | null;
      const packageName = schedule.packageName ?? snapshot?.name ?? 'Deleted package';
      const target =
        [schedule.siteName, schedule.linkName].filter(Boolean).join(' · ') || 'No client selected';
      const scheduledBy = schedule.scheduledBy ?? snapshot?.scheduledBy ?? schedule.createdByUserId;
      return {
        ...schedule,
        packageSnapshot: snapshot ?? { id: schedule.packageId, name: packageName, steps: [] },
        runtimeInputs: (schedule.runtimeInputs ?? {}) as Record<string, unknown>,
        packageName,
        target,
        scheduledBy,
        searchBlob: [
          packageName,
          schedule.status,
          schedule.scheduledLocalTime,
          schedule.timeZone,
          target,
          scheduledBy,
        ]
          .join(' ')
          .toLowerCase(),
      } as ScheduleTableRow;
    });
    scheduleSummary = {
      total: rows.length,
      scheduled: rows.filter((r) => r.status === 'scheduled').length,
      dispatched: rows.filter((r) => r.status === 'dispatched').length,
      canceled: rows.filter((r) => r.status === 'canceled').length,
    };
    const query = input.globalSearch.trim().toLowerCase();
    let filtered = query ? rows.filter((row) => row.searchBlob.includes(query)) : rows;
    for (const filter of input.filters) {
      filtered = filtered.filter((row) => {
        const value = row[filter.field];
        if (filter.operator === 'eq') return value === filter.value;
        if (filter.operator === 'neq') return value !== filter.value;
        if (filter.operator === 'contains')
          return String(value ?? '')
            .toLowerCase()
            .includes(String(filter.value ?? '').toLowerCase());
        if (filter.operator === 'gt') return Number(value) > Number(filter.value);
        if (filter.operator === 'gte') return Number(value) >= Number(filter.value);
        if (filter.operator === 'lt') return Number(value) < Number(filter.value);
        if (filter.operator === 'lte') return Number(value) <= Number(filter.value);
        if (filter.operator === 'is_null')
          return value === null || value === undefined || value === '';
        if (filter.operator === 'is_not_null')
          return !(value === null || value === undefined || value === '');
        return true;
      });
    }
    const sorted = input.sortField
      ? [...filtered].sort((a, b) => {
          const comparison = compareValues(a[input.sortField!], b[input.sortField!]);
          return input.sortDir === 'asc' ? comparison : -comparison;
        })
      : filtered;
    const start = input.page * input.pageSize;
    return { rows: sorted.slice(start, start + input.pageSize), total: sorted.length };
  }
</script>

{#snippet scheduleActions({ row }: { row: ScheduleTableRow })}
  <div class="flex justify-end" onclick={(event) => event.stopPropagation()} role="none">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            aria-label="Schedule actions"
            class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal class="size-4" />
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-44">
        {#if row.status === 'scheduled' && canRun}
          <DropdownMenu.Item class="gap-2" onclick={() => (reviewSchedule = row)}>
            <Pencil class="size-3.5" /> Review schedule
          </DropdownMenu.Item>
          <DropdownMenu.Item class="gap-2" onclick={() => cancel.mutate(row.id)}>
            <X class="size-3.5" /> Cancel
          </DropdownMenu.Item>
        {/if}
        {#if row.packageRunId}
          <DropdownMenu.Item
            class="gap-2"
            onclick={() => goto(`/automation/runs/${row.packageRunId}`)}
          >
            <ArrowUpRight class="size-3.5" /> View run
          </DropdownMenu.Item>
        {/if}
        {#if canRun && (row.status === 'scheduled' || row.status === 'canceled')}
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            class="gap-2 text-destructive focus:text-destructive"
            onclick={() => (deleteTarget = row)}
          >
            <Trash2 class="size-3.5" /> Delete
          </DropdownMenu.Item>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
{/snippet}

{#snippet scheduleIdentity({ row }: { row: ScheduleTableRow })}<div class="au-identity">
    <span class="au-identity-icon"><CalendarClock size={17} /></span>
    <div>
      <span class="au-cell-title">{row.packageName}</span>
      <p>Saved version {row.packageVersion}</p>
    </div>
  </div>{/snippet}
{#snippet scheduleTime({ row }: { row: ScheduleTableRow })}<span class="au-cell-title"
    >{localDate(row.scheduledLocalTime)}</span
  ><span class="au-cell-detail">{row.timeZone.replace(/_/g, ' ')}</span>{/snippet}
{#snippet scheduleSignals(api: SignalStripApi)}<div class="au-signal-strip">
    <button
      type="button"
      aria-pressed={!api.activeViewId}
      onclick={() => {
        api.clearFilters();
        api.setView();
      }}><strong>{scheduleSummary?.total ?? '—'}</strong>All</button
    >{#each [{ label: 'Scheduled', value: 'scheduled', count: scheduleSummary?.scheduled, tone: 'au-info' }, { label: 'Started', value: 'dispatched', count: scheduleSummary?.dispatched, tone: 'au-success' }, { label: 'Canceled', value: 'canceled', count: scheduleSummary?.canceled, tone: '' }] as item}<button
        type="button"
        class={item.tone}
        aria-pressed={api.activeViewId ===
          (item.value === 'scheduled'
            ? 'upcoming'
            : item.value === 'dispatched'
              ? 'started'
              : 'canceled')}
        onclick={() => {
          api.clearFilters();
          api.setView(
            item.value === 'scheduled'
              ? 'upcoming'
              : item.value === 'dispatched'
                ? 'started'
                : 'canceled'
          );
        }}><strong>{item.count ?? '—'}</strong>{item.label}</button
      >{/each}<span>Latest {scheduleSummary?.total ?? '—'} schedules</span>
  </div>{/snippet}
<div class="au-page">
  <header class="au-heading">
    <div>
      <p class="au-eyebrow">Automation / Plan</p>
      <h1>Schedules</h1>
      <p>Set up the work now. Run it at the right time for your client.</p>
    </div>
    {#if canRun}<Button class="gap-2" onclick={() => (newScheduleOpen = true)}
        ><Plus size={15} /> Schedule a package</Button
      >{/if}
  </header>
  <details class="au-guide">
    <summary>How scheduled runs work</summary>
    <p>
      Each schedule keeps its saved package version and answers. Review the client and time zone
      before it starts. Editing the package does not update an existing schedule.
    </p>
  </details>
  <div class="au-table">
    <DataTable
      {views}
      enableViewSelector={false}
      signalStrip={scheduleSignals}
      {columns}
      {fetchData}
      {refreshKey}
      enableRowSelection={false}
      enableGlobalSearch
      enableFilters
      enableExport={false}
      enableURLState={false}
      defaultPageSize={25}
      defaultSort={{ field: 'scheduledLocalTime', dir: 'asc' }}
      onrowclick={(row) => {
        if (row.status === 'scheduled' && canRun) reviewSchedule = row;
        else if (row.packageRunId) goto(`/automation/runs/${row.packageRunId}`);
      }}
    />
  </div>
</div>

{#if canRun}<RunPackageDialog
    bind:open={newScheduleOpen}
    scheduleMode
    onOpenChange={(open) => (newScheduleOpen = open)}
    onScheduled={() => refreshKey++}
  />{/if}

<RunPackageDialog
  open={reviewSchedule !== null}
  onOpenChange={(open) => {
    if (!open) reviewSchedule = null;
  }}
  packageId={reviewSchedule?.packageId}
  linkId={reviewSchedule?.linkId}
  scheduleMode
  scheduleId={reviewSchedule?.id}
  scheduleSnapshot={reviewSchedule?.packageSnapshot}
  initialRuntimeInputs={reviewSchedule?.runtimeInputs}
  initialRunInputState={reviewSchedule?.packageSnapshot.runInputState}
  initialSchedule={reviewSchedule
    ? {
        siteId: reviewSchedule.siteId,
        linkId: reviewSchedule.linkId,
        scheduledLocalTime: reviewSchedule.scheduledLocalTime,
        timeZone: reviewSchedule.timeZone,
      }
    : undefined}
  onScheduled={() => {
    refreshKey++;
    void queryClient.invalidateQueries({ queryKey: ['packageRuns.schedules'] });
  }}
  onRequestDeleteSchedule={() => {
    if (reviewSchedule) {
      deleteTarget = reviewSchedule as ScheduleTableRow;
      reviewSchedule = null;
    }
  }}
/>

<AlertDialog.Root
  open={deleteTarget !== null}
  onOpenChange={(open) => {
    if (!open) deleteTarget = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{deleteTarget?.packageName ?? ''}” schedule?</AlertDialog.Title>
      <AlertDialog.Description>
        This permanently removes the scheduled launch and its saved answers.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
        disabled={deleteSchedule.isPending}
        onclick={() => {
          if (deleteTarget) deleteSchedule.mutate(deleteTarget.id);
        }}
      >
        {deleteSchedule.isPending ? 'Deleting…' : 'Delete schedule'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
