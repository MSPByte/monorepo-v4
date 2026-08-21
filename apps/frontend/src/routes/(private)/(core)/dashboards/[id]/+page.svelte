<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { ArrowLeft, ChevronDown, ChevronUp, Plus, Save, Trash2 } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { showErrorToast } from '$lib/utils/errors';
  import ScopeBar from '../../reports/_components/scope-bar.svelte';
  import KpiTile from './_components/kpi-tile.svelte';
  import ThresholdEditor from './_components/threshold-editor.svelte';

  type Tone = 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
  type Op = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'is_not_null';
  type Threshold = { key: number; at: string; tone: Tone };
  type Filter = { key: number; column: string; operator: Op; value: string };
  type Definition = {
    columns: string[];
    filters: Array<{ column: string; operator: Op; value?: string | number | boolean }>;
  };
  type Tile = {
    key: string;
    id?: string;
    title: string;
    source: string;
    definition: Definition;
    tone: Tone;
    caption: string;
    kind: 'kpi' | 'bar' | 'line' | 'donut';
    aggregation: 'count' | 'percent';
    format: 'number' | 'percent';
    groupBy: string;
    width: '1' | '2' | '3' | '4';
    height: 'compact' | 'standard' | 'tall';
    thresholds: Threshold[];
  };

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));
  const canDelete = $derived(authStore.isAllowed('Reports.Delete'));
  const id = $derived(page.params.id ?? '');
  const isNew = $derived(id === 'new');

  let uid = 0;
  let filterUid = 0;
  let thresholdUid = 0;
  let hydrated = $state(false);
  let name = $state('');
  let description = $state('');
  let tiles = $state<Tile[]>([]);
  let saving = $state(false);
  let deleting = $state(false);
  let openSheet = $state(false);
  let editingKey = $state<string | null>(null);
  let draftTitle = $state('');
  let draftSource = $state('');
  let draftTone = $state<Tone>('neutral');
  let draftCaption = $state('');
  let draftKind = $state<Tile['kind']>('kpi');
  let draftAggregation = $state<Tile['aggregation']>('count');
  let draftFormat = $state<Tile['format']>('number');
  let draftGroupBy = $state('');
  let draftWidth = $state<Tile['width']>('1');
  let draftHeight = $state<Tile['height']>('standard');
  let draftThresholds = $state<Threshold[]>([]);
  let draftFilters = $state<Filter[]>([]);

  const dashboard = createQuery(() => ({
    queryKey: ['dashboards.byId', id],
    queryFn: () => (isNew ? Promise.resolve(null) : trpc.dashboards.byId.query({ id })),
  }));
  const sources = createQuery(() => ({
    queryKey: ['reports.listSources'],
    queryFn: () => trpc.reports.listSources.query(),
    staleTime: 300_000,
  }));
  const sourceOptions = $derived(
    (sources.data ?? []).map((source) => ({ value: source.table, label: source.label }))
  );
  const shape = $derived(sources.data?.find((source) => source.table === draftSource)?.shape ?? {});
  const fields = $derived(
    Object.entries(shape).map(([value, field]) => ({ value, label: field.label }))
  );

  function addFilter() {
    draftFilters = [
      ...draftFilters,
      { key: filterUid++, column: Object.keys(shape)[0] ?? '', operator: 'eq', value: '' },
    ];
  }
  function updateFilter(key: number, patch: Partial<Filter>) {
    draftFilters = draftFilters.map((filter) =>
      filter.key === key ? { ...filter, ...patch } : filter
    );
  }
  function removeFilter(key: number) {
    draftFilters = draftFilters.filter((filter) => filter.key !== key);
  }
  function operators(column: string): Op[] {
    const type = shape[column]?.type;
    return type === 'number' || type === 'date'
      ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']
      : ['eq', 'neq', 'contains', 'is_null', 'is_not_null'];
  }
  function definition(): Definition {
    return {
      columns: [...new Set([Object.keys(shape)[0], draftGroupBy].filter(Boolean))],
      filters: draftFilters
        .filter(
          (filter) =>
            filter.column &&
            (filter.operator === 'is_null' ||
              filter.operator === 'is_not_null' ||
              filter.value !== '')
        )
        .map((filter) => ({
          column: filter.column,
          operator: filter.operator,
          value:
            filter.operator === 'is_null' || filter.operator === 'is_not_null'
              ? undefined
              : shape[filter.column]?.type === 'boolean'
                ? filter.value === 'true'
                : shape[filter.column]?.type === 'number'
                  ? Number(filter.value)
                  : filter.value,
        })),
    };
  }

  $effect(() => {
    if (hydrated || isNew || !dashboard.data) return;
    name = dashboard.data.name;
    description = dashboard.data.description ?? '';
    tiles = dashboard.data.tiles.map((row) => {
      const definition = (row.inlineDef ?? {}) as { source?: string; definition?: Definition };
      const viz = (row.viz ?? {}) as Partial<Tile> & {
        thresholds?: Array<{ at: number; tone: Tone }>;
      };
      return {
        key: `t${uid++}`,
        id: row.id,
        title: row.title,
        source: definition.source ?? '',
        definition: definition.definition ?? { columns: [], filters: [] },
        tone: viz.tone ?? 'neutral',
        caption: viz.caption ?? '',
        kind: (row.kind as Tile['kind']) ?? 'kpi',
        aggregation: viz.aggregation ?? 'count',
        format: viz.format ?? 'number',
        groupBy: viz.groupBy ?? '',
        width: viz.width ?? '1',
        height: viz.height ?? 'standard',
        thresholds: (viz.thresholds ?? []).map((threshold) => ({
          key: thresholdUid++,
          at: String(threshold.at),
          tone: threshold.tone,
        })),
      };
    });
    hydrated = true;
  });

  function edit(tile?: Tile) {
    editingKey = tile?.key ?? null;
    draftTitle = tile?.title ?? '';
    draftSource = tile?.source ?? sourceOptions[0]?.value ?? '';
    draftTone = tile?.tone ?? 'neutral';
    draftCaption = tile?.caption ?? '';
    draftKind = tile?.kind ?? 'kpi';
    draftAggregation = tile?.aggregation ?? 'count';
    draftFormat = tile?.format ?? 'number';
    draftGroupBy = tile?.groupBy ?? '';
    draftWidth = tile?.width ?? '1';
    draftHeight = tile?.height ?? 'standard';
    draftThresholds = (tile?.thresholds ?? []).map((threshold) => ({ ...threshold }));
    draftFilters = (tile?.definition.filters ?? []).map((filter) => ({
      key: filterUid++,
      column: filter.column,
      operator: filter.operator,
      value: filter.value == null ? '' : String(filter.value),
    }));
    openSheet = true;
  }
  function commit() {
    if (!draftTitle.trim() || !draftSource || (draftKind !== 'kpi' && !draftGroupBy)) {
      toast.error('Complete the widget definition.');
      return;
    }
    const next: Tile = {
      key: editingKey ?? `t${uid++}`,
      title: draftTitle.trim(),
      source: draftSource,
      definition: definition(),
      tone: draftTone,
      caption: draftCaption.trim(),
      kind: draftKind,
      aggregation: draftAggregation,
      format: draftFormat,
      groupBy: draftGroupBy,
      width: draftWidth,
      height: draftHeight,
      thresholds: draftThresholds.map((threshold) => ({ ...threshold })),
    };
    tiles = editingKey
      ? tiles.map((tile) => (tile.key === editingKey ? { ...next, id: tile.id } : tile))
      : [...tiles, next];
    openSheet = false;
  }
  function move(key: string, direction: -1 | 1) {
    const from = tiles.findIndex((tile) => tile.key === key);
    const to = from + direction;
    if (to < 0 || to >= tiles.length) return;
    const next = [...tiles];
    [next[from], next[to]] = [next[to], next[from]];
    tiles = next;
  }
  async function save() {
    if (!name.trim()) {
      toast.error('Give the dashboard a name.');
      return;
    }
    saving = true;
    try {
      const saved = await trpc.dashboards.save.mutate({
        id: isNew ? undefined : id,
        name: name.trim(),
        description: description.trim() || null,
        layout: [],
        tiles: tiles.map((tile, position) => ({
          title: tile.title,
          kind: tile.kind,
          reportId: null,
          inlineDef: { source: tile.source, definition: tile.definition },
          viz: {
            aggregation: tile.aggregation,
            format: tile.format,
            tone: tile.tone,
            caption: tile.caption || undefined,
            groupBy: tile.groupBy || undefined,
            chartStyle: tile.kind === 'kpi' ? undefined : tile.kind,
            width: tile.width,
            height: tile.height,
            thresholds: tile.thresholds
              .map((threshold) => ({ at: Number(threshold.at), tone: threshold.tone }))
              .filter((threshold) => Number.isFinite(threshold.at) && threshold.at >= 0)
              .sort((a, b) => a.at - b.at),
            position,
          },
        })),
      });
      await qc.invalidateQueries({ queryKey: ['dashboards.list'] });
      if (isNew) await goto(`/dashboards/${saved.id}`);
      else await qc.invalidateQueries({ queryKey: ['dashboards.byId', id] });
    } catch (error) {
      showErrorToast(error, 'Failed to save dashboard');
    } finally {
      saving = false;
    }
  }
  async function removeDashboard() {
    deleting = true;
    try {
      await trpc.dashboards.delete.mutate({ id });
      await goto('/home');
    } catch (error) {
      showErrorToast(error, 'Failed to delete dashboard');
    } finally {
      deleting = false;
    }
  }
</script>

<Sheet.Root open={openSheet} onOpenChange={(v) => (openSheet = v)}
  ><Sheet.Content style="width:min(96vw,72rem);max-width:min(96vw,72rem)"
    ><Sheet.Header
      ><Sheet.Title>{editingKey ? 'Edit widget' : 'Add widget'}</Sheet.Title><Sheet.Description
        >Choose the records and visual signal for this widget.</Sheet.Description
      ></Sheet.Header
    >
    <div class="space-y-6 overflow-y-auto px-5 pb-5">
      <div class="grid gap-5 md:grid-cols-2">
        <div class="space-y-2"><Label>Title</Label><Input bind:value={draftTitle} /></div>
        <div class="space-y-2">
          <Label>Source</Label><SingleSelect options={sourceOptions} bind:selected={draftSource} />
        </div>
      </div>
      <div class="grid gap-5 md:grid-cols-4">
        <div class="space-y-2">
          <Label>Visual</Label><SingleSelect
            options={[
              { value: 'kpi', label: 'KPI number' },
              { value: 'bar', label: 'Bar chart' },
              { value: 'line', label: 'Line chart' },
              { value: 'donut', label: 'Donut chart' },
            ]}
            bind:selected={draftKind}
          />
        </div>
        <div class="space-y-2">
          <Label>{draftKind === 'kpi' ? 'Measure' : 'Group by'}</Label
          >{#if draftKind === 'kpi'}<SingleSelect
              options={[
                { value: 'count', label: 'Count' },
                { value: 'percent', label: 'Percent' },
              ]}
              bind:selected={draftAggregation}
            />{:else}<SingleSelect options={fields} bind:selected={draftGroupBy} />{/if}
        </div>
        <div class="space-y-2">
          <Label>Height</Label><SingleSelect
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'standard', label: 'Standard' },
              { value: 'tall', label: 'Tall' },
            ]}
            bind:selected={draftHeight}
          />
        </div>
        <div class="space-y-2">
          <Label>Base color</Label><SingleSelect
            options={['neutral', 'primary', 'success', 'warning', 'danger'].map((value) => ({
              value,
              label: value,
            }))}
            bind:selected={draftTone}
          />
        </div>
      </div>
      {#if draftKind !== 'kpi'}<ThresholdEditor bind:thresholds={draftThresholds} />{/if}
      <section class="rounded-lg border bg-muted/20 p-4">
        <div class="mb-4 flex items-start justify-between">
          <div>
            <h3 class="text-sm font-semibold">Filters</h3>
            <p class="text-muted-foreground text-xs">Narrow the source records.</p>
          </div>
          <Button size="sm" variant="outline" onclick={addFilter}>Add filter</Button>
        </div>
        {#each draftFilters as filter (filter.key)}{@const field = shape[filter.column]}
          <div
            class="mb-3 grid grid-cols-[minmax(12rem,1fr)_10rem_minmax(12rem,1fr)_auto] items-end gap-3"
          >
            <div class="space-y-2">
              <Label>Field</Label><SingleSelect
                options={fields}
                selected={filter.column}
                onchange={(v) => updateFilter(filter.key, { column: v, operator: 'eq', value: '' })}
              />
            </div>
            <div class="space-y-2">
              <Label>Operator</Label><SingleSelect
                options={operators(filter.column).map((value) => ({
                  value,
                  label: value.replaceAll('_', ' '),
                }))}
                selected={filter.operator}
                onchange={(v) => updateFilter(filter.key, { operator: v as Op })}
              />
            </div>
            <div class="space-y-2">
              <Label>Value</Label
              >{#if filter.operator === 'is_null' || filter.operator === 'is_not_null'}<div
                  class="text-muted-foreground h-10 py-2 text-sm"
                >
                  No value needed
                </div>{:else if field?.type === 'boolean'}<SingleSelect
                  options={[
                    { value: 'true', label: 'True' },
                    { value: 'false', label: 'False' },
                  ]}
                  selected={filter.value}
                  onchange={(v) => updateFilter(filter.key, { value: v })}
                />{:else if field?.type === 'enum' && field.options?.length}<SingleSelect
                  options={field.options}
                  selected={filter.value}
                  onchange={(v) => updateFilter(filter.key, { value: v })}
                />{:else}<Input
                  value={filter.value}
                  oninput={(e) => updateFilter(filter.key, { value: e.currentTarget.value })}
                />{/if}
            </div>
            <Button variant="ghost" size="icon" onclick={() => removeFilter(filter.key)}
              ><Trash2 class="size-4" /></Button
            >
          </div>{/each}
      </section>
      <div class="grid gap-5 md:grid-cols-3">
        <div class="space-y-2">
          <Label>Width</Label><SingleSelect
            options={[
              { value: '1', label: '1 column' },
              { value: '2', label: '2 columns' },
              { value: '3', label: '3 columns' },
              { value: '4', label: 'Full row' },
            ]}
            bind:selected={draftWidth}
          />
        </div>
        <div class="space-y-2">
          <Label>Format</Label><SingleSelect
            options={[
              { value: 'number', label: 'Number' },
              { value: 'percent', label: 'Percent' },
            ]}
            bind:selected={draftFormat}
          />
        </div>
        <div class="space-y-2">
          <Label>Supporting text</Label><Input bind:value={draftCaption} />
        </div>
      </div>
    </div>
    <Sheet.Footer
      ><Button variant="ghost" onclick={() => (openSheet = false)}>Cancel</Button><Button
        onclick={commit}>Save widget</Button
      ></Sheet.Footer
    ></Sheet.Content
  ></Sheet.Root
>

<div class="flex size-full flex-col overflow-hidden">
  <header class="flex items-center justify-between border-b px-6 py-3">
    <Button variant="ghost" size="sm" class="gap-2" onclick={() => goto('/home')}
      ><ArrowLeft class="size-4" />Overview</Button
    >
    <div class="flex gap-2">
      <ScopeBar />{#if !isNew && canDelete}<Button
          variant="ghost"
          disabled={deleting}
          onclick={removeDashboard}><Trash2 class="size-4" />Delete</Button
        >{/if}<Button disabled={!canWrite || saving} class="gap-2" onclick={save}
        ><Save class="size-4" />Save changes</Button
      >
    </div>
  </header>
  <main class="flex-1 overflow-y-auto p-6">
    <div class="mx-auto max-w-6xl space-y-7">
      <div class="grid gap-5 md:grid-cols-2">
        <div class="space-y-2"><Label>Dashboard name</Label><Input bind:value={name} /></div>
        <div class="space-y-2"><Label>Description</Label><Input bind:value={description} /></div>
      </div>
      <div class="flex justify-between">
        <div>
          <h2 class="font-semibold">Widgets</h2>
          <p class="text-muted-foreground text-sm">Arrange signals for the team.</p>
        </div>
        <Button class="gap-2" onclick={() => edit()}><Plus class="size-4" />Add widget</Button>
      </div>
      <div class="grid gap-3 md:grid-cols-4">
        {#each tiles as tile (tile.key)}<div>
            <KpiTile
              {tile}
              editable={canWrite}
              onedit={() => edit(tile)}
              onremove={() => (tiles = tiles.filter((t) => t.key !== tile.key))}
            />
            <div class="flex justify-end">
              <Button
                variant="ghost"
                size="icon"
                disabled={tiles[0]?.key === tile.key}
                onclick={() => move(tile.key, -1)}><ChevronUp class="size-4" /></Button
              ><Button
                variant="ghost"
                size="icon"
                disabled={tiles[tiles.length - 1]?.key === tile.key}
                onclick={() => move(tile.key, 1)}><ChevronDown class="size-4" /></Button
              >
            </div>
          </div>{/each}
      </div>
    </div>
  </main>
</div>
