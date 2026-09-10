<script lang="ts">
  import '../../workspace.css';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ArrowLeft, ArrowUp, ArrowDown, Plus, Save, Trash2 } from '@lucide/svelte';
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
    logic: 'AND' | 'OR';
    output: string;
  };

  function isSetOp(op: string) {
    return op === 'containsAny' || op === 'notContainsAny';
  }

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const ruleId = $derived(page.url.searchParams.get('id') ?? '');
  const editing = $derived(Boolean(ruleId));
  const canWrite = $derived(authStore.isAllowed('Policies.Write'));

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
  let filterLogic = $state<'AND' | 'OR'>('AND');
  const logicOptions = [
    { value: 'AND', label: 'Match all conditions' },
    { value: 'OR', label: 'Match any condition' },
  ];
  let filterConditions = $state<ConditionDraft[]>([]);

  const selectedTable = $derived.by<PolicyTableShape>(() => {
    return PolicyTableShapes.find((s) => s.table === table) ?? PolicyTableShapes[0]!;
  });

  const fields = $derived.by<FlatField[]>(() => flattenFields(selectedTable.shape));
  const fieldOptions = $derived(fields.map((f) => ({ value: f.ingestPath, label: f.label })));
  const tableOptions = PolicyTableShapes.map((s) => ({ value: s.table, label: s.label }));

  const aggregateOptions = [
    { value: 'exists', label: 'Check whether a match exists' },
    { value: 'count', label: 'Count matching records' },
    { value: 'value', label: 'Use a field from the first match' },
    { value: 'collect', label: 'Collect unique field values' },
    { value: 'conditional', label: 'Choose a value using ordered cases' },
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
    const catalogFields =
      (catalog as { fields?: { key: string; label: string; valueTypeLabel?: string }[] }).fields ??
      [];
    return catalogFields.map((f) => ({
      value: f.key,
      label: f.label,
      subLabel: f.valueTypeLabel ?? f.key,
    }));
  });

  const effectiveFactKey = $derived(factKey === '__custom__' ? customFactKey : factKey);

  const booleanOptions = [
    { value: 'true', label: 'Yes' },
    { value: 'false', label: 'No' },
  ];

  function newCondition(): ConditionDraft {
    return { id: `c-${nextId++}`, field: '', op: 'eq', value: '' };
  }

  function newCase(): FactCase {
    return { id: `fc-${nextId++}`, conditions: [], logic: 'AND', output: '' };
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

  function updateCaseCondition(
    caseId: string,
    conditionId: string,
    patch: Partial<ConditionDraft>
  ) {
    cases = cases.map((c) =>
      c.id === caseId
        ? {
            ...c,
            conditions: c.conditions.map((cc) =>
              cc.id === conditionId ? { ...cc, ...patch } : cc
            ),
          }
        : c
    );
  }

  function removeCaseCondition(caseId: string, conditionId: string) {
    cases = cases.map((c) =>
      c.id === caseId ? { ...c, conditions: c.conditions.filter((cc) => cc.id !== conditionId) } : c
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

  function filterFrom(conditions: ConditionDraft[], logic: 'AND' | 'OR' = 'AND') {
    const serialized = conditions.map(serializeCondition).filter((c) => c !== null);
    return serialized.length ? { logic, conditions: serialized } : undefined;
  }

  function buildDefinition() {
    const base: Record<string, unknown> = {
      table: selectedTable.table,
      aggregate,
      filter: filterFrom(filterConditions, filterLogic),
    };

    if (aggregate === 'exists') {
      if (outputTrue.trim()) base.outputTrue = coerceOutputValue(outputTrue);
      if (outputFalse.trim()) base.outputFalse = coerceOutputValue(outputFalse);
    } else if (aggregate === 'value' || aggregate === 'collect') {
      base.valueField = valueField;
      if (transform !== 'none') base.transform = transform;
    } else if (aggregate === 'conditional') {
      const serializedCases: unknown[] = cases.map((c) => ({
        filter: filterFrom(c.conditions, c.logic) ?? { logic: 'AND', conditions: [] },
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
    cases = [];
    defaultOutput = '';
    filterLogic = isRecord(def.filter) && def.filter.logic === 'OR' ? 'OR' : 'AND';
    name = rule.name;
    description = rule.description ?? '';
    enabled = rule.enabled;
    priority = String(rule.priority);
    table = typeof def.table === 'string' ? def.table : table;
    aggregate = (
      ['exists', 'count', 'value', 'collect', 'conditional'].includes(String(def.aggregate))
        ? def.aggregate
        : 'exists'
    ) as typeof aggregate;

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
          loadedCases.push({
            id: `fc-${nextId++}`,
            conditions,
            logic: isRecord(c.filter) && c.filter.logic === 'OR' ? 'OR' : 'AND',
            output: c.output != null ? String(c.output) : '',
          });
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

  function moveCase(index: number, offset: number) {
    const next = [...cases];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    cases = next;
  }
  const setupIssues = $derived.by(() => {
    const issues: string[] = [];
    if (!name.trim()) issues.push('Give this rule a name.');
    if (!effectiveFactKey.trim()) issues.push('Choose the site profile field to update.');
    if (!Number.isInteger(Number(priority))) issues.push('Enter a whole number for priority.');
    if ((aggregate === 'value' || aggregate === 'collect') && !fieldFor(valueField))
      issues.push('Choose the field to read from each match.');
    if (aggregate === 'conditional' && !cases.length) issues.push('Add at least one case.');
    const groups = [
      { label: 'Record filter', conditions: filterConditions },
      ...(aggregate === 'conditional'
        ? cases.map((c, i) => ({ label: `Case ${i + 1}`, conditions: c.conditions }))
        : []),
    ];
    for (const group of groups)
      for (const condition of group.conditions) {
        const field = fieldFor(condition.field);
        if (!field) {
          issues.push(`${group.label}: choose an available field.`);
          continue;
        }
        if (!operatorOptions(field).some((o) => o.value === condition.op))
          issues.push(`${group.label}: choose a supported comparison.`);
        if (opNeedsValue(condition.op)) {
          if (isSetOp(condition.op)) {
            if (!(condition.values ?? []).some((v) => v.trim()))
              issues.push(`${group.label}: enter at least one comparison value.`);
          } else if (
            condition.value === '' ||
            (field.field.type === 'number' && !Number.isFinite(Number(condition.value)))
          ) {
            issues.push(`${group.label}: enter a valid comparison value.`);
          }
        }
      }
    return issues;
  });

  async function save() {
    if (!canWrite || saving) return;
    if (setupIssues.length) {
      toast.error(setupIssues[0]);
      return;
    }
    const key = effectiveFactKey.trim();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!key) {
      toast.error('Fact key is required');
      return;
    }
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
  <div class="au-condition-editor">
    <SingleSelect
      options={fieldOptions}
      selected={condition.field}
      aria-label="Condition field"
      placeholder="Choose a field"
      onchange={(field) => {
        const f = fieldFor(field);
        onUpdate({ field, op: operatorOptions(f)[0]?.value ?? 'eq', value: '' });
      }}
    />
    <SingleSelect
      options={ops}
      aria-label="Comparison"
      selected={condition.op}
      disabled={!selectedField}
      onchange={(op) => onUpdate({ op, value: '', values: [] })}
    />
    {#if selectedField && opNeedsValue(condition.op)}
      {#if isSetOp(condition.op)}
        <Input
          aria-label="Comparison values"
          value={(condition.values ?? []).join(', ')}
          placeholder="Values separated by commas"
          oninput={(e) =>
            onUpdate({ values: e.currentTarget.value.split(',').map((v) => v.trim()) })}
        />
      {:else if selectedField.field.type === 'boolean'}
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
    <Button variant="ghost" size="icon" aria-label="Remove condition" onclick={onRemove}>
      <Trash2 class="size-4" />
    </Button>
  </div>
{/snippet}

{#if editing && ruleQuery.isLoading}
  <div class="au-page"><p class="text-sm text-muted-foreground">Loading rule…</p></div>
{:else if editing && (ruleQuery.error || !ruleQuery.data)}
  <div class="au-page">
    <div class="au-error" role="alert">
      <h2>We couldn’t load this rule</h2>
      <p>Return to fact rules, or try loading it again.</p>
      <div class="flex gap-2">
        <Button variant="outline" href="/automation/fact-rules">All fact rules</Button><Button
          onclick={() => ruleQuery.refetch()}>Try again</Button
        >
      </div>
    </div>
  </div>
{:else}
  <div class="au-rule-editor">
    <header>
      <div class="flex flex-wrap items-center gap-3 px-6 py-4">
        <a
          class="inline-flex items-center gap-2 text-sm text-muted-foreground"
          href={editing ? `/automation/fact-rules/${ruleId}` : '/automation/fact-rules'}
          ><ArrowLeft size={15} />{editing ? 'Back to rule' : 'All fact rules'}</a
        >
        <Input
          aria-label="Rule name"
          placeholder="Name your rule"
          bind:value={name}
          disabled={!canWrite}
          class="h-9 w-full max-w-sm text-base font-semibold"
        />
        <div class="ml-auto flex items-center gap-3">
          {#if canWrite}<label class="flex items-center gap-2 text-sm"
              ><Switch bind:checked={enabled} />{enabled ? 'Enabled' : 'Disabled'}</label
            ><Button onclick={save} disabled={saving || setupIssues.length > 0} class="gap-2"
              ><Save size={15} />{saving
                ? 'Saving…'
                : editing
                  ? 'Save changes'
                  : 'Create rule'}</Button
            >{:else}<span class="text-xs text-muted-foreground">View only</span>{/if}
        </div>
      </div>
    </header>
    <div class="au-rule-editor-body">
      <aside class="au-rule-plan">
        <p class="au-eyebrow">RULE SUMMARY</p>
        <h2>Keep site information current</h2>
        <p>
          This rule reads synced records and updates one site profile field. Changes take effect
          after saving.
        </p>
        <ol>
          <li>
            <span>1 · Read</span><strong>{selectedTable.label}</strong>
            <p>Use the records available for each site after its integration syncs.</p>
          </li>
          <li>
            <span>2 · Match</span><strong
              >{filterConditions.length
                ? `${filterLogic === 'OR' ? 'Any' : 'All'} of ${filterConditions.length} conditions`
                : 'All available records'}</strong
            >
            <p>
              {filterConditions.length
                ? 'Only matching records are used to calculate the result.'
                : 'Add conditions to narrow down which records count.'}
            </p>
          </li>
          <li>
            <span>3 · Update</span><strong
              >{catalogFactKeyOptions.find((o) => o.value === effectiveFactKey)?.label ||
                effectiveFactKey ||
                'Choose a site field'}</strong
            >
            <p>{aggregateOptions.find((o) => o.value === aggregate)?.label}</p>
            {#if aggregate === 'conditional'}<p>
                {cases.length} cases, checked from top to bottom.
              </p>{/if}
          </li>
        </ol>
        {#if setupIssues.length}<div class="au-rule-checks">
            <strong>Before you save</strong>
            <ul>
              {#each setupIssues as issue}<li>{issue}</li>{/each}
            </ul>
          </div>{:else}<div class="au-notice au-success mt-6">
            <div>
              <strong>Ready to save</strong>
              <p>
                {enabled
                  ? 'The rule will apply during future data syncs.'
                  : 'The rule will stay disabled until you enable it.'}
              </p>
            </div>
          </div>{/if}
      </aside>
      <fieldset class="au-rule-form min-w-0" disabled={!canWrite || saving}>
        <section>
          <h2>Read from your connected tools</h2>
          <p>Choose the records this rule should use.</p>
          <div class="au-form-grid">
            <div class="au-form-field">
              <label for="rule-source">Data source</label><SingleSelect
                aria-label="Data source"
                options={tableOptions}
                selected={table}
                onchange={(value) => {
                  if (value && value !== table) {
                    table = value;
                    filterConditions = [];
                    valueField = '';
                    cases = [];
                  }
                }}
                allowClear={false}
              />
              <p>Changing the source clears conditions and cases that depend on its fields.</p>
            </div>
            <div class="au-form-field">
              <label for="rule-description">What is this rule for?</label><Textarea
                id="rule-description"
                bind:value={description}
                placeholder="e.g. Keep the client’s security product up to date"
                rows={3}
              />
            </div>
          </div>
        </section>
        <section>
          <div class="au-section-heading">
            <h2>Choose which records match</h2>
            <Button
              variant="outline"
              size="sm"
              class="gap-2"
              onclick={() => (filterConditions = [...filterConditions, newCondition()])}
              ><Plus size={14} /> Add condition</Button
            >
          </div>
          <p>Start with all records, or narrow the result using conditions.</p>
          {#if filterConditions.length > 1}<div class="mb-4 max-w-xs">
              <SingleSelect
                options={logicOptions}
                selected={filterLogic}
                onchange={(v) => (filterLogic = v as 'AND' | 'OR')}
                allowClear={false}
                aria-label="Record matching logic"
              />
            </div>{/if}
          <div class="space-y-3">
            {#each filterConditions as condition (condition.id)}{@render conditionRow(
                condition,
                (patch) => updateCondition(condition.id, patch),
                () => removeCondition(condition.id)
              )}{:else}<div class="au-notice">
                <div>
                  <strong>All {selectedTable.label} records are included</strong>
                  <p>Add a condition if only certain records should affect the site field.</p>
                </div>
              </div>{/each}
          </div>
        </section>
        <section>
          <h2>Update the site profile</h2>
          <p>Choose the destination and how to calculate its value.</p>
          {#if catalogQuery.error}<div class="au-notice au-attention mb-4">
              <div>
                <strong>Site fields couldn’t be loaded</strong>
                <p>Retry to choose a known field, or use a custom field identifier.</p>
              </div>
              <Button variant="outline" onclick={() => catalogQuery.refetch()}>Retry</Button>
            </div>{/if}
          <div class="au-form-grid">
            <div class="au-form-field">
              <label>Site field to update</label><SingleSelect
                aria-label="Site field to update"
                options={[
                  ...catalogFactKeyOptions,
                  { value: '__custom__', label: 'Custom field identifier…' },
                ]}
                selected={factKey}
                onchange={(v) => (factKey = v)}
                placeholder="Choose a site field"
              />{#if factKey === '__custom__'}<Input
                  aria-label="Custom field identifier"
                  bind:value={customFactKey}
                  placeholder="e.g. security_product"
                />{/if}
            </div>
            <div class="au-form-field">
              <label>How should the value be calculated?</label><SingleSelect
                aria-label="Calculation method"
                options={aggregateOptions}
                selected={aggregate}
                onchange={(v) => (aggregate = v as typeof aggregate)}
                allowClear={false}
              />
            </div>
          </div>
          {#if aggregate === 'exists'}<div class="au-form-grid mt-5">
              <div class="au-form-field">
                <label for="rule-yes">When a match is found</label><Input
                  id="rule-yes"
                  bind:value={outputTrue}
                  placeholder="true"
                />
                <p>Leave empty to write Yes (true).</p>
              </div>
              <div class="au-form-field">
                <label for="rule-no">When nothing matches</label><Input
                  id="rule-no"
                  bind:value={outputFalse}
                  placeholder="false"
                />
                <p>Leave empty to write No (false).</p>
              </div>
            </div>
          {:else if aggregate === 'value' || aggregate === 'collect'}<div class="au-form-grid mt-5">
              <div class="au-form-field">
                <label>Read this field</label><SingleSelect
                  aria-label="Result field"
                  options={fieldOptions}
                  selected={valueField}
                  onchange={(v) => (valueField = v)}
                  placeholder="Choose a field"
                />
                <p>
                  {aggregate === 'value'
                    ? 'Use the value from the first matching record.'
                    : 'Save the unique values across matching records.'}
                </p>
              </div>
              <div class="au-form-field">
                <label>Format the result</label><SingleSelect
                  aria-label="Result formatting"
                  options={transformOptions}
                  selected={transform}
                  onchange={(v) => (transform = v)}
                  allowClear={false}
                />
              </div>
            </div>{/if}
        </section>
        {#if aggregate === 'conditional'}
          <section>
            <div class="au-section-heading">
              <h2>Choose a value using cases</h2>
              <Button
                variant="outline"
                size="sm"
                class="gap-2"
                onclick={() => (cases = [...cases, newCase()])}><Plus size={14} /> Add case</Button
              >
            </div>
            <p>The first matching case wins. Move cases to set their priority.</p>
            {#each cases as fc, index (fc.id)}
              <div class="au-result-card mt-4">
                <div class="au-case-toolbar">
                  <h3 class="text-sm font-semibold">Case {index + 1}</h3>
                  <div class="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move case ${index + 1} up`}
                      disabled={index === 0}
                      onclick={() => moveCase(index, -1)}><ArrowUp size={14} /></Button
                    ><Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move case ${index + 1} down`}
                      disabled={index === cases.length - 1}
                      onclick={() => moveCase(index, 1)}><ArrowDown size={14} /></Button
                    ><Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove case ${index + 1}`}
                      onclick={() => removeCase(fc.id)}><Trash2 size={14} /></Button
                    >
                  </div>
                </div>
                {#if fc.conditions.length > 1}<div class="my-3 max-w-xs">
                    <SingleSelect
                      aria-label={`Matching logic for case ${index + 1}`}
                      options={logicOptions}
                      selected={fc.logic}
                      onchange={(v) =>
                        (cases = cases.map((c) =>
                          c.id === fc.id ? { ...c, logic: v as 'AND' | 'OR' } : c
                        ))}
                      allowClear={false}
                    />
                  </div>{/if}
                <div class="space-y-3 my-4">
                  {#each fc.conditions as condition (condition.id)}{@render conditionRow(
                      condition,
                      (patch) => updateCaseCondition(fc.id, condition.id, patch),
                      () => removeCaseCondition(fc.id, condition.id)
                    )}{:else}<p class="text-xs text-[var(--warning)]">
                      This case has no conditions and always matches. Any cases below it will not be
                      reached.
                    </p>{/each}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  class="gap-1"
                  onclick={() => addCaseCondition(fc.id)}><Plus size={13} /> Add condition</Button
                >
                <div class="au-form-field mt-5">
                  <label for={`case-output-${fc.id}`}>Write this value</label><Input
                    id={`case-output-${fc.id}`}
                    value={fc.output}
                    placeholder="e.g. Managed detection and response"
                    oninput={(e) => updateCaseOutput(fc.id, e.currentTarget.value)}
                  />
                </div>
              </div>
            {/each}
            <div class="au-form-field mt-5">
              <label for="rule-default">When no case matches</label><Input
                id="rule-default"
                bind:value={defaultOutput}
                placeholder="Leave empty to keep the current site value"
              />
              <p>An empty fallback leaves the existing site field unchanged.</p>
            </div>
          </section>
        {/if}
        <section>
          <details>
            <summary class="cursor-pointer text-sm font-medium">Advanced · Rule priority</summary>
            <div class="au-form-field mt-4 max-w-sm">
              <label for="rule-priority">Priority</label><Input
                id="rule-priority"
                bind:value={priority}
                type="number"
              />
              <p>
                Lower numbers take priority when more than one rule updates the same site field.
              </p>
            </div>
          </details>
        </section>
      </fieldset>
    </div>
  </div>
{/if}
