<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { Plus, Save, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { PolicyScopeTags, PolicyTableShapes, type FieldDefinition, type PolicyTableShape } from '@mspbyte/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import TagInserter from '$lib/components/tag-inserter.svelte';

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
  };

  type ConditionKind = 'candidates' | 'expectations';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  let nextId = 1;
  let saving = $state(false);
  let name = $state('');
  let description = $state('');
  let category = $state('Operational');
  let enabled = $state(true);
  let severity = $state('3');
  let table = $state(PolicyTableShapes[0]?.table ?? 'assets');
  let mode = $state<'rowExpectation' | 'tableThreshold'>('rowExpectation');
  let candidateConditions = $state<ConditionDraft[]>([]);
  let expectationConditions = $state<ConditionDraft[]>([newCondition()]);
  let threshold = $state('1');
  let outputResource = $state('source');
  let titleTemplate = $state('{{hostname}}{{displayName}}{{name}} failed policy expectation');
  let summary = $state('');
  let recommendation = $state('');
  let titleRef = $state<HTMLInputElement | null>(null);
  let summaryRef = $state<HTMLTextAreaElement | null>(null);
  let recommendationRef = $state<HTMLTextAreaElement | null>(null);

  const selectedTable = $derived.by<PolicyTableShape>(() => {
    return PolicyTableShapes.find((shape) => shape.table === table) ?? PolicyTableShapes[0]!;
  });

  const fields = $derived.by<FlatField[]>(() => flattenFields(selectedTable.shape));
  const fieldOptions = $derived(fields.map((field) => ({ value: field.ingestPath, label: field.label })));
  const tagGroups = $derived.by(() => {
    const rowGroup = {
      heading: `${selectedTable.label} fields`,
      tags: fields.map((field) => ({ label: field.label, ingestPath: field.ingestPath }))
    };
    const scopeByGroup = new Map<string, { label: string; ingestPath: string }[]>();
    for (const tag of PolicyScopeTags) {
      const list = scopeByGroup.get(tag.group) ?? [];
      list.push({ label: tag.label, ingestPath: tag.ingestPath });
      scopeByGroup.set(tag.group, list);
    }
    const scopeGroups = Array.from(scopeByGroup, ([heading, tags]) => ({ heading, tags }));
    return [rowGroup, ...scopeGroups];
  });
  const outputOptions = $derived.by(() => [
    { value: 'source', label: selectedTable.label },
    ...(selectedTable.canonicalResourceTypes ?? []).map((type) => ({
      value: type,
      label: type === 'person' ? 'Linked canonical Person' : 'Linked canonical Asset'
    }))
  ]);
  const severityOptions = [
    { value: '4', label: 'Critical' },
    { value: '3', label: 'High' },
    { value: '2', label: 'Medium' },
    { value: '1', label: 'Low' }
  ];
  const tableOptions = PolicyTableShapes.map((shape) => ({ value: shape.table, label: shape.label }));
  const modeOptions = [
    { value: 'rowExpectation', label: 'Every matching row must pass' },
    { value: 'tableThreshold', label: 'Matching row count threshold' }
  ];
  const booleanOptions = [
    { value: 'true', label: 'True' },
    { value: 'false', label: 'False' }
  ];

  function newCondition(): ConditionDraft {
    return { id: `condition-${nextId++}`, field: '', op: 'eq', value: '' };
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
    return fields.find((field) => field.ingestPath === path) ?? null;
  }

  function operatorOptions(field: FlatField | null) {
    if (!field) return [{ value: 'eq', label: 'Equals' }];
    if (field.field.modality === 'array') {
      return [
        { value: 'contains', label: 'Contains' },
        { value: 'notContains', label: 'Does not contain' },
        { value: 'exists', label: 'Exists' },
        { value: 'missing', label: 'Is missing' }
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
        { value: 'missing', label: 'Is missing' }
      ];
    }
    if (field.field.type === 'boolean' || field.field.type === 'enum') {
      return [
        { value: 'eq', label: 'Equals' },
        { value: 'ne', label: 'Does not equal' }
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
      { value: 'missing', label: 'Is missing' }
    ];
  }

  function opNeedsValue(op: string) {
    return op !== 'exists' && op !== 'missing';
  }

  function updateCondition(kind: ConditionKind, id: string, patch: Partial<ConditionDraft>) {
    const update = (condition: ConditionDraft) =>
      condition.id === id ? { ...condition, ...patch } : condition;
    if (kind === 'candidates') candidateConditions = candidateConditions.map(update);
    else expectationConditions = expectationConditions.map(update);
  }

  function addCondition(kind: ConditionKind) {
    if (kind === 'candidates') candidateConditions = [...candidateConditions, newCondition()];
    else expectationConditions = [...expectationConditions, newCondition()];
  }

  function removeCondition(kind: ConditionKind, id: string) {
    if (kind === 'candidates') {
      candidateConditions = candidateConditions.filter((condition) => condition.id !== id);
    } else {
      expectationConditions = expectationConditions.filter((condition) => condition.id !== id);
    }
  }

  function resetForTable() {
    candidateConditions = [];
    expectationConditions = [newCondition()];
    outputResource = 'source';
  }

  function coerceValue(value: string, field: FlatField | null) {
    if (!field) return value;
    if (field.field.type === 'boolean') return value === 'true';
    if (field.field.type === 'number') return Number(value);
    return value;
  }

  function serializeCondition(condition: ConditionDraft) {
    const field = fieldFor(condition.field);
    if (!field) return null;
    if (!opNeedsValue(condition.op)) return { field: field.ingestPath, op: condition.op };
    return {
      field: field.ingestPath,
      op: condition.op,
      value: coerceValue(condition.value, field)
    };
  }

  function serializeConditions(conditions: ConditionDraft[]) {
    return conditions.map(serializeCondition).filter((condition) => condition !== null);
  }

  function filterFrom(conditions: ConditionDraft[]) {
    const serialized = serializeConditions(conditions);
    return serialized.length ? { logic: 'AND', conditions: serialized } : undefined;
  }

  function buildDefinition() {
    const base = {
      kind: mode,
      table: selectedTable.table,
      resourceType: selectedTable.resourceType,
      title: titleTemplate,
      summary,
      scope: { trigger: selectedTable.table },
      filter: filterFrom(candidateConditions),
      expectations: serializeConditions(expectationConditions),
      ...(outputResource !== 'source' ? { canonicalResource: { type: outputResource } } : {})
    };
    if (mode === 'tableThreshold') {
      return { ...base, threshold: Number(threshold) };
    }
    return base;
  }

  async function savePolicy() {
    if (!name.trim()) {
      toast.error('Policy name is required');
      return;
    }
    if (mode === 'rowExpectation' && serializeConditions(expectationConditions).length === 0) {
      toast.error('Add at least one rule');
      return;
    }
    if (mode === 'tableThreshold' && Number.isNaN(Number(threshold))) {
      toast.error('Threshold must be a number');
      return;
    }
    saving = true;
    try {
      const created = await trpc.policies.create.mutate({
        name,
        description: description || null,
        category: category || null,
        providerId: selectedTable.providerId ?? null,
        targetType: outputResource === 'source' ? selectedTable.targetType : outputResource === 'person' ? 'person' : 'asset',
        severity: Number(severity),
        enabled,
        recommendation: recommendation || null,
        definition: buildDefinition()
      });
      toast.success('Policy created');
      await goto(`/policies/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create policy');
    } finally {
      saving = false;
    }
  }
</script>

{#snippet conditionEditor(kind: ConditionKind, condition: ConditionDraft)}
  {@const selectedField = fieldFor(condition.field)}
  {@const ops = operatorOptions(selectedField)}
  <div class="grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_190px_minmax(0,1fr)_36px]">
    <SingleSelect
      options={fieldOptions}
      selected={condition.field}
      placeholder="Select field"
      onchange={(field) => {
        const selected = fieldFor(field);
        updateCondition(kind, condition.id, {
          field,
          op: operatorOptions(selected)[0]?.value ?? 'eq',
          value: ''
        });
      }}
    />
    <SingleSelect
      options={ops}
      selected={condition.op}
      disabled={!selectedField}
      onchange={(op) => updateCondition(kind, condition.id, { op, value: '' })}
    />
    {#if selectedField && opNeedsValue(condition.op)}
      {#if selectedField.field.type === 'boolean'}
        <SingleSelect
          options={booleanOptions}
          selected={condition.value}
          placeholder="Select value"
          onchange={(value) => updateCondition(kind, condition.id, { value })}
        />
      {:else if selectedField.field.options}
        <SingleSelect
          options={selectedField.field.options}
          selected={condition.value}
          placeholder="Select value"
          onchange={(value) => updateCondition(kind, condition.id, { value })}
        />
      {:else}
        <Input
          value={condition.value}
          type={selectedField.field.type === 'number' ? 'number' : 'text'}
          placeholder="Value"
          oninput={(event) => updateCondition(kind, condition.id, { value: event.currentTarget.value })}
        />
      {/if}
    {:else}
      <div></div>
    {/if}
    <Button variant="ghost" size="icon" onclick={() => removeCondition(kind, condition.id)}>
      <Trash2 class="size-4" />
    </Button>
  </div>
{/snippet}

<div class="size-full overflow-auto p-6">
  <div class="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
    <Card.Root>
      <Card.Header>
        <Card.Title>New Policy</Card.Title>
        <Card.Description>Build a typed policy definition from canonical and vendor table shapes.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="grid gap-1 text-sm font-medium">Name<Input bind:value={name} placeholder="Server assets must have Sophos" /></label>
          <label class="grid gap-1 text-sm font-medium">Category<Input bind:value={category} /></label>
          <label class="grid gap-1 text-sm font-medium md:col-span-2">Description<Input bind:value={description} /></label>
          <label class="grid gap-1 text-sm font-medium">Severity
            <SingleSelect options={severityOptions} bind:selected={severity} />
          </label>
          <div class="flex items-end gap-3 rounded-md border px-3 py-2">
            <Switch bind:checked={enabled} />
            <span class="text-sm font-medium">Enabled</span>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-3">
          <label class="grid gap-1 text-sm font-medium">Initial scope
            <SingleSelect options={tableOptions} bind:selected={table} onchange={resetForTable} />
          </label>
          <label class="grid gap-1 text-sm font-medium">Evaluation
            <SingleSelect options={modeOptions} bind:selected={mode} />
          </label>
          <label class="grid gap-1 text-sm font-medium">Finding resource
            <SingleSelect options={outputOptions} bind:selected={outputResource} />
          </label>
        </div>

        <div class="grid gap-3 rounded-md border p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm font-medium">Rows to evaluate</div>
              <div class="text-xs text-muted-foreground">Filter that narrows which rows are loaded. Pushed to SQL when possible.</div>
            </div>
            <Button variant="outline" size="sm" class="gap-2" onclick={() => addCondition('candidates')}>
              <Plus class="size-4" />
              Add Filter
            </Button>
          </div>
          {#each candidateConditions as condition (condition.id)}
            {@render conditionEditor('candidates', condition)}
          {:else}
            <div class="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">All rows in this scope are included.</div>
          {/each}
        </div>

        <div class="grid gap-3 rounded-md border p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm font-medium">{mode === 'tableThreshold' ? 'Rules a row must satisfy to count' : 'Rules each row must satisfy'}</div>
              <div class="text-xs text-muted-foreground">{mode === 'tableThreshold' ? 'Rows matching all rules count toward the threshold.' : 'A finding is created when any rule fails.'}</div>
            </div>
            <Button variant="outline" size="sm" class="gap-2" onclick={() => addCondition('expectations')}>
              <Plus class="size-4" />
              Add Rule
            </Button>
          </div>
          {#each expectationConditions as condition (condition.id)}
            {@render conditionEditor('expectations', condition)}
          {:else}
            <div class="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{mode === 'tableThreshold' ? 'Every scoped row counts toward the threshold.' : 'Add at least one rule.'}</div>
          {/each}
        </div>

        {#if mode === 'tableThreshold'}
          <label class="grid gap-1 text-sm font-medium">Minimum matching rows
            <Input bind:value={threshold} type="number" min="0" />
          </label>
        {/if}

        <div class="grid gap-3">
          <div class="grid gap-1 text-sm">
            <div class="flex items-center justify-between">
              <span class="font-medium">Finding title template</span>
              <TagInserter groups={tagGroups} target={titleRef} bind:value={titleTemplate} />
            </div>
            <Input bind:ref={titleRef} bind:value={titleTemplate} />
          </div>
          <div class="grid gap-1 text-sm">
            <div class="flex items-center justify-between">
              <span class="font-medium">Summary</span>
              <TagInserter groups={tagGroups} target={summaryRef} bind:value={summary} />
            </div>
            <Textarea bind:ref={summaryRef} bind:value={summary} />
          </div>
          <div class="grid gap-1 text-sm">
            <div class="flex items-center justify-between">
              <span class="font-medium">Recommendation</span>
              <TagInserter groups={tagGroups} target={recommendationRef} bind:value={recommendation} />
            </div>
            <Textarea bind:ref={recommendationRef} bind:value={recommendation} />
          </div>
        </div>
      </Card.Content>
      <Card.Footer class="gap-2">
        <Button variant="outline" onclick={() => goto('/policies')}>Cancel</Button>
        <Button onclick={savePolicy} disabled={saving} class="gap-2"><Save class="size-4" />Create Policy</Button>
      </Card.Footer>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>Definition Preview</Card.Title>
        <Card.Description>The JSON stored on the policy and consumed by the policy worker.</Card.Description>
      </Card.Header>
      <Card.Content>
        <pre class="max-h-[620px] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(buildDefinition(), null, 2)}</pre>
      </Card.Content>
    </Card.Root>
  </div>
</div>
