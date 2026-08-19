<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { ArrowLeft, Plus, Save, Trash2 } from '@lucide/svelte';
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
  import { showErrorToast } from '$lib/utils/errors';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));

  const reportId = $derived(page.url.searchParams.get('id') ?? '');
  const editing = $derived(Boolean(reportId));

  type SourceMeta = {
    table: string;
    label: string;
    providerId: string | null;
    shape: SchemaFields;
  };

  type FilterRow = {
    id: number;
    column: string;
    operator: string;
    value: string;
  };

  type ResultRow = Record<string, unknown> & { id?: string };

  const OPERATORS_BY_TYPE: Record<FieldDefinition['type'], readonly string[]> = {
    string: ['eq', 'neq', 'contains', 'is_null', 'is_not_null'],
    enum: ['eq', 'neq', 'is_null', 'is_not_null'],
    boolean: ['eq', 'neq', 'is_null', 'is_not_null'],
    number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
    object: ['is_null', 'is_not_null'],
  };

  const OPERATOR_LABEL: Record<string, string> = {
    eq: 'is',
    neq: 'is not',
    contains: 'contains',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    is_null: 'is empty',
    is_not_null: 'is not empty',
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

  // -- derived ---------------------------------------------------------------

  const sources = $derived<SourceMeta[]>((sourcesQuery.data as SourceMeta[]) ?? []);
  const sourceOptions = $derived(sources.map((s) => ({ value: s.table, label: s.label })));
  const currentSource = $derived<SourceMeta | undefined>(sources.find((s) => s.table === source));
  const shape = $derived<SchemaFields | undefined>(currentSource?.shape);
  const shapeEntries = $derived<Array<[string, FieldDefinition]>>(
    shape ? Object.entries(shape) : [],
  );

  const sortColumnOptions = $derived(
    selectedColumns.map((k) => ({
      value: k,
      label: shape?.[k]?.label ?? k,
    })),
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
    }),
  );

  function validFilter(f: FilterRow): boolean {
    if (!f.column || !f.operator) return false;
    if (f.operator === 'is_null' || f.operator === 'is_not_null') return true;
    return f.value !== '';
  }

  function coerceValue(f: FilterRow): string | number | boolean | undefined {
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
    if (runTimer) clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      lastRunSignature = sig;
      void runReport();
    }, 350);
  });

  async function runReport() {
    if (!source || selectedColumns.length === 0) return;
    running = true;
    runError = null;
    try {
      const result = await trpc.reports.run.mutate({
        source,
        definition: {
          columns: selectedColumns,
          filters: filters
            .filter(validFilter)
            .map((f) => ({
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
                | 'is_not_null',
              value: coerceValue(f),
            })),
          sort: sortColumn ? { column: sortColumn, direction: sortDirection } : undefined,
        },
        table: { page: 1, pageSize: 50, filters: [] },
      });
      resultRows = result.rows as ResultRow[];
      resultTotal = result.total;
    } catch (err) {
      runError =
        err instanceof Error ? err.message : 'Report failed to run. Check the definition.';
      resultRows = [];
      resultTotal = 0;
    } finally {
      running = false;
    }
  }

  // -- filters ---------------------------------------------------------------

  function addFilter() {
    const first = shapeEntries[0];
    if (!first) return;
    const [col, def] = first;
    filters = [
      ...filters,
      { id: filterUid++, column: col, operator: OPERATORS_BY_TYPE[def.type][0], value: '' },
    ];
  }

  function removeFilter(id: number) {
    filters = filters.filter((f) => f.id !== id);
  }

  function updateFilterColumn(id: number, column: string) {
    const def = shape?.[column];
    if (!def) return;
    filters = filters.map((f) =>
      f.id === id ? { ...f, column, operator: OPERATORS_BY_TYPE[def.type][0], value: '' } : f,
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
        definition: {
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
              | 'is_not_null',
            value: coerceValue(f),
          })),
          sort: sortColumn ? { column: sortColumn, direction: sortDirection } : undefined,
        },
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
      {#if editing && canWrite}
        <Button variant="ghost" size="sm" class="gap-2" disabled={deleting} onclick={del}>
          <Trash2 class="size-4" />
          Delete
        </Button>
      {/if}
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
    <aside class="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto border-r p-5">
      <div class="space-y-2">
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
      <div class="space-y-2">
        <div class="flex items-baseline justify-between">
          <Label>Columns</Label>
          <span class="text-muted-foreground text-xs">
            {selectedColumns.length} of {shapeEntries.length}
          </span>
        </div>
        {#if !shape}
          <p class="text-muted-foreground text-xs">Pick a source to choose columns.</p>
        {:else}
          <div class="rounded-md border">
            <ul class="max-h-64 divide-y overflow-y-auto">
              {#each shapeEntries as [key, def] (key)}
                <li class="flex items-center gap-2 px-3 py-2">
                  <Checkbox
                    id={`col-${key}`}
                    checked={selectedColumns.includes(key)}
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
        {/if}
      </div>

      <!-- Filters -->
      <div class="space-y-2">
        <div class="flex items-baseline justify-between">
          <Label>Filters</Label>
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
          <div class="space-y-2">
            {#each filters as f (f.id)}
              {@const def = shape?.[f.column]}
              {@const ops = def ? OPERATORS_BY_TYPE[def.type] : []}
              {@const needsValue = f.operator !== 'is_null' && f.operator !== 'is_not_null'}
              <div class="space-y-1 rounded-md border p-2">
                <div class="flex items-center gap-1">
                  <select
                    class="border-input bg-background flex-1 rounded-md border px-2 py-1 text-xs"
                    value={f.column}
                    onchange={(e) => updateFilterColumn(f.id, e.currentTarget.value)}
                  >
                    {#each shapeEntries as [key, sdef] (key)}
                      <option value={key}>{sdef.label}</option>
                    {/each}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-6"
                    onclick={() => removeFilter(f.id)}
                  >
                    <Trash2 class="size-3" />
                  </Button>
                </div>
                <div class="flex items-center gap-1">
                  <select
                    class="border-input bg-background rounded-md border px-2 py-1 text-xs"
                    bind:value={f.operator}
                  >
                    {#each ops as op}
                      <option value={op}>{OPERATOR_LABEL[op] ?? op}</option>
                    {/each}
                  </select>
                  {#if needsValue}
                    {#if def?.type === 'boolean'}
                      <select
                        class="border-input bg-background flex-1 rounded-md border px-2 py-1 text-xs"
                        bind:value={f.value}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    {:else if def?.type === 'enum' && def.options?.length}
                      <select
                        class="border-input bg-background flex-1 rounded-md border px-2 py-1 text-xs"
                        bind:value={f.value}
                      >
                        <option value="">—</option>
                        {#each def.options as opt}
                          <option value={String(opt.value)}>{opt.label}</option>
                        {/each}
                      </select>
                    {:else}
                      <Input
                        class="h-7 flex-1 text-xs"
                        type={def?.type === 'number' ? 'number' : 'text'}
                        bind:value={f.value}
                        placeholder="value"
                      />
                    {/if}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Sort -->
      <div class="space-y-2">
        <Label>Sort by</Label>
        <div class="flex gap-2">
          <div class="flex-1">
            <SingleSelect
              options={[{ value: '', label: 'None' }, ...sortColumnOptions]}
              bind:selected={sortColumn}
              placeholder="None"
            />
          </div>
          <select
            class="border-input bg-background rounded-md border px-2 py-1 text-sm"
            bind:value={sortDirection}
            disabled={!sortColumn}
          >
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
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
        {#if currentSource?.providerId}
          <Badge variant="outline" class="font-mono text-[10px] uppercase">
            {currentSource.providerId}
          </Badge>
        {/if}
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
        {/if}
      </div>
    </section>
  </div>
</div>

<script module lang="ts">
  function formatCell(value: unknown): string {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
</script>
