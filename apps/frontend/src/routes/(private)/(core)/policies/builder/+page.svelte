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
  import {
    PolicyScopeTags,
    PolicyTableShapes,
    type FieldDefinition,
    type PolicyTableShape,
  } from '@mspbyte/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import ReferenceMultiSelect from '$lib/components/reference-multi-select.svelte';
  import ReferenceSingleSelect from '$lib/components/reference-single-select.svelte';
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
    values?: string[];
  };

  function isSetOp(op: string) {
    return op === 'containsAny' || op === 'notContainsAny';
  }

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

  const articlesQuery = createQuery(() => ({
    queryKey: ['wiki.articles.list.forBuilder'],
    queryFn: () => trpc.wiki.articles.list.query(),
  }));

  const existingLinksQuery = createQuery(() => ({
    queryKey: ['wiki.articleLinks.forPolicy', policyId],
    queryFn: () =>
      policyId
        ? trpc.wiki.articleLinks.listForTarget.query({
            targetType: 'policy',
            targetId: policyId,
          })
        : Promise.resolve([]),
    enabled: !!policyId,
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
  let titleTemplate = $state('{{hostname}}{{displayName}}{{name}} failed policy expectation');
  let summary = $state('');
  let recommendation = $state('');
  let linkedArticleIds = $state<string[]>([]);
  let loadedLinksPolicyId = $state('');
  let titleRef = $state<HTMLInputElement | null>(null);
  let summaryRef = $state<HTMLTextAreaElement | null>(null);
  let recommendationRef = $state<HTMLTextAreaElement | null>(null);

  const articleOptions = $derived(
    (articlesQuery.data ?? [])
      .filter((article) => article.status !== 'archived')
      .map((article) => ({
        value: article.id,
        label: `${article.kbId} — ${article.title}`,
      })),
  );

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
    const op = typeof condition.op === 'string' ? condition.op : 'eq';
    const draft: ConditionDraft = {
      id: newCondition().id,
      field: condition.field,
      op,
      value: '',
    };
    if (isSetOp(op)) {
      draft.values = Array.isArray(condition.value) ? condition.value.map(stringValue) : [];
    } else {
      draft.value = stringValue(condition.value);
    }
    return draft;
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
    if (isSetOp(condition.op)) {
      const values = (condition.values ?? []).filter((v) => v.length > 0);
      if (values.length === 0) return null;
      return { field: field.ingestPath, op: condition.op, value: values };
    }
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
    titleTemplate =
      typeof definition.title === 'string'
        ? definition.title
        : '{{hostname}}{{displayName}}{{name}} failed policy expectation';
    summary = typeof definition.summary === 'string' ? definition.summary : '';
    recommendation = policy.recommendation ?? '';
    loadedPolicyId = policy.id;
  });

  $effect(() => {
    const links = existingLinksQuery.data;
    if (!links || !policyId || loadedLinksPolicyId === policyId) return;
    linkedArticleIds = links.map((link) => link.articleId);
    loadedLinksPolicyId = policyId;
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
        targetType: selectedTable.targetType,
        severity: Number(severity),
        enabled,
        recommendation: recommendation || null,
        definition: buildDefinition(),
      };
      if (editing) {
        await trpc.policies.update.mutate({ id: policyId, ...payload });
        await trpc.wiki.articleLinks.setForTarget.mutate({
          targetType: 'policy',
          targetId: policyId,
          articleIds: linkedArticleIds,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['policies.byId', policyId] }),
          queryClient.invalidateQueries({ queryKey: ['policies.list'] }),
          queryClient.invalidateQueries({ queryKey: ['policies.tableData'] }),
          queryClient.invalidateQueries({ queryKey: ['wiki.articleLinks.forPolicy', policyId] }),
        ]);
        toast.success('Policy saved');
        await goto(`/policies/${policyId}`);
      } else {
        const created = await trpc.policies.create.mutate(payload);
        if (linkedArticleIds.length > 0) {
          await trpc.wiki.articleLinks.setForTarget.mutate({
            targetType: 'policy',
            targetId: created.id,
            articleIds: linkedArticleIds,
          });
        }
        toast.success('Policy created');
        await goto(`/policies/${created.id}`);
      }
    } catch (error) {
      showErrorToast(error, 'Failed to save policy.');
    } finally {
      saving = false;
    }
  }
</script>

{#snippet conditionEditor(kind: ConditionKind, condition: ConditionDraft)}
  {@const selectedField = fieldFor(condition.field)}
  {@const ops = operatorOptions(selectedField)}
  <div class="grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-[minmax(0,1fr)_190px_minmax(0,1fr)_36px]">
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
      onchange={(op) => updateCondition(kind, condition.id, { op, value: '', values: [] })}
    />
    {#if selectedField && opNeedsValue(condition.op)}
      {#if isSetOp(condition.op) && selectedField.field.reference}
        <ReferenceMultiSelect
          ref={selectedField.field.reference}
          selected={condition.values ?? []}
          placeholder="Select values"
          onchange={(values) => updateCondition(kind, condition.id, { values })}
        />
      {:else if !isSetOp(condition.op) && selectedField.field.reference}
        <ReferenceSingleSelect
          ref={selectedField.field.reference}
          selected={condition.value}
          placeholder="Select value"
          onchange={(value) => updateCondition(kind, condition.id, { value })}
        />
      {:else if selectedField.field.type === 'boolean'}
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

<div class="flex size-full flex-col overflow-hidden">
  <!-- Header bar -->
  <header class="border-b bg-background">
    <div class="flex flex-wrap items-center gap-3 px-6 py-3">
      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => goto(editing ? `/policies/${policyId}` : '/policies')}
      >
        <ArrowLeft class="size-3.5" />
        {editing ? 'Back to policy' : 'All policies'}
      </button>

      <div class="mx-2 h-5 w-px bg-border"></div>

      <Input
        placeholder="Policy name"
        bind:value={name}
        class="h-9 w-full max-w-sm text-base font-semibold"
      />

      <div class="ml-auto flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
          <Switch bind:checked={enabled} />
          {enabled ? 'Enabled' : 'Disabled'}
        </label>
        <Button
          onclick={savePolicy}
          disabled={saving || (editing && policyQuery.isLoading)}
          class="gap-2"
        >
          <Save class="size-4" />
          {editing ? 'Save Policy' : 'Create Policy'}
        </Button>
      </div>
    </div>
  </header>

  <!-- Two-pane body: info left, rules right -->
  <div class="grid min-h-0 flex-1 grid-cols-[360px_1fr]">

    <!-- Left: policy information -->
    <aside class="flex min-h-0 flex-col overflow-y-auto border-r">

      <!-- Identity -->
      <div class="border-b px-4 py-3 bg-muted/30">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Identity</p>
      </div>
      <div class="space-y-4 p-4">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Category</label>
            <Input bind:value={category} placeholder="Operational" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium">Severity</label>
            <SingleSelect options={severityOptions} bind:selected={severity} />
          </div>
        </div>
        <div class="space-y-1.5">
          <label class="text-sm font-medium">Description</label>
          <Textarea bind:value={description} placeholder="What does this policy enforce?" rows={3} />
        </div>
      </div>

      <!-- Finding copy -->
      <div class="border-b border-t px-4 py-3 bg-muted/30">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Finding Copy</p>
        <p class="mt-0.5 text-xs text-muted-foreground">Shown on every finding this policy creates.</p>
      </div>
      <div class="space-y-4 p-4">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">Title template</label>
            <TagInserter groups={tagGroups} target={titleRef} bind:value={titleTemplate} />
          </div>
          <Input bind:ref={titleRef} bind:value={titleTemplate} />
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">Summary</label>
            <TagInserter groups={tagGroups} target={summaryRef} bind:value={summary} />
          </div>
          <Textarea bind:ref={summaryRef} bind:value={summary} rows={3} />
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium">Recommendation</label>
            <TagInserter groups={tagGroups} target={recommendationRef} bind:value={recommendation} />
          </div>
          <Textarea bind:ref={recommendationRef} bind:value={recommendation} rows={3} />
        </div>
        <div class="space-y-1.5">
          <label class="text-sm font-medium">Linked Wiki articles</label>
          <MultiSelect
            options={articleOptions}
            bind:selected={linkedArticleIds}
            placeholder="Attach reference articles"
            searchPlaceholder="Search articles..."
            maxDisplay={3}
          />
          <p class="text-xs text-muted-foreground">Surfaced on findings for quick tech reference.</p>
        </div>
      </div>
    </aside>

    <!-- Right: rule logic -->
    <div class="flex min-h-0 flex-col overflow-y-auto">

      <!-- Data source -->
      <div class="border-b px-4 py-3 bg-muted/30">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Data Source</p>
      </div>
      <div class="grid grid-cols-2 gap-4 p-4 border-b">
        <div class="space-y-1.5">
          <label class="text-sm font-medium">Source table</label>
          <SingleSelect options={tableOptions} bind:selected={table} onchange={resetForTable} />
          <p class="text-xs text-muted-foreground">Changing this resets all filters and rules.</p>
        </div>
        <div class="space-y-1.5">
          <label class="text-sm font-medium">Evaluation mode</label>
          <SingleSelect options={modeOptions} bind:selected={mode} />
          <p class="text-xs text-muted-foreground">
            {#if mode === 'rowExpectation'}
              A finding fires for each row that fails any rule.
            {:else}
              A finding fires when the matching row count falls below the threshold.
            {/if}
          </p>
        </div>
      </div>

      <!-- Candidate filter -->
      <div class="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Candidate Filter</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Narrows which {selectedTable.label} rows are evaluated. Leave empty to include all.
          </p>
        </div>
        <Button variant="outline" size="sm" class="shrink-0 gap-2" onclick={() => addCondition('candidates')}>
          <Plus class="size-4" /> Add Filter
        </Button>
      </div>
      <div class="space-y-2 p-4 border-b">
        {#each candidateConditions as condition (condition.id)}
          {@render conditionEditor('candidates', condition)}
        {:else}
          <div class="rounded-lg border border-dashed py-5 text-center text-sm text-muted-foreground">
            All rows in scope are included.
          </div>
        {/each}
      </div>

      <!-- Rules -->
      <div class="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rules</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {mode === 'tableThreshold'
              ? 'Conditions a row must satisfy to count toward the threshold.'
              : 'Conditions each row must satisfy. A finding fires for each row that fails.'}
          </p>
        </div>
        <Button variant="outline" size="sm" class="shrink-0 gap-2" onclick={() => addCondition('expectations')}>
          <Plus class="size-4" /> Add Rule
        </Button>
      </div>
      <div class="space-y-2 p-4">
        {#each expectationConditions as condition (condition.id)}
          {@render conditionEditor('expectations', condition)}
        {:else}
          <div class="rounded-lg border border-dashed py-5 text-center text-sm text-muted-foreground">
            {mode === 'tableThreshold' ? 'Every scoped row counts toward the threshold.' : 'Add at least one rule.'}
          </div>
        {/each}
        {#if mode === 'tableThreshold'}
          <div class="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3 mt-2">
            <label class="shrink-0 text-sm font-medium">Minimum matching rows</label>
            <Input bind:value={threshold} type="number" min="0" class="w-28" />
            <p class="text-xs text-muted-foreground">A finding fires when the count drops below this.</p>
          </div>
        {/if}
      </div>

    </div>
  </div>
</div>
