<script lang="ts">
  import { cn } from '$lib/utils';
  import { AlertSeverity } from '@mspbyte/shared';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';

  export type GlobalOverviewRow = {
    linkId: string;
    siteId?: string | null;
    siteName: string;
    linkName?: string | null;
    externalId?: string | null;
    disposition?: unknown;
    dispositioned?: boolean;
    note?: unknown;
    alertCount: number;
    highestSeverity?: number | null;
    [key: string]: unknown;
  };

  export type GlobalOverviewExtraColumn = {
    key: string;
    label: string;
    widthClass?: string;
    align?: 'left' | 'center';
    searchable?: boolean;
    value?: (row: GlobalOverviewRow) => unknown;
    format?: (value: unknown, row: GlobalOverviewRow) => string;
    emptyWhenZero?: boolean;
    badgeClass?: (value: unknown, row: GlobalOverviewRow) => string;
  };

  type SortColumn = string;

  let {
    rows,
    isLoading,
    isPending,
    vendorName,
    totalLabel,
    nameColumnLabel = 'Site',
    searchPlaceholder,
    emptyEntityLabel = 'sites',
    extraColumns = [],
    showAlertSummary = true,
    showIndicatorColumn = true,
    showDispositionColumn = true,
    showNotesColumn = true,
    showAlertsColumn = true,
    showStatusColumn = true,
    onrowclick,
  }: {
    rows: GlobalOverviewRow[];
    isLoading: boolean;
    isPending: boolean;
    vendorName: string;
    totalLabel?: string;
    nameColumnLabel?: string;
    searchPlaceholder?: string;
    emptyEntityLabel?: string;
    extraColumns?: GlobalOverviewExtraColumn[];
    showAlertSummary?: boolean;
    showIndicatorColumn?: boolean;
    showDispositionColumn?: boolean;
    showNotesColumn?: boolean;
    showAlertsColumn?: boolean;
    showStatusColumn?: boolean;
    onrowclick: (row: GlobalOverviewRow) => void;
  } = $props();

  let searchQuery = $state('');
  let sortColumn = $state<SortColumn>('siteName');
  let sortDirection = $state<'asc' | 'desc'>('asc');

  const filteredRows = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    const visibleRows = q
      ? rows.filter((row) =>
          searchValues(row).some((value) => String(value).toLowerCase().includes(q))
        )
      : rows;

    return [...visibleRows].sort(compareRows);
  });

  const criticalCount = $derived(
    filteredRows.filter((row) => (row.highestSeverity ?? -1) >= AlertSeverity.High).length
  );

  const warningCount = $derived(
    filteredRows.filter((row) => {
      return (
        (row.highestSeverity ?? -1) >= AlertSeverity.Low &&
        (row.highestSeverity ?? -1) < AlertSeverity.High
      );
    }).length
  );

  const healthyCount = $derived(filteredRows.filter((row) => row.alertCount === 0).length);

  function searchValues(row: GlobalOverviewRow) {
    return [
      row.siteName,
      row.linkName,
      row.externalId,
      dispositionLabel(row.disposition),
      row.note,
      ...extraColumns
        .filter((column) => column.searchable ?? true)
        .map((column) => column.value?.(row) ?? row[column.key]),
    ].filter(Boolean);
  }

  function dispositionLabel(disposition: unknown) {
    if (disposition === 'third_party') return 'Third Party';
    if (disposition === 'not_managed') return 'Not Managed';
    if (disposition === 'managed') return 'Managed';
    return null;
  }

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }

    sortColumn = column;
    sortDirection = 'asc';
  }

  function sortValue(row: GlobalOverviewRow, column: SortColumn) {
    if (column === 'disposition') return dispositionLabel(row.disposition) ?? '';
    if (column === 'highestSeverity') return row.highestSeverity ?? -1;
    return row[column] ?? '';
  }

  function compareRows(a: GlobalOverviewRow, b: GlobalOverviewRow) {
    if (a.dispositioned !== b.dispositioned) return a.dispositioned ? 1 : -1;

    const av = sortValue(a, sortColumn);
    const bv = sortValue(b, sortColumn);
    const dir = sortDirection === 'desc' ? -1 : 1;
    const result =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });

    if (result !== 0) return result * dir;
    return a.siteName.localeCompare(b.siteName, undefined, { numeric: true, sensitivity: 'base' });
  }

  function statusBadge(highestSeverity: number | null | undefined) {
    if (highestSeverity === AlertSeverity.Critical)
      return { label: 'Critical', class: 'bg-destructive/15 text-destructive' };
    if (highestSeverity === AlertSeverity.High)
      return { label: 'High', class: 'bg-destructive/10 text-destructive/80' };
    if (highestSeverity === AlertSeverity.Medium)
      return { label: 'Medium', class: 'bg-warning/20 text-warning' };
    if (highestSeverity === AlertSeverity.Low)
      return { label: 'Low', class: 'bg-muted text-muted-foreground' };
    return { label: 'Healthy', class: 'bg-success/15 text-success' };
  }

  function statusDot(highestSeverity: number | null | undefined) {
    if (highestSeverity === AlertSeverity.Critical) return 'bg-destructive';
    if (highestSeverity === AlertSeverity.High) return 'bg-destructive/80';
    if (highestSeverity === AlertSeverity.Medium) return 'bg-warning';
    if (highestSeverity === AlertSeverity.Low) return 'bg-muted-foreground/40';
    return 'bg-success';
  }

  function columnValue(column: GlobalOverviewExtraColumn, row: GlobalOverviewRow) {
    return column.value?.(row) ?? row[column.key];
  }

  function hasColumnValue(column: GlobalOverviewExtraColumn, value: unknown) {
    if (value === null || value === undefined || value === '') return false;
    if (column.emptyWhenZero && Number(value) === 0) return false;
    return true;
  }

  function formatColumnValue(
    column: GlobalOverviewExtraColumn,
    value: unknown,
    row: GlobalOverviewRow
  ) {
    return column.format?.(value, row) ?? String(value);
  }
</script>

{#snippet sortIndicator(column: SortColumn)}
  {#if sortColumn === column}
    {#if sortDirection === 'asc'}
      <ArrowUpIcon class="size-3.5" />
    {:else}
      <ArrowDownIcon class="size-3.5" />
    {/if}
  {:else}
    <ChevronsUpDownIcon class="size-3.5 opacity-40" />
  {/if}
{/snippet}

<FadeIn class="flex flex-col size-full overflow-hidden">
  <div
    class={cn('grid gap-3 p-4 border-b shrink-0', showAlertSummary ? 'grid-cols-4' : 'grid-cols-2')}
  >
    <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
      <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {totalLabel ?? `Total ${nameColumnLabel}s`}
      </div>
      <div class="text-3xl font-bold tabular-nums">
        {isPending ? '—' : filteredRows.length}
      </div>
    </div>
    {#if showAlertSummary}
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          High/Critical
        </div>
        <div class="text-3xl font-bold tabular-nums text-destructive">
          {isPending ? '—' : criticalCount}
        </div>
        <div class="text-xs text-muted-foreground">highest alert severity</div>
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Low/Medium
        </div>
        <div class="text-3xl font-bold tabular-nums text-warning">
          {isPending ? '—' : warningCount}
        </div>
        <div class="text-xs text-muted-foreground">highest alert severity</div>
      </div>
      <div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Healthy
        </div>
        <div class="text-3xl font-bold tabular-nums text-success">
          {isPending ? '—' : healthyCount}
        </div>
        <div class="text-xs text-muted-foreground">no open alerts</div>
      </div>
    {/if}
  </div>

  <div class="flex-1 overflow-auto p-4 flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <input
        type="text"
        placeholder={searchPlaceholder ?? `Search ${emptyEntityLabel}...`}
        bind:value={searchQuery}
        class="h-8 w-64 rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
    {#if isLoading}
      <Loader />
    {:else if filteredRows.length === 0}
      <FadeIn class="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
        {#if rows.length === 0}
          <div class="text-sm">No {vendorName} {emptyEntityLabel} connected.</div>
          <a href="/setup/integrations" class="text-xs text-primary hover:underline">
            Configure integration →
          </a>
        {:else}
          <div class="text-sm">No {emptyEntityLabel} match your search.</div>
        {/if}
      </FadeIn>
    {:else}
      <FadeIn class="flex size-full overflow-auto">
        <table class="h-fit w-full text-sm">
          <thead>
            <tr class="border-b text-xs text-muted-foreground uppercase tracking-wide">
              {#if showIndicatorColumn}
                <th class="px-4 py-2 text-left w-8"></th>
              {/if}
              <th class="px-4 py-2 text-left">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 hover:text-foreground"
                  onclick={() => toggleSort('siteName')}
                >
                  {nameColumnLabel}
                  {@render sortIndicator('siteName')}
                </button>
              </th>
              {#each extraColumns as column (column.key)}
                <th
                  class={cn(
                    'px-4 py-2',
                    column.align === 'left' ? 'text-left' : 'text-center',
                    column.widthClass
                  )}
                >
                  <button
                    type="button"
                    class={cn(
                      'inline-flex items-center gap-1.5 hover:text-foreground',
                      column.align === 'left' ? '' : 'justify-center'
                    )}
                    onclick={() => toggleSort(column.key)}
                  >
                    {column.label}
                    {@render sortIndicator(column.key)}
                  </button>
                </th>
              {/each}
              {#if showDispositionColumn}
                <th class="px-4 py-2 text-center w-32">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-1.5 hover:text-foreground"
                    onclick={() => toggleSort('disposition')}
                  >
                    Disposition
                    {@render sortIndicator('disposition')}
                  </button>
                </th>
              {/if}
              {#if showNotesColumn}
                <th class="px-4 py-2 text-left">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 hover:text-foreground"
                    onclick={() => toggleSort('note')}
                  >
                    Notes
                    {@render sortIndicator('note')}
                  </button>
                </th>
              {/if}
              {#if showAlertsColumn}
                <th class="px-4 py-2 text-center w-24">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-1.5 hover:text-foreground"
                    onclick={() => toggleSort('alertCount')}
                  >
                    Alerts
                    {@render sortIndicator('alertCount')}
                  </button>
                </th>
              {/if}
              {#if showStatusColumn}
                <th class="px-4 py-2 text-center w-28">
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-1.5 hover:text-foreground"
                    onclick={() => toggleSort('highestSeverity')}
                  >
                    Status
                    {@render sortIndicator('highestSeverity')}
                  </button>
                </th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each filteredRows as row (row.linkId)}
              {@const status = statusBadge(row.highestSeverity)}
              {@const disposition = dispositionLabel(row.disposition)}
              <tr
                class="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                onclick={() => onrowclick(row)}
              >
                {#if showIndicatorColumn}
                  <td class="px-4 py-3">
                    <span
                      class={cn(
                        'inline-block w-2.5 h-2.5 rounded-full shrink-0',
                        statusDot(row.highestSeverity)
                      )}
                    ></span>
                  </td>
                {/if}
                <td class="px-4 py-3">
                  <span class="font-medium text-sm">{row.siteName}</span>
                </td>
                {#each extraColumns as column (column.key)}
                  {@const value = columnValue(column, row)}
                  <td
                    class={cn('px-4 py-3', column.align === 'left' ? 'text-left' : 'text-center')}
                  >
                    {#if hasColumnValue(column, value)}
                      {#if column.badgeClass}
                        <span
                          class={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                            column.badgeClass(value, row)
                          )}
                        >
                          {formatColumnValue(column, value, row)}
                        </span>
                      {:else}
                        <span class="text-xs text-muted-foreground">
                          {formatColumnValue(column, value, row)}
                        </span>
                      {/if}
                    {:else}
                      <span class="text-xs text-muted-foreground">-</span>
                    {/if}
                  </td>
                {/each}
                {#if showDispositionColumn}
                  <td class="px-4 py-3 text-center">
                    {#if disposition}
                      <span
                        class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warning/15 text-warning"
                      >
                        {disposition}
                      </span>
                    {:else}
                      <span class="text-xs text-muted-foreground">-</span>
                    {/if}
                  </td>
                {/if}
                {#if showNotesColumn}
                  <td class="px-4 py-3">
                    <span class="block max-w-72 truncate text-xs text-muted-foreground">
                      {row.note ? String(row.note) : '-'}
                    </span>
                  </td>
                {/if}
                {#if showAlertsColumn}
                  <td class="px-4 py-3 text-center">
                    {#if row.alertCount > 0}
                      <span
                        class="inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 rounded-full text-xs font-medium bg-destructive/15 text-destructive"
                      >
                        {row.alertCount}
                      </span>
                    {:else}
                      <span class="text-xs text-muted-foreground">-</span>
                    {/if}
                  </td>
                {/if}
                {#if showStatusColumn}
                  <td class="px-4 py-3 text-center">
                    <span
                      class={cn(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        status.class
                      )}
                    >
                      {status.label}
                    </span>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </FadeIn>
    {/if}
  </div>
</FadeIn>
