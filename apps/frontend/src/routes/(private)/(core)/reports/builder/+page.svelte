<script module lang="ts">
  function formatCell(value: unknown): string {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
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
    Download,
    Play,
    Plus,
    Save,
    Trash2,
  } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import type { FieldDefinition, SchemaFields } from '@mspbyte/shared';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
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

  type SourceMeta = {
    table: string;
    label: string;
    providerId: string | null;
    shape: SchemaFields;
    licenseRequirements?: Array<{ value: string; label: string; description: string }>;
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
    object: ['is_null', 'is_not_null'],
  };

  const REPORT_OPERATOR_LABELS: Record<string, string> = {
    ...OPERATOR_LABELS,
    has_requirement: 'Has coverage for',
    lacks_requirement: 'Is missing coverage for',
    has_any_of: 'Contains any of',
    lacks_any_of: 'Contains none of',
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
  const sourceOptions = $derived(sources.map((s) => ({ value: s.table, label: s.label })));
  const currentSource = $derived<SourceMeta | undefined>(sources.find((s) => s.table === source));
  const shape = $derived<SchemaFields | undefined>(currentSource?.shape);
  const shapeEntries = $derived<Array<[string, FieldDefinition]>>(
    shape ? Object.entries(shape) : []
  );
  const filterEntries = $derived(shapeEntries.filter(([key]) => key !== 'groupNames'));
  const licenseOptions = $derived(licenseOptionsQuery.data ?? []);

  const sortColumnOptions = $derived(
    selectedColumns
      .filter((k) => k !== 'groupNames')
      .map((k) => ({
        value: k,
        label: shape?.[k]?.label ?? k,
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
      value: f.value == null ? '' : String(f.value),
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
    const text = formatCell(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  async function exportCsv() {
    if (!source || selectedColumns.length === 0) return;
    exporting = true;
    try {
      const result = await trpc.reports.run.mutate({
        source,
        definition: reportDefinition(),
        table: { page: 1, pageSize: 1000, filters: [] },
      });
      const headers = selectedColumns.map((key) => csvValue(shape?.[key]?.label ?? key));
      const lines = (result.rows as ResultRow[]).map((row) =>
        selectedColumns.map((key) => csvValue(row[key])).join(',')
      );
      const blob = new Blob([[headers.join(','), ...lines].join('\n')], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(name.trim() || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${result.rows.length.toLocaleString()} row${result.rows.length === 1 ? '' : 's'}`
      );
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
    const [col, def] = first;
    filters = [
      ...filters,
      { id: filterUid++, column: col, operator: operatorsFor(col, def.type)[0], value: '' },
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
        await goto(`/reports/builder?id=${saved.id}`);
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

<div class="flex size-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between gap-3 border-b px-6 py-3">
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" class="gap-2" onclick={() => goto('/reports')}>
        <ArrowLeft class="size-4" />
        Reports
      </Button>
      <div class="text-muted-foreground text-sm">
        {editing ? 'Edit report' : 'New report'}
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if editing && canDelete}
        <Button variant="ghost" size="sm" class="gap-2" disabled={deleting} onclick={del}>
          <Trash2 class="size-4" />
          Delete
        </Button>
      {/if}
      <ScopeBar />
      {#if canWrite}
        <Button size="sm" class="gap-2" disabled={saving} onclick={save}>
          <Save class="size-4" />
          {editing ? 'Save changes' : 'Create report'}
        </Button>
      {/if}
    </div>
  </div>

  <!-- Two-pane composer -->
  <div class="flex min-h-0 flex-1">
    <!-- Left: composition -->
    <aside
      class="bg-muted/[0.015] flex w-[440px] shrink-0 flex-col gap-5 overflow-y-auto border-r p-5"
    >
      <div class="space-y-2 border-t pt-5">
        <Label for="report-name">Name</Label>
        <Input id="report-name" bind:value={name} placeholder="Licensed M365 users" />
      </div>

      <div class="space-y-2">
        <Label for="report-desc">Description</Label>
        <Textarea
          id="report-desc"
          bind:value={description}
          placeholder="Optional. What this report answers."
          rows={2}
        />
      </div>

      <div class="space-y-2">
        <Label>Data source</Label>
        <SingleSelect
          options={sourceOptions}
          bind:selected={source}
          placeholder="Pick a source"
          searchPlaceholder="Search sources…"
        />
      </div>

      <!-- Columns -->
      <div class="space-y-2 border-t pt-5">
        <div class="flex items-baseline justify-between">
          <div>
            <Label>Columns</Label>
            <p class="text-muted-foreground mt-0.5 text-xs">
              The order here is the order in the preview and export.
            </p>
          </div>
          <span class="text-muted-foreground text-xs">
            {selectedColumns.length} of {shapeEntries.length}
          </span>
        </div>
        {#if !shape}
          <p class="text-muted-foreground text-xs">Pick a source to choose columns.</p>
        {:else}
          <div class="space-y-3">
            {#if selectedColumns.length > 0}
              <div class="overflow-hidden rounded-lg border bg-background shadow-sm">
                <div
                  class="bg-muted/40 border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Report column order
                </div>
                <ul class="divide-y">
                  {#each selectedColumns as key, index (key)}
                    {@const def = shape[key]}
                    <li class="flex items-center gap-2 px-3 py-2">
                      <span class="text-muted-foreground w-4 text-center text-xs tabular-nums"
                        >{index + 1}</span
                      >
                      <span class="min-w-0 flex-1 truncate text-sm font-medium"
                        >{def?.label ?? key}</span
                      >
                      <div class="flex shrink-0 items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          class="size-6"
                          disabled={index === 0}
                          onclick={() => moveColumn(key, -1)}
                          aria-label={`Move ${def?.label ?? key} up`}
                        >
                          <ArrowUp class="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="size-6"
                          disabled={index === selectedColumns.length - 1}
                          onclick={() => moveColumn(key, 1)}
                          aria-label={`Move ${def?.label ?? key} down`}
                        >
                          <ArrowDown class="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="size-6"
                          onclick={() => toggleColumn(key)}
                          aria-label={`Remove ${def?.label ?? key}`}
                        >
                          <Trash2 class="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
            <div class="overflow-hidden rounded-lg border">
              <div
                class="bg-muted/40 border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                Available columns
              </div>
              <ul class="max-h-48 divide-y overflow-y-auto">
                {#each shapeEntries.filter(([key]) => !selectedColumns.includes(key)) as [key, def] (key)}
                  <li class="flex items-center gap-2 px-3 py-2">
                    <Checkbox
                      id={`col-${key}`}
                      checked={false}
                      onCheckedChange={() => toggleColumn(key)}
                    />
                    <label for={`col-${key}`} class="flex-1 cursor-pointer text-sm">
                      {def.label}
                    </label>
                    <span
                      class="text-muted-foreground font-mono text-[10px] uppercase tracking-wider"
                    >
                      {def.type}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}
      </div>

      <!-- Filters -->
      <div class="space-y-3 border-t pt-5">
        <div class="flex items-baseline justify-between">
          <div>
            <Label>Filters</Label>
            <p class="text-muted-foreground mt-0.5 text-xs">
              Each condition narrows the result set.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 gap-1 px-2 text-xs"
            disabled={!shape}
            onclick={addFilter}
          >
            <Plus class="size-3" />
            Add
          </Button>
        </div>
        {#if filters.length === 0}
          <p class="text-muted-foreground text-xs">No filters. All rows returned.</p>
        {:else}
          <div class="space-y-3">
            {#each filters as f (f.id)}
              {@const def = shape?.[f.column]}
              {@const ops = def ? operatorsFor(f.column, def.type) : []}
              {@const needsValue = f.operator !== 'is_null' && f.operator !== 'is_not_null'}
              <div class="bg-background space-y-2 rounded-lg border p-3 shadow-sm">
                <div class="flex min-w-0 items-center gap-2">
                  <SingleSelect
                    class="h-8 min-w-0 flex-1 text-xs"
                    options={filterEntries.map(([key, field]) => ({
                      value: key,
                      label: field.label,
                    }))}
                    selected={f.column}
                    onchange={(value) => updateFilterColumn(f.id, value)}
                    placeholder="Field"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0"
                    onclick={() => removeFilter(f.id)}
                  >
                    <Trash2 class="size-3" />
                  </Button>
                </div>
                <div class="grid min-w-0 grid-cols-[9rem_minmax(0,1fr)] gap-2">
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
                      <p class="text-muted-foreground flex-1 px-1 text-xs">
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
      </div>

      <!-- Sort -->
      <div class="space-y-2 border-t pt-5">
        <Label>Sort by</Label>
        <div class="flex gap-2">
          <div class="flex-1">
            <SingleSelect
              options={[{ value: '', label: 'None' }, ...sortColumnOptions]}
              bind:selected={sortColumn}
              placeholder="None"
            />
          </div>
          <SingleSelect
            class="h-9 w-28 text-sm"
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
            bind:selected={sortDirection}
            disabled={!sortColumn}
          />
        </div>
      </div>
    </aside>

    <!-- Right: results -->
    <section class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center justify-between border-b px-5 py-2.5">
        <div class="flex items-baseline gap-3">
          <h2 class="text-sm font-semibold">Preview</h2>
          <span class="text-muted-foreground font-mono text-xs">
            {#if running}running…{:else if !source || selectedColumns.length === 0}—{:else}
              {resultTotal.toLocaleString()} row{resultTotal === 1 ? '' : 's'}
            {/if}
          </span>
        </div>
        <div class="flex items-center gap-2">
          {#if currentSource?.providerId}
            <Badge variant="outline" class="font-mono text-[10px] uppercase">
              {currentSource.providerId}
            </Badge>
          {/if}
          <Button
            variant="outline"
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
            <Download class="size-3" />
            {exporting ? 'Exporting…' : 'CSV'}
          </Button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        {#if !source}
          <div class="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            Pick a data source to start.
          </div>
        {:else if selectedColumns.length === 0}
          <div class="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            Pick at least one column to see rows.
          </div>
        {:else if runError}
          <div class="text-destructive flex flex-1 items-center justify-center px-6 text-sm">
            {runError}
          </div>
        {:else}
          <div class="min-h-0 flex-1 overflow-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted/40 sticky top-0 z-10">
                <tr>
                  {#each selectedColumns as key}
                    <th
                      class="text-muted-foreground border-b px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                    >
                      {shape?.[key]?.label ?? key}
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
            <div class="flex items-center justify-between border-t px-4 py-2">
              <span class="text-muted-foreground text-xs">
                Showing {((resultPage - 1) * 50 + 1).toLocaleString()}–{Math.min(
                  resultPage * 50,
                  resultTotal
                ).toLocaleString()} of {resultTotal.toLocaleString()}
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
                <span class="text-muted-foreground min-w-16 text-center text-xs"
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
