<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ArrowLeft, Plus, Save, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { PolicyTableShapes, type FieldDefinition, type PolicyTableShape } from '@mspbyte/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';

  type FlatField = {
    label: string;
    ingestPath: string;
    field: FieldDefinition;
  };

  type ConditionDraft = {
    id: string;
    field: string;
    op: string;
    value: string;
    values?: string[];
  };

  type FactCase = {
    id: string;
    conditions: ConditionDraft[];
    output: string;
  };

  function isSetOp(op: string) {
    return op === 'containsAny' || op === 'notContainsAny';
  }

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const ruleId = $derived(page.url.searchParams.get('id') ?? '');
  const editing = $derived(Boolean(ruleId));

  const ruleQuery = createQuery(() => ({
    queryKey: ['factRules.byId', ruleId],
    queryFn: () => (ruleId ? trpc.factRules.byId.query({ id: ruleId }) : Promise.resolve(null)),
  }));

  const catalogQuery = createQuery(() => ({
    queryKey: ['siteProfile.catalog'],
    queryFn: () => trpc.siteProfile.catalog.query(),
  }));

  let nextId = 1;
  let loadedRuleId = $state('');
  let saving = $state(false);

  // Identity
  let name = $state('');
  let description = $state('');
  let enabled = $state(true);
  let priority = $state('0');

  // Output
  let table = $state(PolicyTableShapes[0]?.table ?? 'assets');
  let factKey = $state('');
  let customFactKey = $state('');
  let aggregate = $state<'exists' | 'count' | 'value' | 'collect' | 'conditional'>('exists');

  // exists fields
  let outputTrue = $state('');
  let outputFalse = $state('');

  // value / collect fields
  let valueField = $state('');
  let transform = $state('none');

  // conditional fields
  let cases = $state<FactCase[]>([]);
  let defaultOutput = $state('');

  // global pre-filter
  let filterConditions = $state<ConditionDraft[]>([]);

  const selectedTable = $derived.by<PolicyTableShape>(() => {
    return PolicyTableShapes.find((s) => s.table === table) ?? PolicyTableShapes[0]!;
  });

  const fields = $derived.by<FlatField[]>(() => flattenFields(selectedTable.shape));
  const fieldOptions = $derived(fields.map((f) => ({ value: f.ingestPath, label: f.label })));
  const tableOptions = PolicyTableShapes.map((s) => ({ value: s.table, label: s.label }));

  const aggregateOptions = [
    { value: 'exists', label: 'Exists — true/false if any rows match' },
    { value: 'count', label: 'Count — number of matching rows' },
    { value: 'value', label: 'Value — field value from first matching row' },
    { value: 'collect', label: 'Collect — array of unique field values' },
    { value: 'conditional', label: 'Conditional — first matching case wins' },
  ];

  const transformOptions = [
    { value: 'none', label: 'None' },
    { value: 'afterAt', label: 'Domain from email (after @)' },
    { value: 'beforeAt', label: 'Username from email (before @)' },
    { value: 'afterLastDot', label: 'Extension (after last .)' },
    { value: 'beforeLastDot', label: 'Without extension (before last .)' },
    { value: 'lowercase', label: 'Lowercase' },
    { value: 'uppercase', label: 'Uppercase' },
    { value: 'trim', label: 'Trim whitespace' },
  ];

  const catalogFactKeyOptions = $derived.by(() => {
    const catalog = catalogQuery.data;
    if (!catalog) return [];
    const catalogFields = (catalog as { fields?: { key: string; label: string }[] }).fields ?? [];
    return catalogFields.map((f) => ({ value: f.key, label: `${f.label} (${f.key})` }));
  });

  const effectiveFactKey = $derived(factKey === '__custom__' ? customFactKey : factKey);

  const booleanOptions = [
    { value: 'true', label: 'True' },
    { value: 'false', label: 'False' },
  ];

  function newCondition(): ConditionDraft {
    return { id: `c-${nextId++}`, field: '', op: 'eq', value: '' };
  }

  function newCase(): FactCase {
    return { id: `fc-${nextId++}`, conditions: [], output: '' };
  }

  function flattenFields(shape: Record<string, FieldDefinition>, parentLabel = ''): FlatField[] {
    const results: FlatField[] = [];
    for (const definition of Object.values(shape)) {
      const label = parentLabel ? `${parentLabel} / ${definition.label}` : definition.label;
      if (definition.type === 'object' && definition.fields) {
        results.push(...flattenFields(definition.fields, label));
      } else if (definition.trackable) {
        results.push({ label, ingestPath: definition.ingestPath, field: definition });
      }
    }
    return results;
  }

  function fieldFor(path: string) {
    return fields.find((f) => f.ingestPath === path) ?? null;
  }

  function operatorOptions(field: FlatField | null) {
    if (!field) return [{ value: 'eq', label: 'Equals' }];
    if (field.field.modality === 'array') {
      return [
        { value: 'contains', label: 'Contains' },
        { value: 'notContains', label: 'Does not contain' },
        { value: 'containsAny', label: 'Contains any of' },
        { value: 'notContainsAny', label: 'Contains none of' },
        { value: 'exists', label: 'Exists' },
        { value: 'missing', label: 'Is missing' },
      ];
    }
    if (field.field.type === 'number') {
      return [
        { value: 'eq', label: 'Equals' },
        { value: 'ne', label: 'Does not equal' },
        { value: 'gt', label: 'Greater than' },
        { value: 'gte', label: 'Greater than or equal' },
        { value: 'lt', label: 'Less than' },
        { value: 'lte', label: 'Less than or equal' },
        { value: 'exists', label: 'Exists' },
        { value: 'missing', label: 'Is missing' },
      ];
    }
    if (field.field.type === 'boolean' || field.field.type === 'enum') {
      return [
        { value: 'eq', label: 'Equals' },
        { value: 'ne', label: 'Does not equal' },
      ];
    }
    return [
      { value: 'eq', label: 'Equals' },
      { value: 'ne', label: 'Does not equal' },
      { value: 'contains', label: 'Contains' },
      { value: 'notContains', label: 'Does not contain' },
      { value: 'olderThanDays', label: 'Older than days' },
      { value: 'withinDays', label: 'Within days' },
      { value: 'exists', label: 'Exists' },
      { value: 'missing', label: 'Is missing' },
    ];
  }

  function opNeedsValue(op: string) {
    return op !== 'exists' && op !== 'missing';
  }

  function updateCondition(id: string, patch: Partial<ConditionDraft>) {
    filterConditions = filterConditions.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  function removeCondition(id: string) {
    filterConditions = filterConditions.filter((c) => c.id !== id);
  }

  function addCaseCondition(caseId: string) {
    cases = cases.map((c) =>
      c.id === caseId ? { ...c, conditions: [...c.conditions, newCondition()] } : c
    );
  }

  function updateCaseCondition(caseId: string, conditionId: string, patch: Partial<ConditionDraft>) {
    cases = cases.map((c) =>
      c.id === caseId
        ? { ...c, conditions: c.conditions.map((cc) => (cc.id === conditionId ? { ...cc, ...patch } : cc)) }
        : c
    );
  }

  function removeCaseCondition(caseId: string, conditionId: string) {
    cases = cases.map((c) =>
      c.id === caseId
        ? { ...c, conditions: c.conditions.filter((cc) => cc.id !== conditionId) }
        : c
    );
  }

  function updateCaseOutput(id: string, output: string) {
    cases = cases.map((c) => (c.id === id ? { ...c, output } : c));
  }

  function removeCase(id: string) {
    cases = cases.filter((c) => c.id !== id);
  }

  function coerceValue(value: string, field: FlatField | null) {
    if (!field) return value;
    if (field.field.type === 'boolean') return value === 'true';
    if (field.field.type === 'number') return Number(value);
    return value;
  }

  function coerceOutputValue(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    const num = Number(trimmed);
    if (!Number.isNaN(num) && trimmed.length > 0) return num;
    return trimmed;
  }

  function serializeCondition(condition: ConditionDraft) {
    const f = fieldFor(condition.field);
    if (!f) return null;
    if (!opNeedsValue(condition.op)) return { field: f.ingestPath, op: condition.op };
    if (isSetOp(condition.op)) {
      const values = (condition.values ?? []).filter((v) => v.length > 0);
      if (values.length === 0) return null;
      return { field: f.ingestPath, op: condition.op, value: values };
    }
    return { field: f.ingestPath, op: condition.op, value: coerceValue(condition.value, f) };
  }

  function filterFrom(conditions: ConditionDraft[]) {
    const serialized = conditions.map(serializeCondition).filter((c) => c !== null);
    return serialized.length ? { logic: 'AND', conditions: serialized } : undefined;
  }

  function buildDefinition() {
    const base: Record<string, unknown> = {
      table: selectedTable.table,
      aggregate,
      filter: filterFrom(filterConditions),
    };

    if (aggregate === 'exists') {
      if (outputTrue.trim()) base.outputTrue = coerceOutputValue(outputTrue);
      if (outputFalse.trim()) base.outputFalse = coerceOutputValue(outputFalse);
    } else if (aggregate === 'value' || aggregate === 'collect') {
      base.valueField = valueField;
      if (transform !== 'none') base.transform = transform;
    } else if (aggregate === 'conditional') {
      const serializedCases: unknown[] = cases.map((c) => ({
        filter: filterFrom(c.conditions) ?? { logic: 'AND', conditions: [] },
        output: coerceOutputValue(c.output),
      }));
      if (defaultOutput.trim()) {
        serializedCases.push({ default: true, output: coerceOutputValue(defaultOutput) });
      }
      base.cases = serializedCases;
    }

    return base;
  }

  function isRecord(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  }

  function conditionFromDef(condition: unknown): ConditionDraft | null {
    if (!isRecord(condition) || typeof condition.field !== 'string') return null;
    const op = typeof condition.op === 'string' ? condition.op : 'eq';
    const draft: ConditionDraft = { id: `c-${nextId++}`, field: condition.field, op, value: '' };
    if (isSetOp(op)) {
      draft.values = Array.isArray(condition.value) ? condition.value.map(String) : [];
    } else {
      draft.value = condition.value != null ? String(condition.value) : '';
    }
    return draft;
  }

  $effect(() => {
    const rule = ruleQuery.data;
    if (!rule || loadedRuleId === rule.id) return;

    const def = isRecord(rule.definition) ? rule.definition : {};
    name = rule.name;
    description = rule.description ?? '';
    enabled = rule.enabled;
    priority = String(rule.priority);
    table = typeof def.table === 'string' ? def.table : table;
    aggregate = (['exists', 'count', 'value', 'collect', 'conditional'].includes(String(def.aggregate))
      ? def.aggregate
      : 'exists') as typeof aggregate;

    // exists fields
    outputTrue = def.outputTrue != null ? String(def.outputTrue) : '';
    outputFalse = def.outputFalse != null ? String(def.outputFalse) : '';

    // value / collect fields
    valueField = typeof def.valueField === 'string' ? def.valueField : '';
    transform = typeof def.transform === 'string' ? def.transform : 'none';

    // conditional fields
    if (Array.isArray(def.cases)) {
      const loadedCases: FactCase[] = [];
      for (const c of def.cases) {
        if (!isRecord(c)) continue;
        if (c.default === true) {
          defaultOutput = c.output != null ? String(c.output) : '';
        } else {
          const conditions =
            isRecord(c.filter) && Array.isArray(c.filter.conditions)
              ? c.filter.conditions
                  .map(conditionFromDef)
                  .filter((x): x is ConditionDraft => x !== null)
              : [];
          loadedCases.push({ id: `fc-${nextId++}`, conditions, output: c.output != null ? String(c.output) : '' });
        }
      }
      cases = loadedCases;
    }

    const knownKey = catalogFactKeyOptions.find((o) => o.value === rule.factKey);
    if (knownKey) {
      factKey = rule.factKey;
    } else {
      factKey = '__custom__';
      customFactKey = rule.factKey;
    }

    if (isRecord(def.filter) && Array.isArray(def.filter.conditions)) {
      filterConditions = def.filter.conditions
        .map(conditionFromDef)
        .filter((c): c is ConditionDraft => c !== null);
    } else {
      filterConditions = [];
    }

    loadedRuleId = rule.id;
  });

  async function save() {
    const key = effectiveFactKey.trim();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!key) { toast.error('Fact key is required'); return; }
    if ((aggregate === 'value' || aggregate === 'collect') && !valueField) {
      toast.error('Value field is required for this aggregate type');
      return;
    }
    saving = true;
    try {
      const payload = {
        name,
        description: description || null,
        enabled,
        providerId: selectedTable.providerId ?? null,
        factKey: key,
        priority: Number(priority) || 0,
        definition: buildDefinition(),
      };
      if (editing) {
        await trpc.factRules.update.mutate({ id: ruleId, ...payload });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['factRules.byId', ruleId] }),
          queryClient.invalidateQueries({ queryKey: ['factRules.list'] }),
        ]);
        toast.success('Fact rule saved');
        await goto(`/automation/fact-rules/${ruleId}`);
      } else {
        const created = await trpc.factRules.create.mutate(payload);
        toast.success('Fact rule created');
        await goto(`/automation/fact-rules/${created.id}`);
      }
    } catch (error) {
      showErrorToast(error, 'Failed to save fact rule.');
    } finally {
      saving = false;
    }
  }
</script>

{#snippet conditionRow(
  condition: ConditionDraft,
  onUpdate: (patch: Partial<ConditionDraft>) => void,
  onRemove: () => void
)}
  {@const selectedField = fieldFor(condition.field)}
  {@const ops = operatorOptions(selectedField)}
  <div class="grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-[minmax(0,1fr)_190px_minmax(0,1fr)_36px]">
    <SingleSelect
      options={fieldOptions}
      selected={condition.field}
      placeholder="Select field"
      onchange={(field) => {
        const f = fieldFor(field);
        onUpdate({ field, op: operatorOptions(f)[0]?.value ?? 'eq', value: '' });
      }}
    />
    <SingleSelect
      options={ops}
      selected={condition.op}
      disabled={!selectedField}
      onchange={(op) => onUpdate({ op, value: '', values: [] })}
    />
    {#if selectedField && opNeedsValue(condition.op)}
      {#if selectedField.field.type === 'boolean'}
        <SingleSelect
          options={booleanOptions}
          selected={condition.value}
          placeholder="Select value"
          onchange={(value) => onUpdate({ value })}
        />
      {:else if selectedField.field.options}
        <SingleSelect
          options={selectedField.field.options}
          selected={condition.value}
          placeholder="Select value"
          onchange={(value) => onUpdate({ value })}
        />
      {:else}
        <Input
          value={condition.value}
          type={selectedField.field.type === 'number' ? 'number' : 'text'}
          placeholder="Value"
          oninput={(e) => onUpdate({ value: e.currentTarget.value })}
        />
      {/if}
    {:else}
      <div></div>
    {/if}
    <Button variant="ghost" size="icon" onclick={onRemove}>
      <Trash2 class="size-4" />
    </Button>
  </div>
{/snippet}

<div class="flex size-full flex-col overflow-hidden">
  <!-- Header -->
  <header class="border-b bg-background">
    <div class="flex flex-wrap items-center gap-3 px-6 py-3">
      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => goto(editing ? `/automation/fact-rules/${ruleId}` : '/automation/fact-rules')}
      >
        <ArrowLeft class="size-3.5" />
        {editing ? 'Back to rule' : 'All fact rules'}
      </button>
      <div class="mx-2 h-5 w-px bg-border"></div>
      <Input
        placeholder="Rule name"
        bind:value={name}
        class="h-9 w-full max-w-sm text-base font-semibold"
      />
      <div class="ml-auto flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
          <Switch bind:checked={enabled} />
          {enabled ? 'Enabled' : 'Disabled'}
        </label>
        <Button onclick={save} disabled={saving || (editing && ruleQuery.isLoading)} class="gap-2">
          <Save class="size-4" />
          {editing ? 'Save Rule' : 'Create Rule'}
        </Button>
      </div>
    </div>
  </header>

  <!-- Two-pane body -->
  <div class="grid min-h-0 flex-1 grid-cols-[360px_1fr]">

    <!-- Left: Identity + Output -->
    <aside class="flex min-h-0 flex-col overflow-y-auto border-r">
      <div class="border-b px-4 py-3 bg-muted/30">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Identity</p>
      </div>
      <div class="space-y-4 p-4">
        <div class="space-y-1.5">
          <label class="text-sm font-medium">Description</label>
          <Textarea bind:value={description} placeholder="What does this rule populate?" rows={3} />
        </div>
        <div class="space-y-1.5">
          <label class="text-sm font-medium">Priority</label>
          <Input bind:value={priority} type="number" placeholder="0" />
          <p class="text-xs text-muted-foreground">Lower number = higher priority when multiple rules target the same fact key.</p>
        </div>
      </div>

      <div class="border-b border-t px-4 py-3 bg-muted/30">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Output</p>
        <p class="mt-0.5 text-xs text-muted-foreground">Which site fact this rule writes to and how.</p>
      </div>
      <div class="space-y-4 p-4">
        <div class="space-y-1.5">
          <label class="text-sm font-medium">Fact key</label>
          <SingleSelect
            options={[...catalogFactKeyOptions, { value: '__custom__', label: 'Custom key…' }]}
            bind:selected={factKey}
            placeholder="Select a fact key"
          />
          {#if factKey === '__custom__'}
            <Input bind:value={customFactKey} placeholder="e.g. sophos_license_type" class="mt-2" />
          {/if}
          <p class="text-xs text-muted-foreground">The key of the site profile fact to write.</p>
        </div>

        <div class="space-y-1.5">
          <label class="text-sm font-medium">Aggregate</label>
          <SingleSelect options={aggregateOptions} bind:selected={aggregate} />
        </div>

        {#if aggregate === 'exists'}
          <div class="space-y-1.5">
            <label class="text-sm font-medium">When matched</label>
            <Input bind:value={outputTrue} placeholder="true" />
            <p class="text-xs text-muted-foreground">Written when at least one row passes the filter. Defaults to <code>true</code> if left empty.</p>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">When not matched</label>
            <Input bind:value={outputFalse} placeholder="false" />
            <p class="text-xs text-muted-foreground">Written when no rows pass the filter. Defaults to <code>false</code> if left empty.</p>
          </div>

        {:else if aggregate === 'value' || aggregate === 'collect'}
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Value field</label>
            <SingleSelect
              options={fieldOptions}
              bind:selected={valueField}
              placeholder="Select field to extract"
            />
            <p class="text-xs text-muted-foreground">
              {aggregate === 'value'
                ? 'Field value from the first matching row.'
                : 'Unique values of this field across all matching rows.'}
            </p>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Transform</label>
            <SingleSelect options={transformOptions} bind:selected={transform} />
            <p class="text-xs text-muted-foreground">Applied to each extracted value before writing.</p>
          </div>

        {:else if aggregate === 'conditional'}
          <div class="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Define cases in the right panel. Each case is checked in order; the first match wins.
          </div>
        {/if}
      </div>
    </aside>

    <!-- Right: Data Source + Filter (+ Cases for conditional) -->
    <div class="flex min-h-0 flex-col overflow-y-auto">
      <div class="border-b px-4 py-3 bg-muted/30">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Data Source</p>
      </div>
      <div class="p-4 border-b">
        <div class="space-y-1.5 max-w-sm">
          <label class="text-sm font-medium">Source table</label>
          <SingleSelect
            options={tableOptions}
            bind:selected={table}
            onchange={() => { filterConditions = []; valueField = ''; cases = []; }}
          />
          <p class="text-xs text-muted-foreground">Changing this resets all filters and the value field.</p>
        </div>
      </div>

      <div class="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Candidate Filter</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Narrows which {selectedTable.label} rows are in scope. Leave empty to include all.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0 gap-2"
          onclick={() => (filterConditions = [...filterConditions, newCondition()])}
        >
          <Plus class="size-4" /> Add Filter
        </Button>
      </div>
      <div class="space-y-2 p-4 border-b">
        {#each filterConditions as condition (condition.id)}
          {@render conditionRow(
            condition,
            (patch) => updateCondition(condition.id, patch),
            () => removeCondition(condition.id)
          )}
        {:else}
          <div class="rounded-lg border border-dashed py-5 text-center text-sm text-muted-foreground">
            All {selectedTable.label} rows in scope are included.
          </div>
        {/each}
      </div>

      {#if aggregate === 'conditional'}
        <div class="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Cases</p>
            <p class="mt-0.5 text-xs text-muted-foreground">Evaluated top-to-bottom. First matching case wins.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0 gap-2"
            onclick={() => (cases = [...cases, newCase()])}
          >
            <Plus class="size-4" /> Add Case
          </Button>
        </div>
        <div class="space-y-4 p-4">
          {#each cases as fc, idx (fc.id)}
            <div class="rounded-lg border">
              <div class="flex items-center justify-between border-b px-3 py-2 bg-muted/20">
                <p class="text-xs font-semibold text-muted-foreground">Case {idx + 1}</p>
                <Button variant="ghost" size="icon" class="size-7" onclick={() => removeCase(fc.id)}>
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
              <div class="space-y-3 p-3">
                <div>
                  <div class="mb-2 flex items-center justify-between">
                    <p class="text-xs font-medium text-muted-foreground">Conditions</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 gap-1 text-xs"
                      onclick={() => addCaseCondition(fc.id)}
                    >
                      <Plus class="size-3" /> Add condition
                    </Button>
                  </div>
                  <div class="space-y-2">
                    {#each fc.conditions as condition (condition.id)}
                      {@render conditionRow(
                        condition,
                        (patch) => updateCaseCondition(fc.id, condition.id, patch),
                        () => removeCaseCondition(fc.id, condition.id)
                      )}
                    {:else}
                      <p class="text-xs italic text-muted-foreground">No conditions — this case always matches.</p>
                    {/each}
                  </div>
                </div>
                <div class="space-y-1">
                  <label class="text-xs font-medium">Output value</label>
                  <Input
                    value={fc.output}
                    placeholder="e.g. MDR"
                    oninput={(e) => updateCaseOutput(fc.id, e.currentTarget.value)}
                  />
                </div>
              </div>
            </div>
          {:else}
            <div class="rounded-lg border border-dashed py-5 text-center text-sm text-muted-foreground">
              No cases yet. Add at least one case.
            </div>
          {/each}

          <!-- Default case -->
          <div class="rounded-lg border">
            <div class="border-b px-3 py-2 bg-muted/20">
              <p class="text-xs font-semibold text-muted-foreground">Default (no match)</p>
            </div>
            <div class="space-y-1 p-3">
              <label class="text-xs font-medium">Output value</label>
              <Input bind:value={defaultOutput} placeholder="e.g. EDR — leave empty to write nothing" />
              <p class="text-xs text-muted-foreground">Used when no case matches. Leave empty to skip writing.</p>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
