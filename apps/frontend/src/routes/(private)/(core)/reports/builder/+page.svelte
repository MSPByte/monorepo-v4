<script module lang="ts">
  function formatCell(value: unknown, emptyValue = '—'): string {
    if (value == null) return emptyValue;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return value.length === 0 ? emptyValue : value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import {
    ArrowLeft,
    ArrowDown,
    ArrowUp,
    ChevronLeft,
    ChevronRight,
    Database,
    Download,
    Filter,
    Link2,
    ListChecks,
    Loader2,
    Play,
    Plus,
    Save,
    Search,
    Table2,
    Trash2,
  } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { INTEGRATIONS, type FieldDefinition, type ProviderId, type SchemaFields } from '@mspbyte/shared';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import { OPERATOR_LABELS } from '$lib/components/data-table';
  import { showErrorToast } from '$lib/utils/errors';
  import ScopeBar from '../_components/scope-bar.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));
  const canDelete = $derived(authStore.isAllowed('Reports.Delete'));

  const reportId = $derived(page.url.searchParams.get('id') ?? '');
  const editing = $derived(Boolean(reportId));

  type JoinFieldMeta = {
    key: string;
    label: string;
    type: FieldDefinition['type'];
    modality: 'single' | 'array';
    fromTable: string | null;
    description?: string;
  };

  type SourceMeta = {
    table: string;
    label: string;
    providerId: string | null;
    shape: SchemaFields;
    joinFields?: JoinFieldMeta[];
    licenseRequirements?: Array<{ value: string; label: string; description: string }>;
  };

  /**
   * Unified view of a source's columns: native fields defined on the vendor
   * table plus joined fields hydrated from related tables. The picker renders
   * both from the same list so the user doesn't need to know the difference —
   * a "linked" badge marks joins.
   */
  type FieldEntry = {
    key: string;
    label: string;
    type: FieldDefinition['type'];
    modality: 'single' | 'array';
    origin: 'native' | 'join';
    filterable: boolean;
    fromTable: string | null;
    description?: string;
    options?: FieldDefinition['options'];
  };

  type FilterRow = {
    id: number;
    column: string;
    operator: string;
    value: string | string[];
  };

  type ResultRow = Record<string, unknown> & { id?: string };

  const OPERATORS_BY_TYPE: Record<FieldDefinition['type'], readonly string[]> = {
    string: ['eq', 'neq', 'contains', 'is_null', 'is_not_null'],
    enum: ['eq', 'neq', 'is_null', 'is_not_null'],
    boolean: ['eq', 'neq', 'is_null', 'is_not_null'],
    number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
    date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
    object: ['is_null', 'is_not_null'],
  };

  const REPORT_OPERATOR_LABELS: Record<string, string> = {
    ...OPERATOR_LABELS,
    has_requirement: 'Has coverage for',
    lacks_requirement: 'Is missing coverage for',
    has_any_of: 'Contains any of',
    lacks_any_of: 'Contains none of',
  };

  const FIELD_TYPE_LABELS: Record<FieldDefinition['type'], string> = {
    string: 'Text',
    enum: 'Choice',
    boolean: 'Yes / No',
    number: 'Number',
    date: 'Date',
    object: 'Object',
  };

  // -- state -----------------------------------------------------------------

  let filterUid = 1;
  let name = $state('');
  let description = $state('');
  let source = $state('');
  let selectedColumns = $state<string[]>([]);
  let filters = $state<FilterRow[]>([]);
  let sortColumn = $state<string>('');
  let sortDirection = $state<'asc' | 'desc'>('asc');
  let saving = $state(false);
  let hydrated = $state(false);
  let deleting = $state(false);
  let columnSearch = $state('');

  // Results
  let resultRows = $state<ResultRow[]>([]);
  let resultTotal = $state(0);
  let running = $state(false);
  let runError = $state<string | null>(null);
  let lastRunSignature = $state('');
  let resultPage = $state(1);
  let exporting = $state(false);

  // -- queries ---------------------------------------------------------------

  const sourcesQuery = createQuery(() => ({
    queryKey: ['reports.listSources'],
    queryFn: () => trpc.reports.listSources.query(),
    staleTime: 5 * 60_000,
  }));

  const existingQuery = createQuery(() => ({
    queryKey: ['reports.byId', reportId],
    queryFn: () => (reportId ? trpc.reports.byId.query({ id: reportId }) : Promise.resolve(null)),
  }));
  const licenseOptionsQuery = createQuery(() => ({
    queryKey: ['reports.listFilterValues', source],
    queryFn: () =>
      trpc.reports.listFilterValues.query({ source: 'm365Identities', column: 'assignedLicenses' }),
    enabled: source === 'm365Identities',
    staleTime: 5 * 60_000,
  }));

  // -- derived ---------------------------------------------------------------

  const sources = $derived<SourceMeta[]>((sourcesQuery.data as SourceMeta[]) ?? []);

  const sourceOptions = $derived(
    sources.map((s) => {
      const providerName = s.providerId
        ? (INTEGRATIONS[s.providerId as ProviderId]?.name ?? s.providerId)
        : 'Platform';
      const nativeCount = Object.keys(s.shape).length;
      const joinCount = s.joinFields?.length ?? 0;
      const total = nativeCount + joinCount;
      return {
        value: s.table,
        label: shortLabel(s.label, providerName),
        subLabel:
          joinCount > 0
            ? `${total} fields · ${joinCount} linked`
            : `${nativeCount} field${nativeCount === 1 ? '' : 's'}`,
        group: providerName,
      };
    })
  );

  function shortLabel(label: string, providerName: string) {
    // "Sophos Firewalls" grouped under "Sophos Partner" reads better as "Firewalls".
    const prefix = providerName.split(' ')[0];
    if (prefix && label.startsWith(prefix + ' ')) return label.slice(prefix.length + 1);
    return label;
  }

  const currentSource = $derived<SourceMeta | undefined>(sources.find((s) => s.table === source));
  const currentProviderName = $derived(
    currentSource?.providerId
      ? (INTEGRATIONS[currentSource.providerId as ProviderId]?.name ?? currentSource.providerId)
      : null
  );
  const shape = $derived<SchemaFields | undefined>(currentSource?.shape);

  const fieldEntries = $derived.by<FieldEntry[]>(() => {
    if (!currentSource) return [];
    const native: FieldEntry[] = Object.entries(currentSource.shape).map(([key, def]) => ({
      key,
      label: def.label,
      type: def.type,
      modality: def.modality,
      origin: 'native',
      filterable: def.trackable === true || def.filterable === true,
      fromTable: null,
      description: def.description,
      options: def.options,
    }));
    const joined: FieldEntry[] = (currentSource.joinFields ?? []).map((j) => ({
      key: j.key,
      label: j.label,
      type: j.type,
      modality: j.modality,
      origin: 'join',
      // v1: joined fields are display-only. Users filter on the underlying
      // native column (linkId, siteId, assignedLicenses, …).
      filterable: false,
      fromTable: j.fromTable,
      description: j.description,
    }));
    return [...native, ...joined];
  });

  const fieldByKey = $derived.by(() => {
    const map = new Map<string, FieldEntry>();
    for (const f of fieldEntries) map.set(f.key, f);
    return map;
  });

  const filterEntries = $derived(fieldEntries.filter((f) => f.filterable));
  const licenseOptions = $derived(licenseOptionsQuery.data ?? []);

  const availableEntries = $derived(
    fieldEntries.filter((f) => !selectedColumns.includes(f.key))
  );
  const filteredAvailable = $derived.by(() => {
    const q = columnSearch.trim().toLowerCase();
    if (!q) return availableEntries;
    return availableEntries.filter(
      (f) => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
    );
  });

  const sortColumnOptions = $derived(
    selectedColumns
      // Sorting joined columns would require SQL-level joins we don't emit;
      // v1 keeps joins display-only so we skip them here as well.
      .filter((k) => fieldByKey.get(k)?.origin === 'native' && shape?.[k]?.trackable !== false)
      .map((k) => ({
        value: k,
        label: fieldByKey.get(k)?.label ?? k,
      }))
  );

  // -- hydration -------------------------------------------------------------

  $effect(() => {
    if (hydrated) return;
    if (!existingQuery.data) {
      if (!editing) hydrated = true;
      return;
    }
    const row = existingQuery.data;
    name = row.name;
    description = row.description ?? '';
    source = row.source;
    const def = (row.definition ?? {}) as {
      columns?: string[];
      filters?: Array<{ column: string; operator: string; value?: unknown }>;
      sort?: { column: string; direction: 'asc' | 'desc' };
    };
    selectedColumns = def.columns ?? [];
    filters = (def.filters ?? []).map((f) => ({
      id: filterUid++,
      column: f.column,
      operator: f.operator,
      value: f.value == null ? '' : Array.isArray(f.value) ? f.value : String(f.value),
    }));
    sortColumn = def.sort?.column ?? '';
    sortDirection = def.sort?.direction ?? 'asc';
    hydrated = true;
  });

  // Reset selection when source changes to something else after hydration.
  let priorSource = $state('');
  $effect(() => {
    if (!hydrated) return;
    if (source === priorSource) return;
    if (priorSource !== '') {
      selectedColumns = [];
      filters = [];
      sortColumn = '';
      columnSearch = '';
    }
    priorSource = source;
  });

  // -- live run --------------------------------------------------------------

  const definitionSignature = $derived(
    JSON.stringify({
      source,
      columns: selectedColumns,
      filters: filters
        .filter((f) => validFilter(f))
        .map((f) => ({ column: f.column, operator: f.operator, value: coerceValue(f) })),
      sort: sortColumn ? { column: sortColumn, direction: sortDirection } : undefined,
    })
  );

  const pageCount = $derived(Math.max(1, Math.ceil(resultTotal / 50)));
  const canPreviousPage = $derived(resultPage > 1 && !running);
  const canNextPage = $derived(resultPage < pageCount && !running);

  function reportDefinition() {
    return {
      columns: selectedColumns,
      filters: filters.filter(validFilter).map((f) => ({
        column: f.column,
        operator: f.operator as
          | 'eq'
          | 'neq'
          | 'contains'
          | 'gt'
          | 'gte'
          | 'lt'
          | 'lte'
          | 'is_null'
          | 'is_not_null'
          | 'has_requirement'
          | 'lacks_requirement'
          | 'has_any_of'
          | 'lacks_any_of',
        value: coerceValue(f),
      })),
      sort: sortColumn ? { column: sortColumn, direction: sortDirection } : undefined,
    };
  }

  function operatorsFor(column: string, type: FieldDefinition['type']): readonly string[] {
    const base = OPERATORS_BY_TYPE[type];
    if (column === 'hasLicenses') return ['eq', 'neq'];
    return column === 'assignedLicenses' && licenseOptions.length
      ? [...base, 'has_any_of', 'lacks_any_of']
      : base;
  }

  function isRequirementOperator(operator: string) {
    return operator === 'has_requirement' || operator === 'lacks_requirement';
  }

  function isLicenseSetOperator(operator: string) {
    return operator === 'has_any_of' || operator === 'lacks_any_of';
  }

  function validFilter(f: FilterRow): boolean {
    if (!f.column || !f.operator) return false;
    if (f.operator === 'is_null' || f.operator === 'is_not_null') return true;
    return Array.isArray(f.value) ? f.value.length > 0 : f.value !== '';
  }

  function coerceValue(f: FilterRow): string | string[] | number | boolean | undefined {
    if (f.operator === 'is_null' || f.operator === 'is_not_null') return undefined;
    const field = shape?.[f.column];
    if (field?.type === 'boolean') return f.value === 'true';
    if (field?.type === 'number') {
      const n = Number(f.value);
      return Number.isFinite(n) ? n : undefined;
    }
    return f.value;
  }

  let runTimer: ReturnType<typeof setTimeout> | null = null;
  onMount(() => {
    const refreshForScope = () => {
      resultPage = 1;
      lastRunSignature = '';
      void runReport(1);
    };
    window.addEventListener('reports:scope-changed', refreshForScope);
    return () => window.removeEventListener('reports:scope-changed', refreshForScope);
  });

  $effect(() => {
    // Track the signature so effect re-fires on any composition change.
    const sig = definitionSignature;
    if (!source || selectedColumns.length === 0) {
      resultRows = [];
      resultTotal = 0;
      runError = null;
      lastRunSignature = '';
      return;
    }
    if (sig === lastRunSignature) return;
    resultPage = 1;
    if (runTimer) clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      lastRunSignature = sig;
      void runReport();
    }, 350);
  });

  async function runReport(pageToLoad = resultPage) {
    if (!source || selectedColumns.length === 0) return;
    running = true;
    runError = null;
    try {
      const result = await trpc.reports.run.mutate({
        source,
        definition: reportDefinition(),
        table: { page: pageToLoad, pageSize: 50, filters: [] },
      });
      resultRows = result.rows as ResultRow[];
      resultTotal = result.total;
    } catch (err) {
      runError = err instanceof Error ? err.message : 'Report failed to run. Check the definition.';
      resultRows = [];
      resultTotal = 0;
    } finally {
      running = false;
    }
  }

  async function changePage(nextPage: number) {
    if (nextPage < 1 || nextPage > pageCount || running) return;
    resultPage = nextPage;
    await runReport(nextPage);
  }

  function csvValue(value: unknown): string {
    // Keep absent values truly empty in exports; the em dash is only a preview placeholder.
    const text = formatCell(value, '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  async function exportCsv() {
    if (!source || selectedColumns.length === 0) return;
    exporting = true;
    try {
      const result = await trpc.reports.runBulk.mutate({
        source,
        definition: reportDefinition(),
        table: { page: 1, pageSize: 1000, filters: [] },
      });
      const rows = result.rows as ResultRow[];
      const headers = selectedColumns.map((key) => csvValue(fieldByKey.get(key)?.label ?? key));
      const lines = rows.map((row) => selectedColumns.map((key) => csvValue(row[key])).join(','));
      // The UTF-8 BOM lets desktop Excel identify Unicode CSVs correctly.
      const blob = new Blob([`﻿${[headers.join(','), ...lines].join('\r\n')}`], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(name.trim() || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      if (result.truncated) {
        toast.warning(
          `Export capped at ${rows.length.toLocaleString()} rows of ${result.total.toLocaleString()}. Narrow the report to see the rest.`
        );
      } else {
        toast.success(`Exported ${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'}`);
      }
    } catch (err) {
      showErrorToast(err, 'Failed to export CSV');
    } finally {
      exporting = false;
    }
  }

  // -- filters ---------------------------------------------------------------

  function addFilter() {
    const first = filterEntries[0];
    if (!first) return;
    filters = [
      ...filters,
      {
        id: filterUid++,
        column: first.key,
        operator: operatorsFor(first.key, first.type)[0],
        value: '',
      },
    ];
  }

  function removeFilter(id: number) {
    filters = filters.filter((f) => f.id !== id);
  }

  function updateFilterColumn(id: number, column: string) {
    const def = shape?.[column];
    if (!def) return;
    filters = filters.map((f) =>
      f.id === id ? { ...f, column, operator: operatorsFor(column, def.type)[0], value: '' } : f
    );
  }

  function updateFilterValue(id: number, value: string | string[]) {
    filters = filters.map((filter) => (filter.id === id ? { ...filter, value } : filter));
  }

  function updateFilterOperator(id: number, operator: string) {
    filters = filters.map((filter) =>
      filter.id === id ? { ...filter, operator, value: '' } : filter
    );
  }

  // -- columns ---------------------------------------------------------------

  function toggleColumn(key: string) {
    if (selectedColumns.includes(key)) {
      selectedColumns = selectedColumns.filter((c) => c !== key);
      if (sortColumn === key) sortColumn = '';
    } else {
      selectedColumns = [...selectedColumns, key];
    }
  }

  function moveColumn(key: string, direction: -1 | 1) {
    const index = selectedColumns.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= selectedColumns.length) return;
    const next = [...selectedColumns];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    selectedColumns = next;
  }

  function selectAllColumns() {
    selectedColumns = fieldEntries.map((f) => f.key);
  }

  function clearColumns() {
    selectedColumns = [];
    sortColumn = '';
  }

  // -- save / delete ---------------------------------------------------------

  async function save() {
    if (!canWrite) return;
    if (!name.trim()) {
      toast.error('Give the report a name.');
      return;
    }
    if (!source) {
      toast.error('Pick a data source.');
      return;
    }
    if (selectedColumns.length === 0) {
      toast.error('Pick at least one column.');
      return;
    }
    saving = true;
    try {
      const saved = await trpc.reports.save.mutate({
        id: reportId || undefined,
        name: name.trim(),
        description: description.trim() || null,
        source,
        definition: reportDefinition(),
      });
      toast.success(editing ? 'Report saved' : 'Report created');
      await queryClient.invalidateQueries({ queryKey: ['reports.list'] });
      if (!editing && saved?.id) {
        await goto(`/reports/${saved.id}`);
      }
    } catch (err) {
      showErrorToast(err, 'Failed to save report');
    } finally {
      saving = false;
    }
  }

  async function del() {
    if (!editing) return;
    deleting = true;
    try {
      await trpc.reports.delete.mutate({ id: reportId });
      toast.success('Report deleted');
      await queryClient.invalidateQueries({ queryKey: ['reports.list'] });
      await goto('/reports');
    } catch (err) {
      showErrorToast(err, 'Failed to delete report');
      deleting = false;
    }
  }
</script>

<div class="flex size-full flex-col overflow-hidden bg-muted/[0.02]">
  <!-- Header -->
  <div class="flex items-center justify-between gap-3 border-b bg-background px-6 py-3">
    <div class="flex min-w-0 items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5"
        onclick={() => goto(editing ? `/reports/${reportId}` : '/reports')}
      >
        <ArrowLeft class="size-4" />
        <span class="hidden sm:inline">{editing ? 'Back to report' : 'Reports'}</span>
      </Button>
      <span class="text-muted-foreground/50">/</span>
      <span class="text-sm font-medium truncate">
        {editing ? name || 'Untitled report' : 'New report'}
      </span>
      {#if editing}
        <Badge variant="secondary" class="ml-1 h-5 px-1.5 text-[10px] uppercase tracking-wider">
          Editing
        </Badge>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <ScopeBar />
      {#if editing && canDelete}
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5 text-destructive hover:text-destructive"
          disabled={deleting}
          onclick={del}
        >
          <Trash2 class="size-4" />
          <span class="hidden md:inline">Delete</span>
        </Button>
      {/if}
      {#if canWrite}
        <Button size="sm" class="gap-1.5" disabled={saving} onclick={save}>
          {#if saving}
            <Loader2 class="size-4 animate-spin" />
          {:else}
            <Save class="size-4" />
          {/if}
          {editing ? 'Save changes' : 'Create report'}
        </Button>
      {/if}
    </div>
  </div>

  <!-- Two-pane composer -->
  <div class="flex min-h-0 flex-1">
    <!-- Left: composition -->
    <aside
      class="flex w-[460px] shrink-0 flex-col overflow-y-auto border-r bg-background"
    >
      <!-- Identity block -->
      <div class="space-y-3 border-b px-5 pb-5 pt-5">
        <input
          class="w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 focus-visible:outline-none"
          bind:value={name}
          placeholder="Untitled report"
          aria-label="Report name"
        />
        <Textarea
          class="min-h-[52px] resize-none border-none bg-muted/30 px-3 py-2 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
          bind:value={description}
          placeholder="Describe what this report answers so teammates know when to reach for it."
          rows={2}
        />
      </div>

      <!-- Step 1 · Source -->
      <section class="space-y-3 border-b px-5 py-5">
        <div class="flex items-center gap-2.5">
          <div class="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            1
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <Database class="size-3.5 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Data source</h3>
            </div>
            <p class="text-muted-foreground text-[11px]">
              The vendor table the report draws rows from.
            </p>
          </div>
        </div>
        <SingleSelect
          options={sourceOptions}
          bind:selected={source}
          placeholder={sourcesQuery.isLoading ? 'Loading sources…' : 'Pick a source'}
          searchPlaceholder="Search sources…"
        />
        {#if currentSource}
          <div class="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Table2 class="size-3.5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium">{currentSource.label}</div>
              <div class="text-muted-foreground truncate text-[11px]">
                {currentProviderName ?? 'Platform'} · {fieldEntries.length} fields available
                {#if (currentSource.joinFields?.length ?? 0) > 0}
                  <span class="text-primary/80">({currentSource.joinFields!.length} linked)</span>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </section>

      <!-- Step 2 · Columns -->
      <section class="space-y-3 border-b px-5 py-5">
        <div class="flex items-center gap-2.5">
          <div class="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            2
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <ListChecks class="size-3.5 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Columns</h3>
              <span class="text-muted-foreground text-[11px] tabular-nums">
                {selectedColumns.length}/{fieldEntries.length}
              </span>
            </div>
            <p class="text-muted-foreground text-[11px]">
              The order set here is used for both preview and export.
            </p>
          </div>
        </div>

        {#if !shape}
          <div class="rounded-md border border-dashed bg-muted/10 px-3 py-4 text-center">
            <p class="text-muted-foreground text-xs">Pick a data source to choose columns.</p>
          </div>
        {:else}
          {#if selectedColumns.length > 0}
            <div class="overflow-hidden rounded-lg border">
              <div class="flex items-center justify-between bg-muted/30 px-3 py-1.5">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Selected · in report order
                </span>
                <button
                  type="button"
                  class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  onclick={clearColumns}
                >
                  Clear
                </button>
              </div>
              <ul class="divide-y">
                {#each selectedColumns as key, index (key)}
                  {@const entry = fieldByKey.get(key)}
                  <li class="group flex items-center gap-2 px-2 py-1.5 hover:bg-muted/20">
                    <span
                      class="text-muted-foreground/70 w-5 text-center text-[11px] font-medium tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="truncate text-sm font-medium leading-tight">
                          {entry?.label ?? key}
                        </span>
                        {#if entry?.origin === 'join'}
                          <span
                            class="inline-flex items-center gap-0.5 rounded-sm bg-primary/10 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-primary"
                            title={entry.fromTable ? `Linked from ${entry.fromTable}` : 'Linked field'}
                          >
                            <Link2 class="size-2.5" />
                            Linked
                          </span>
                        {/if}
                      </div>
                      {#if entry}
                        <div class="text-muted-foreground text-[10px] uppercase tracking-wide">
                          {FIELD_TYPE_LABELS[entry.type]}{entry.modality === 'array' ? ' · list' : ''}
                        </div>
                      {/if}
                    </div>
                    <div class="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="size-6"
                        disabled={index === 0}
                        onclick={() => moveColumn(key, -1)}
                        aria-label={`Move ${entry?.label ?? key} up`}
                      >
                        <ArrowUp class="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="size-6"
                        disabled={index === selectedColumns.length - 1}
                        onclick={() => moveColumn(key, 1)}
                        aria-label={`Move ${entry?.label ?? key} down`}
                      >
                        <ArrowDown class="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="size-6 text-muted-foreground hover:text-destructive"
                        onclick={() => toggleColumn(key)}
                        aria-label={`Remove ${entry?.label ?? key}`}
                      >
                        <Trash2 class="size-3.5" />
                      </Button>
                    </div>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if availableEntries.length > 0}
            <div class="overflow-hidden rounded-lg border">
              <div class="flex items-center gap-2 border-b bg-muted/30 px-2 py-1">
                <Search class="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  class="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="Search available fields…"
                  bind:value={columnSearch}
                  aria-label="Search available columns"
                />
                <button
                  type="button"
                  class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  onclick={selectAllColumns}
                >
                  Add all
                </button>
              </div>
              <ul class="max-h-56 divide-y overflow-y-auto">
                {#if filteredAvailable.length === 0}
                  <li class="text-muted-foreground px-3 py-4 text-center text-xs">
                    No matching fields.
                  </li>
                {:else}
                  {#each filteredAvailable as entry (entry.key)}
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40"
                        onclick={() => toggleColumn(entry.key)}
                        title={entry.description ?? ''}
                      >
                        {#if entry.origin === 'join'}
                          <Link2 class="size-3.5 shrink-0 text-primary/70" />
                        {:else}
                          <Plus class="size-3.5 shrink-0 text-muted-foreground" />
                        {/if}
                        <span class="flex-1 truncate text-sm">{entry.label}</span>
                        {#if entry.origin === 'join'}
                          <span
                            class="rounded-sm bg-primary/10 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-primary"
                          >
                            Linked
                          </span>
                        {/if}
                        <span
                          class="text-muted-foreground font-mono text-[10px] uppercase tracking-wider"
                        >
                          {FIELD_TYPE_LABELS[entry.type]}
                        </span>
                      </button>
                    </li>
                  {/each}
                {/if}
              </ul>
            </div>
          {:else if selectedColumns.length > 0}
            <p class="text-muted-foreground text-center text-[11px]">
              All fields are in the report.
            </p>
          {/if}
        {/if}
      </section>

      <!-- Step 3 · Filters -->
      <section class="space-y-3 border-b px-5 py-5">
        <div class="flex items-center gap-2.5">
          <div class="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            3
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <Filter class="size-3.5 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Filters</h3>
              {#if filters.length > 0}
                <span class="text-muted-foreground text-[11px] tabular-nums">
                  {filters.length}
                </span>
              {/if}
            </div>
            <p class="text-muted-foreground text-[11px]">
              Each row narrows the result set. Every condition must match.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            disabled={!shape}
            onclick={addFilter}
          >
            <Plus class="size-3" />
            Filter
          </Button>
        </div>

        {#if filters.length === 0}
          <div class="rounded-md border border-dashed bg-muted/10 px-3 py-4 text-center">
            <p class="text-muted-foreground text-xs">No filters — all rows are returned.</p>
          </div>
        {:else}
          <div class="space-y-2">
            {#each filters as f (f.id)}
              {@const def = shape?.[f.column]}
              {@const ops = def ? operatorsFor(f.column, def.type) : []}
              {@const needsValue = f.operator !== 'is_null' && f.operator !== 'is_not_null'}
              <div class="space-y-2 rounded-lg border bg-muted/10 p-2.5">
                <div class="flex min-w-0 items-center gap-1.5">
                  <SingleSelect
                    class="h-8 min-w-0 flex-1 text-xs"
                    options={filterEntries.map((field) => ({
                      value: field.key,
                      label: field.label,
                    }))}
                    selected={f.column}
                    onchange={(value) => updateFilterColumn(f.id, value)}
                    placeholder="Field"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onclick={() => removeFilter(f.id)}
                    aria-label="Remove filter"
                  >
                    <Trash2 class="size-3.5" />
                  </Button>
                </div>
                <div class="grid min-w-0 grid-cols-[9rem_minmax(0,1fr)] gap-1.5">
                  <SingleSelect
                    class="h-8 w-full text-xs"
                    options={ops.map((op) => ({
                      value: op,
                      label: REPORT_OPERATOR_LABELS[op] ?? op,
                    }))}
                    selected={f.operator}
                    onchange={(value) => updateFilterOperator(f.id, value)}
                    placeholder="Operator"
                  />
                  {#if needsValue}
                    {#if isLicenseSetOperator(f.operator)}
                      <MultiSelect
                        options={licenseOptions}
                        selected={Array.isArray(f.value) ? f.value : []}
                        onchange={(values) => updateFilterValue(f.id, values)}
                        placeholder="Choose acceptable licenses…"
                        searchPlaceholder="Search licenses…"
                        loading={licenseOptionsQuery.isLoading}
                      />
                    {:else if isRequirementOperator(f.operator)}
                      <p class="text-muted-foreground flex items-center px-1 text-xs">
                        Legacy coverage filter
                      </p>
                    {:else if def?.type === 'boolean'}
                      <SingleSelect
                        class="h-8 w-full text-xs"
                        options={[
                          { value: 'true', label: 'True' },
                          { value: 'false', label: 'False' },
                        ]}
                        selected={typeof f.value === 'string' ? f.value : ''}
                        onchange={(value) => updateFilterValue(f.id, value)}
                        placeholder="Choose value"
                      />
                    {:else if def?.type === 'enum' && def.options?.length}
                      <SingleSelect
                        class="h-8 w-full text-xs"
                        options={def.options.map((opt) => ({
                          value: String(opt.value),
                          label: opt.label,
                        }))}
                        selected={typeof f.value === 'string' ? f.value : ''}
                        onchange={(value) => updateFilterValue(f.id, value)}
                        placeholder="Choose value"
                      />
                    {:else}
                      <Input
                        class="h-8 w-full text-xs"
                        type={def?.type === 'number' ? 'number' : 'text'}
                        bind:value={f.value}
                        placeholder="value"
                      />
                    {/if}
                  {/if}
                </div>
                {#if isLicenseSetOperator(f.operator)}
                  <p class="text-muted-foreground px-0.5 text-[11px]">
                    Choose the SKUs your team considers acceptable. The identity matches if it has
                    any selected license.
                  </p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Sort -->
      <section class="space-y-3 px-5 py-5">
        <div class="flex items-center gap-2.5">
          <div class="flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
            4
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <ArrowDown class="size-3.5 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Sort</h3>
            </div>
            <p class="text-muted-foreground text-[11px]">
              Optional. Applied server-side before pagination.
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <div class="flex-1">
            <SingleSelect
              options={[{ value: '', label: 'None' }, ...sortColumnOptions]}
              bind:selected={sortColumn}
              placeholder="No sort"
            />
          </div>
          <ToggleGroup
            type="single"
            value={sortDirection}
            onValueChange={(v) => v && (sortDirection = v as 'asc' | 'desc')}
            variant="outline"
            size="sm"
            class="shrink-0"
          >
            <ToggleGroupItem value="asc" disabled={!sortColumn} aria-label="Ascending" class="text-xs">
              <ArrowUp class="size-3" />
              Asc
            </ToggleGroupItem>
            <ToggleGroupItem value="desc" disabled={!sortColumn} aria-label="Descending" class="text-xs">
              <ArrowDown class="size-3" />
              Desc
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </section>
    </aside>

    <!-- Right: results -->
    <section class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center justify-between border-b bg-background px-5 py-2.5">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold">Live preview</h2>
          <span class="text-muted-foreground text-[11px]">
            {#if running}
              <span class="inline-flex items-center gap-1">
                <Loader2 class="size-3 animate-spin" />
                Running…
              </span>
            {:else if !source || selectedColumns.length === 0}
              Waiting on definition
            {:else}
              <span class="font-mono tabular-nums">{resultTotal.toLocaleString()}</span>
              row{resultTotal === 1 ? '' : 's'}
            {/if}
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          {#if currentSource?.providerId}
            <Badge variant="outline" class="h-5 font-normal text-[10px] uppercase tracking-wider">
              {currentProviderName}
            </Badge>
          {/if}
          <Button
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 text-xs"
            disabled={!source || selectedColumns.length === 0 || running}
            onclick={() => runReport()}
          >
            <Play class="size-3" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 text-xs"
            disabled={!source || selectedColumns.length === 0 || exporting}
            onclick={exportCsv}
          >
            {#if exporting}
              <Loader2 class="size-3 animate-spin" />
            {:else}
              <Download class="size-3" />
            {/if}
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col bg-background">
        {#if !source}
          <div class="flex flex-1 items-center justify-center px-6">
            <div class="max-w-sm text-center">
              <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-muted">
                <Database class="size-5 text-muted-foreground" />
              </div>
              <h3 class="text-sm font-semibold">Start with a data source</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                Pick a vendor table on the left. The preview here will run automatically as you add
                columns and filters.
              </p>
            </div>
          </div>
        {:else if selectedColumns.length === 0}
          <div class="flex flex-1 items-center justify-center px-6">
            <div class="max-w-sm text-center">
              <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-muted">
                <ListChecks class="size-5 text-muted-foreground" />
              </div>
              <h3 class="text-sm font-semibold">Add a column to see rows</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                Pick at least one field from the {currentSource?.label ?? 'source'} shape. The
                columns you add appear in the order you pick them.
              </p>
            </div>
          </div>
        {:else if runError}
          <div class="flex flex-1 items-center justify-center px-6">
            <div class="max-w-md text-center">
              <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-destructive/10">
                <Filter class="size-5 text-destructive" />
              </div>
              <h3 class="text-sm font-semibold text-destructive">Report failed to run</h3>
              <p class="text-muted-foreground mt-1 text-xs">{runError}</p>
            </div>
          </div>
        {:else}
          <div class="min-h-0 flex-1 overflow-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted/40 sticky top-0 z-10 backdrop-blur">
                <tr>
                  {#each selectedColumns as key}
                    <th
                      class="text-muted-foreground border-b px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider"
                    >
                      {fieldByKey.get(key)?.label ?? key}
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each resultRows as row, i (row.id ?? i)}
                  <tr class="hover:bg-muted/30 border-b transition-colors">
                    {#each selectedColumns as key}
                      <td class="px-3 py-2 font-mono text-xs">
                        {formatCell(row[key])}
                      </td>
                    {/each}
                  </tr>
                {/each}
                {#if resultRows.length === 0 && !running}
                  <tr>
                    <td
                      colspan={selectedColumns.length}
                      class="text-muted-foreground py-10 text-center text-sm"
                    >
                      No rows match the current filters.
                    </td>
                  </tr>
                {/if}
              </tbody>
            </table>
          </div>
          {#if resultTotal > 0}
            <div class="flex items-center justify-between border-t bg-background px-4 py-2">
              <span class="text-muted-foreground text-[11px]">
                Showing <span class="font-mono tabular-nums">{((resultPage - 1) * 50 + 1).toLocaleString()}</span>–<span class="font-mono tabular-nums">{Math.min(
                  resultPage * 50,
                  resultTotal
                ).toLocaleString()}</span> of <span class="font-mono tabular-nums">{resultTotal.toLocaleString()}</span>
              </span>
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7"
                  disabled={!canPreviousPage}
                  onclick={() => changePage(resultPage - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft class="size-4" />
                </Button>
                <span class="text-muted-foreground min-w-16 text-center text-[11px] tabular-nums"
                  >Page {resultPage} / {pageCount}</span
                >
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7"
                  disabled={!canNextPage}
                  onclick={() => changePage(resultPage + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight class="size-4" />
                </Button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </section>
  </div>
</div>
