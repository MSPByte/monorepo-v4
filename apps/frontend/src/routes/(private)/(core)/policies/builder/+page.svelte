<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Plus, Save, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    PolicyScopeTags,
    PolicyTableShapes,
    type FieldDefinition,
    type PolicyTableShape,
  } from '@mspbyte/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import TagInserter from '$lib/components/tag-inserter.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';

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
  type PolicyDefinition = Record<string, unknown>;

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const policyId = $derived(page.url.searchParams.get('id') ?? '');
  const editing = $derived(Boolean(policyId));
  const policyQuery = createQuery(() => ({
    queryKey: ['policies.byId', policyId],
    queryFn: () => (policyId ? trpc.policies.byId.query({ id: policyId }) : Promise.resolve(null)),
  }));

  let nextId = 1;
  let loadedPolicyId = $state('');
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
  const fieldOptions = $derived(
    fields.map((field) => ({ value: field.ingestPath, label: field.label }))
  );
  const tagGroups = $derived.by(() => {
    const rowGroup = {
      heading: `${selectedTable.label} fields`,
      tags: fields.map((field) => ({ label: field.label, ingestPath: field.ingestPath })),
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
    { value: 'source', label: `Failing ${selectedTable.label} row` },
    ...(selectedTable.canonicalResourceTypes ?? []).map((type) => ({
      value: type,
      label: type === 'person' ? 'Linked Person record' : 'Linked Asset record',
    })),
  ]);
  const severityOptions = [
    { value: '4', label: 'Critical' },
    { value: '3', label: 'High' },
    { value: '2', label: 'Medium' },
    { value: '1', label: 'Low' },
  ];
  const tableOptions = PolicyTableShapes.map((shape) => ({
    value: shape.table,
    label: shape.label,
  }));
  const modeOptions = [
    { value: 'rowExpectation', label: 'Every matching row must pass' },
    { value: 'tableThreshold', label: 'Matching row count threshold' },
  ];
  const booleanOptions = [
    { value: 'true', label: 'True' },
    { value: 'false', label: 'False' },
  ];

  function newCondition(): ConditionDraft {
    return { id: `condition-${nextId++}`, field: '', op: 'eq', value: '' };
  }

  function isRecord(value: unknown): value is PolicyDefinition {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function stringValue(value: unknown) {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  function conditionFromDefinition(condition: unknown): ConditionDraft | null {
    if (!isRecord(condition) || typeof condition.field !== 'string') return null;
    return {
      id: newCondition().id,
      field: condition.field,
      op: typeof condition.op === 'string' ? condition.op : 'eq',
      value: stringValue(condition.value),
    };
  }

  function conditionsFromDefinition(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.map(conditionFromDefinition).filter((condition) => condition !== null);
  }

  function filterConditionsFromDefinition(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.conditions)) return [];
    return conditionsFromDefinition(value.conditions);
  }

  function validMode(value: unknown): value is 'rowExpectation' | 'tableThreshold' {
    return value === 'rowExpectation' || value === 'tableThreshold';
  }

  function validTable(value: unknown): value is string {
    return typeof value === 'string' && PolicyTableShapes.some((shape) => shape.table === value);
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
      value: coerceValue(condition.value, field),
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
      ...(outputResource !== 'source' ? { canonicalResource: { type: outputResource } } : {}),
    };
    if (mode === 'tableThreshold') {
      return { ...base, threshold: Number(threshold) };
    }
    return base;
  }

  $effect(() => {
    const policy = policyQuery.data;
    if (!policy || loadedPolicyId === policy.id) return;

    const definition = isRecord(policy.definition) ? policy.definition : {};
    name = policy.name;
    description = policy.description ?? '';
    category = policy.category ?? 'Operational';
    enabled = policy.enabled;
    severity = String(policy.severity);
    table = validTable(definition.table) ? definition.table : table;
    mode = validMode(definition.kind) ? definition.kind : 'rowExpectation';
    candidateConditions = filterConditionsFromDefinition(definition.filter);
    expectationConditions = conditionsFromDefinition(definition.expectations);
    if (mode === 'rowExpectation' && expectationConditions.length === 0) {
      expectationConditions = [newCondition()];
    }
    threshold = stringValue(definition.threshold ?? 1);
    if (
      isRecord(definition.canonicalResource) &&
      typeof definition.canonicalResource.type === 'string'
    ) {
      outputResource = (selectedTable.canonicalResourceTypes ?? []).includes(
        definition.canonicalResource.type as 'person' | 'asset'
      )
        ? definition.canonicalResource.type
        : 'source';
    } else {
      outputResource = 'source';
    }
    titleTemplate =
      typeof definition.title === 'string'
        ? definition.title
        : '{{hostname}}{{displayName}}{{name}} failed policy expectation';
    summary = typeof definition.summary === 'string' ? definition.summary : '';
    recommendation = policy.recommendation ?? '';
    loadedPolicyId = policy.id;
  });

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
      const payload = {
        name,
        description: description || null,
        category: category || null,
        providerId: selectedTable.providerId ?? null,
        targetType:
          outputResource === 'source'
            ? selectedTable.targetType
            : outputResource === 'person'
              ? 'person'
              : 'asset',
        severity: Number(severity),
        enabled,
        recommendation: recommendation || null,
        definition: buildDefinition(),
      };
      if (editing) {
        await trpc.policies.update.mutate({ id: policyId, ...payload });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['policies.byId', policyId] }),
          queryClient.invalidateQueries({ queryKey: ['policies.list'] }),
          queryClient.invalidateQueries({ queryKey: ['policies.tableData'] }),
        ]);
        toast.success('Policy saved');
        await goto(`/policies/${policyId}`);
      } else {
        const created = await trpc.policies.create.mutate(payload);
        toast.success('Policy created');
        await goto(`/policies/${created.id}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save policy');
    } finally {
      saving = false;
    }
  }
</script>

{#snippet conditionEditor(kind: ConditionKind, condition: ConditionDraft)}
  {@const selectedField = fieldFor(condition.field)}
  {@const ops = operatorOptions(selectedField)}
  <div
    class="grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_190px_minmax(0,1fr)_36px]"
  >
    <SingleSelect
      options={fieldOptions}
      selected={condition.field}
      placeholder="Select field"
      onchange={(field) => {
        const selected = fieldFor(field);
        updateCondition(kind, condition.id, {
          field,
          op: operatorOptions(selected)[0]?.value ?? 'eq',
          value: '',
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
          oninput={(event) =>
            updateCondition(kind, condition.id, { value: event.currentTarget.value })}
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
  <div class="flex size-full gap-2">
    <Card.Root class="w-2/3">
      <Card.Header>
        <Card.Title>{editing ? 'Edit Policy' : 'New Policy'}</Card.Title>
        <Card.Description
          >Build a typed policy definition from canonical and vendor table shapes.</Card.Description
        >
      </Card.Header>
      <Separator />
      <Card.Content class="grid gap-4 overflow-auto">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="grid gap-1 text-sm font-medium"
            >Name<Input bind:value={name} placeholder="Server assets must have Sophos" /></label
          >
          <div class="flex w-full gap-2">
            <label class="flex flex-col gap-1 w-full">
              Category
              <Input bind:value={category} /></label
            >
            <div class="flex flex-col w-fit h-fit gap-3">
              <span class="text-sm font-medium">Enabled</span>
              <Switch bind:checked={enabled} />
            </div>
          </div>
          <div class="flex col-span-2 gap-4">
            <label class="flex flex-col gap-1 w-full text-sm font-medium"
              >Description<Input bind:value={description} /></label
            >
            <label class="flex flex-col gap-1 w-48 text-sm font-medium"
              >Severity
              <SingleSelect options={severityOptions} bind:selected={severity} />
            </label>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-3">
          <label class="grid gap-1 text-sm font-medium"
            >Data source
            <SingleSelect options={tableOptions} bind:selected={table} onchange={resetForTable} />
          </label>
          <label class="grid gap-1 text-sm font-medium"
            >Evaluation
            <SingleSelect options={modeOptions} bind:selected={mode} />
          </label>
          {#if outputOptions.length > 1}
            <label class="grid gap-1 text-sm font-medium"
              >Finding resource
              <SingleSelect options={outputOptions} bind:selected={outputResource} />
            </label>
          {:else}
            <div class="grid gap-1 text-sm">
              <div class="font-medium">Finding resource</div>
              <div class="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground">
                Findings attach to the failing {selectedTable.label} row.
              </div>
            </div>
          {/if}
        </div>

        <div class="grid gap-3 rounded-md border p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm font-medium">Rows to evaluate</div>
              <div class="text-xs text-muted-foreground">
                Filter that narrows which rows are loaded. Pushed to SQL when possible.
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="gap-2"
              onclick={() => addCondition('candidates')}
            >
              <Plus class="size-4" />
              Add Filter
            </Button>
          </div>
          {#each candidateConditions as condition (condition.id)}
            {@render conditionEditor('candidates', condition)}
          {:else}
            <div
              class="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
            >
              All rows in this scope are included.
            </div>
          {/each}
        </div>

        <div class="grid gap-3 rounded-md border p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm font-medium">
                {mode === 'tableThreshold'
                  ? 'Rules a row must satisfy to count'
                  : 'Rules each row must satisfy'}
              </div>
              <div class="text-xs text-muted-foreground">
                {mode === 'tableThreshold'
                  ? 'Rows matching all rules count toward the threshold.'
                  : 'A finding is created when any rule fails.'}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="gap-2"
              onclick={() => addCondition('expectations')}
            >
              <Plus class="size-4" />
              Add Rule
            </Button>
          </div>
          {#each expectationConditions as condition (condition.id)}
            {@render conditionEditor('expectations', condition)}
          {:else}
            <div
              class="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
            >
              {mode === 'tableThreshold'
                ? 'Every scoped row counts toward the threshold.'
                : 'Add at least one rule.'}
            </div>
          {/each}
        </div>

        {#if mode === 'tableThreshold'}
          <label class="grid gap-1 text-sm font-medium"
            >Minimum matching rows
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
              <TagInserter
                groups={tagGroups}
                target={recommendationRef}
                bind:value={recommendation}
              />
            </div>
            <Textarea bind:ref={recommendationRef} bind:value={recommendation} />
          </div>
        </div>
      </Card.Content>
      <Card.Footer class="mt-auto gap-2">
        <Button
          variant="outline"
          onclick={() => goto(editing ? `/policies/${policyId}` : '/policies')}>Cancel</Button
        >
        <Button
          onclick={savePolicy}
          disabled={saving || (editing && policyQuery.isLoading)}
          class="gap-2"><Save class="size-4" />{editing ? 'Save Policy' : 'Create Policy'}</Button
        >
      </Card.Footer>
    </Card.Root>

    <Card.Root class="w-1/3">
      <Card.Header>
        <Card.Title>Definition Preview</Card.Title>
        <Card.Description
          >The JSON stored on the policy and consumed by the policy worker.</Card.Description
        >
      </Card.Header>
      <Card.Content>
        <pre class="max-h-[620px] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(
            buildDefinition(),
            null,
            2
          )}</pre>
      </Card.Content>
    </Card.Root>
  </div>
</div>
