<script lang="ts">
  import './builder.css';
  import { getContext, tick } from 'svelte';
  import { goto, beforeNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    ArrowLeft,
    ArrowRight,
    Plus,
    Save,
    Trash2,
    Copy,
    Undo2,
    ShieldCheck,
    SlidersHorizontal,
    Filter,
    ListChecks,
    FileText,
    Check,
    CircleAlert,
    ChevronRight,
  } from '@lucide/svelte';
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
  import { authStore } from '$lib/stores/auth.store.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
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
  const canWrite = $derived(authStore.isAllowed('Policies.Write'));
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
  let saved = $state(false);
  let initialDraft = $state('');
  let leaveOpen = $state(false);
  let pendingNavigation: (() => void) | null = null;
  let pendingTable = $state('');
  type EditorSection = 'setup' | 'scope' | 'rules' | 'finding' | 'review';
  let activeSection = $state<EditorSection>('setup');
  let showIssues = $state(false);
  let createdPolicyId = $state('');
  let removedCondition = $state<{
    kind: ConditionKind;
    condition: ConditionDraft;
    index: number;
  } | null>(null);
  let editorPane = $state<HTMLElement | null>(null);

  function selectSection(section: EditorSection) {
    activeSection = section;
    void tick().then(() => {
      editorPane?.scrollTo({ top: 0 });
    });
  }

  function issueSection(issue: string): EditorSection {
    if (issue.startsWith('Filter')) return 'scope';
    if (issue.startsWith('Rule') || issue.startsWith('Add at least') || issue.startsWith('Minimum'))
      return 'rules';
    if (issue.includes('finding title')) return 'finding';
    return 'setup';
  }

  async function fixIssue(issue: string) {
    selectSection(issueSection(issue));
    await tick();
    if (issue.includes('policy a name')) document.getElementById('policy-name')?.focus();
    else if (issue.includes('finding title')) titleRef?.focus();
    else if (issue.startsWith('Minimum')) document.getElementById('policy-threshold')?.focus();
    else {
      const index = Number(issue.match(/^(?:Filter|Rule) (\d+)/)?.[1] ?? 1) - 1;
      editorPane
        ?.querySelectorAll<HTMLElement>('.pb-condition')
        [index]?.scrollIntoView({ block: 'nearest' });
      editorPane
        ?.querySelectorAll<HTMLElement>('.pb-condition')
        [index]?.querySelector<HTMLElement>('[role="combobox"]')
        ?.focus();
    }
  }

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

  const draftSnapshot = $derived(
    JSON.stringify({
      name,
      description,
      category,
      enabled,
      severity,
      table,
      mode,
      candidateConditions,
      expectationConditions,
      threshold,
      titleTemplate,
      summary,
      recommendation,
      linkedArticleIds,
    })
  );
  const dirty = $derived(!!initialDraft && initialDraft !== draftSnapshot && !saved);
  $effect(() => {
    if (
      !initialDraft &&
      (!editing || (loadedPolicyId === policyId && loadedLinksPolicyId === policyId))
    )
      initialDraft = draftSnapshot;
  });
  beforeNavigate((navigation) => {
    if (!dirty) return;
    if (navigation.willUnload) {
      navigation.cancel();
      return;
    }
    navigation.cancel();
    pendingNavigation = () => {
      saved = true;
      void goto(navigation.to?.url.href ?? '/policies');
    };
    leaveOpen = true;
  });

  function conditionIssue(condition: ConditionDraft): string | null {
    const field = fieldFor(condition.field);
    if (!field) return 'Choose a field.';
    if (!operatorOptions(field).some((option) => option.value === condition.op))
      return 'Choose a valid comparison.';
    if (!opNeedsValue(condition.op)) return null;
    if (isSetOp(condition.op))
      return condition.values?.some((value) => value.trim()) ? null : 'Add at least one value.';
    if (!condition.value.trim()) return 'Enter a value.';
    if (
      (field.field.type === 'number' || ['olderThanDays', 'withinDays'].includes(condition.op)) &&
      !Number.isFinite(Number(condition.value))
    )
      return 'Enter a valid number.';
    return null;
  }
  const validationIssues = $derived([
    ...(!name.trim() ? ['Give this policy a name.'] : []),
    ...(!titleTemplate.trim() ? ['Add a finding title.'] : []),
    ...candidateConditions.flatMap((condition, index) => {
      const issue = conditionIssue(condition);
      return issue ? [`Filter ${index + 1}: ${issue}`] : [];
    }),
    ...expectationConditions.flatMap((condition, index) => {
      const issue = conditionIssue(condition);
      return issue ? [`Rule ${index + 1}: ${issue}`] : [];
    }),
    ...(mode === 'rowExpectation' && !expectationConditions.length
      ? ['Add at least one rule.']
      : []),
    ...(mode === 'tableThreshold' &&
    (!threshold.trim() || !Number.isInteger(Number(threshold)) || Number(threshold) < 0)
      ? ['Minimum matching rows must be a whole number of zero or more.']
      : []),
  ]);

  const articleOptions = $derived(
    (articlesQuery.data ?? [])
      .filter((article) => article.status !== 'archived')
      .map((article) => ({
        value: article.id,
        label: `${article.kbId} — ${article.title}`,
      }))
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

  function duplicateCondition(kind: ConditionKind, condition: ConditionDraft) {
    const conditions = kind === 'candidates' ? candidateConditions : expectationConditions;
    const index = conditions.findIndex((item) => item.id === condition.id);
    const copy = {
      ...condition,
      id: newCondition().id,
      values: condition.values ? [...condition.values] : undefined,
    };
    const next = [...conditions.slice(0, index + 1), copy, ...conditions.slice(index + 1)];
    if (kind === 'candidates') candidateConditions = next;
    else expectationConditions = next;
  }

  function undoRemove() {
    if (!removedCondition) return;
    const { kind, condition, index } = removedCondition;
    const conditions = kind === 'candidates' ? candidateConditions : expectationConditions;
    const next = [...conditions.slice(0, index), condition, ...conditions.slice(index)];
    if (kind === 'candidates') candidateConditions = next;
    else expectationConditions = next;
    removedCondition = null;
  }

  function conditionSummary(condition: ConditionDraft) {
    const field = fieldFor(condition.field);
    if (!field) return 'Choose a field to begin';
    const operator =
      operatorOptions(field)
        .find((option) => option.value === condition.op)
        ?.label.toLowerCase() ?? condition.op;
    const value = isSetOp(condition.op)
      ? condition.values?.join(', ')
      : (field.field.options?.find((option) => option.value === condition.value)?.label ??
        condition.value);
    return `${field.label} ${operator}${opNeedsValue(condition.op) ? ` ${value || '…'}` : ''}`;
  }

  function removeCondition(kind: ConditionKind, id: string) {
    const conditions = kind === 'candidates' ? candidateConditions : expectationConditions;
    const index = conditions.findIndex((condition) => condition.id === id);
    if (index >= 0) removedCondition = { kind, index, condition: conditions[index]! };
    if (kind === 'candidates') {
      candidateConditions = candidateConditions.filter((condition) => condition.id !== id);
    } else {
      expectationConditions = expectationConditions.filter((condition) => condition.id !== id);
    }
  }

  function resetForTable() {
    removedCondition = null;
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
    if (!canWrite || saving) return;
    if (validationIssues.length) {
      showIssues = true;
      selectSection('review');
      return;
    }
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
        name: name.trim(),
        description: description || null,
        category: category || null,
        providerId: selectedTable.providerId ?? null,
        targetType: selectedTable.targetType,
        severity: Number(severity),
        enabled,
        recommendation: recommendation || null,
        definition: buildDefinition(),
      };
      if (editing || createdPolicyId) {
        const targetPolicyId = policyId || createdPolicyId;
        await trpc.policies.update.mutate({ id: targetPolicyId, ...payload });
        await trpc.wiki.articleLinks.setForTarget.mutate({
          targetType: 'policy',
          targetId: targetPolicyId,
          articleIds: linkedArticleIds,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['policies.byId', policyId] }),
          queryClient.invalidateQueries({ queryKey: ['policies.list'] }),
          queryClient.invalidateQueries({ queryKey: ['policies.tableData'] }),
          queryClient.invalidateQueries({ queryKey: ['wiki.articleLinks.forPolicy', policyId] }),
        ]);
        saved = true;
        toast.success('Policy saved');
        await goto(`/policies/${targetPolicyId}`);
      } else {
        const created = await trpc.policies.create.mutate(payload);
        createdPolicyId = created.id;
        if (linkedArticleIds.length > 0) {
          await trpc.wiki.articleLinks.setForTarget.mutate({
            targetType: 'policy',
            targetId: created.id,
            articleIds: linkedArticleIds,
          });
        }
        saved = true;
        toast.success('Policy created');
        await goto(`/policies/${created.id}`);
      }
    } catch (error) {
      showErrorToast(
        error,
        createdPolicyId
          ? 'The policy was created, but reference articles could not be saved. Try saving again to finish.'
          : 'Failed to save policy.'
      );
    } finally {
      saving = false;
    }
  }
  const sections = $derived([
    {
      id: 'setup' as const,
      label: 'Policy setup',
      icon: SlidersHorizontal,
      summary: `${selectedTable.label} · ${severityOptions.find((option) => option.value === severity)?.label ?? 'High'} severity`,
      complete: !!name.trim(),
    },
    {
      id: 'scope' as const,
      label: 'Records to evaluate',
      icon: Filter,
      summary: candidateConditions.length
        ? `${candidateConditions.length} filters · Match all`
        : 'All records in assigned scope',
      complete: candidateConditions.every((condition) => !conditionIssue(condition)),
    },
    {
      id: 'rules' as const,
      label: 'Healthy behavior',
      icon: ListChecks,
      summary: `${expectationConditions.length} ${expectationConditions.length === 1 ? 'rule' : 'rules'} · ${mode === 'rowExpectation' ? 'Check each record' : `Minimum ${threshold || '…'} records`}`,
      complete: !validationIssues.some((issue) => issueSection(issue) === 'rules'),
    },
    {
      id: 'finding' as const,
      label: 'Finding & guidance',
      icon: FileText,
      summary: recommendation.trim()
        ? 'Remediation guidance included'
        : 'Tell your team what to do next',
      complete: !!titleTemplate.trim(),
    },
  ]);
  const sectionTitle = $derived(
    sections.find((section) => section.id === activeSection)?.label ?? 'Review your policy'
  );
  const sectionHelp = {
    setup:
      'Choose the data and evaluation method. Give your team enough context to understand the policy.',
    scope: 'Filter the records to check. All filters must match before a record is evaluated.',
    rules: 'Describe what healthy looks like. Every rule must pass for a record to be healthy.',
    finding: 'Write the finding your team will receive and the guidance they need to resolve it.',
    review: 'Check the behavior and finish any required fields before saving.',
  };
</script>

{#snippet conditionEditor(kind: ConditionKind, condition: ConditionDraft, index: number)}
  {@const selectedField = fieldFor(condition.field)}
  {@const ops = operatorOptions(selectedField)}
  {@const issue = conditionIssue(condition)}
  <section
    class="pb-condition"
    class:pb-condition-incomplete={showIssues && !!issue}
    aria-label={`${kind === 'candidates' ? 'Filter' : 'Rule'} ${index + 1}`}
  >
    <header>
      <div>
        <span class="pb-rule-number">{index + 1}</span><strong
          >{selectedField?.label ?? (kind === 'candidates' ? 'New filter' : 'New rule')}</strong
        >{#if selectedField}<span class="pb-type">{selectedField.field.type}</span>{/if}
      </div>
      <div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Duplicate condition"
          title="Duplicate condition"
          onclick={() => duplicateCondition(kind, condition)}><Copy size={14} /></Button
        ><Button
          variant="ghost"
          size="icon"
          aria-label={kind === 'candidates' ? 'Remove filter' : 'Remove rule'}
          title="Remove condition"
          onclick={() => removeCondition(kind, condition.id)}><Trash2 size={14} /></Button
        >
      </div>
    </header>
    <div class="pb-condition-fields">
      <div>
        <span class="pb-field-label">Field</span>
        <SingleSelect
          aria-label="Condition field"
          options={fieldOptions}
          selected={condition.field}
          placeholder="Select field"
          onchange={(field) => {
            const selected = fieldFor(field);
            updateCondition(kind, condition.id, {
              field,
              op: operatorOptions(selected)[0]?.value ?? 'eq',
              value: '',
              values: [],
            });
          }}
        />
      </div>
      <div>
        <span class="pb-field-label">Comparison</span>
        <SingleSelect
          aria-label="Comparison"
          allowClear={false}
          options={ops}
          selected={condition.op}
          disabled={!selectedField}
          onchange={(op) => updateCondition(kind, condition.id, { op, value: '', values: [] })}
        />
      </div>
      <div class="pb-condition-value">
        <span class="pb-field-label">Value</span>
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
          {:else if isSetOp(condition.op)}
            <Input
              aria-label="Values separated by commas"
              value={(condition.values ?? []).join(', ')}
              placeholder="Values, separated by commas"
              oninput={(event) =>
                updateCondition(kind, condition.id, {
                  values: event.currentTarget.value.split(',').map((value) => value.trim()),
                })}
            />
          {:else if selectedField.field.type === 'boolean'}
            <SingleSelect
              aria-label="Condition value"
              options={booleanOptions}
              selected={condition.value}
              placeholder="Select value"
              onchange={(value) => updateCondition(kind, condition.id, { value })}
            />
          {:else if selectedField.field.options}
            <SingleSelect
              aria-label="Condition value"
              options={selectedField.field.options}
              selected={condition.value}
              placeholder="Select value"
              onchange={(value) => updateCondition(kind, condition.id, { value })}
            />
          {:else}
            <Input
              aria-label="Condition value"
              value={condition.value}
              type={selectedField.field.type === 'number' ||
              ['olderThanDays', 'withinDays'].includes(condition.op)
                ? 'number'
                : 'text'}
              placeholder="Value"
              oninput={(event) =>
                updateCondition(kind, condition.id, { value: event.currentTarget.value })}
            />
          {/if}
        {:else}
          <p class="pb-value-hint">
            {selectedField
              ? 'No value needed for this comparison.'
              : 'Choose a field to see its values.'}
          </p>
        {/if}
      </div>
    </div>
    {#if showIssues && issue}<p class="pb-condition-message" role="status">
        <CircleAlert size={13} />{issue}
      </p>
    {:else if selectedField && !issue}<p class="pb-condition-summary">
        <Check size={13} />{conditionSummary(condition)}
      </p>{/if}
  </section>
{/snippet}

{#if !canWrite}
  <div class="pw-empty">
    <h1>Policy editing is unavailable</h1>
    <p>You need policy write access to create or edit a policy.</p>
    <a href="/policies">All policies</a>
  </div>
{:else if editing && policyQuery.isPending}
  <div class="pw-empty" role="status">Loading policy…</div>
{:else if editing && (policyQuery.isError || !policyQuery.data)}
  <div class="pw-empty" role="alert">
    <h1>Policy could not be loaded</h1>
    <p>Try again before making changes.</p>
    <Button onclick={() => policyQuery.refetch()}>Try again</Button><a href="/policies"
      >All policies</a
    >
  </div>
{:else}
  <div class="pb-studio">
    <header class="pb-header">
      <div class="pb-header-main">
        <Button
          variant="ghost"
          size="icon"
          aria-label={editing ? 'Back to policy' : 'All policies'}
          disabled={saving}
          onclick={() => goto(editing ? `/policies/${policyId}` : '/policies')}
          ><ArrowLeft size={17} /></Button
        >
        <div class="pb-title">
          <span class="pw-eyebrow">{editing ? 'Edit policy' : 'New policy'}</span><Input
            id="policy-name"
            aria-label="Policy name"
            placeholder="Name your policy"
            bind:value={name}
            disabled={saving}
            class="pb-name-input"
          />
        </div>
        <div class="pb-header-actions">
          <span class="pb-save-state" role="status"
            >{saving
              ? 'Saving…'
              : dirty
                ? 'Unsaved changes'
                : editing
                  ? 'All changes saved'
                  : 'Not saved yet'}</span
          ><Button
            onclick={savePolicy}
            disabled={saving ||
              (editing && (existingLinksQuery.isPending || existingLinksQuery.isError))}
            class="gap-2"
            ><Save size={15} />{saving
              ? 'Saving…'
              : editing || createdPolicyId
                ? 'Save changes'
                : 'Create policy'}</Button
          >
        </div>
      </div>
      <div class="pb-context">
        <span><ShieldCheck size={15} />Policy builder</span>
        <p>Define the check. Guide the response.</p>
        <button
          type="button"
          disabled={saving}
          onclick={() => {
            showIssues = true;
            selectSection('review');
          }}
          >{#if validationIssues.length}<CircleAlert size={14} />{validationIssues.length} to finish{:else}<Check
              size={14}
            />Ready to save{/if}<ChevronRight size={14} /></button
        >
      </div>
    </header>

    <fieldset class="pb-body" disabled={saving}>
      <legend class="sr-only">Policy configuration</legend>
      <aside class="pb-plan" aria-label="Policy plan">
        <div class="pb-plan-intro">
          <p class="pw-eyebrow">The policy</p>
          <h1>Define healthy behavior</h1>
          <p>Choose a section to edit. Your changes stay here as you move between sections.</p>
        </div>
        <nav aria-label="Builder sections" class="pb-sections">
          {#each sections as section}
            <button
              type="button"
              aria-controls="policy-editor"
              aria-current={activeSection === section.id ? 'step' : undefined}
              onclick={() => selectSection(section.id)}
            >
              <span class="pb-nav-icon"><section.icon size={17} /></span><span
                ><strong>{section.label}</strong><small>{section.summary}</small></span
              >
              {#if showIssues && validationIssues.some((issue) => issueSection(issue) === section.id)}<CircleAlert
                  class="text-warning"
                  size={15}
                />{:else if section.complete}<Check class="text-muted-foreground" size={14} />{/if}
            </button>
          {/each}
        </nav>
        <div class="pb-plan-behavior">
          <p class="pw-eyebrow">When this policy runs</p>
          <p>
            Evaluate <strong>{selectedTable.label.toLowerCase()}</strong>{candidateConditions.length
              ? ` that match all ${candidateConditions.length} filters`
              : ' in the assigned scope'}.
          </p>
          <div>
            <ListChecks size={16} />
            <p>
              {mode === 'rowExpectation'
                ? 'Create a finding for each record that fails any rule.'
                : `Create a finding when fewer than ${threshold || '…'} records pass all rules.`}
            </p>
          </div>
          <span>{enabled ? 'Enabled when saved' : 'Disabled when saved'}</span>
        </div>
        <Button
          variant={activeSection === 'review' ? 'secondary' : 'outline'}
          class="w-full justify-between"
          onclick={() => {
            showIssues = true;
            selectSection('review');
          }}>Review policy<ArrowRight size={15} /></Button
        >
      </aside>

      <div
        id="policy-editor"
        class="pb-editor"
        role="region"
        aria-labelledby="policy-editor-title"
        bind:this={editorPane}
      >
        <header class="pb-editor-heading">
          <p class="pw-eyebrow">
            {activeSection === 'review' ? 'Before you save' : `Policy / ${sectionTitle}`}
          </p>
          <h2 id="policy-editor-title">{sectionTitle}</h2>
          <p>{sectionHelp[activeSection]}</p>
        </header>
        <div class="pb-form">
          {#if activeSection === 'setup'}
            <section class="pb-form-section">
              <div class="pb-field-heading">
                <h3>What should this policy check?</h3>
                <p>Choose the records available from your connected tools.</p>
              </div>
              <SingleSelect
                aria-label="Data to evaluate"
                allowClear={false}
                options={tableOptions}
                selected={table}
                onchange={(value) => {
                  if (value === table) return;
                  if (
                    [...candidateConditions, ...expectationConditions].some(
                      (condition) => condition.field
                    )
                  )
                    pendingTable = value;
                  else {
                    table = value;
                    resetForTable();
                  }
                }}
              />
            </section>
            <section class="pb-form-section">
              <div class="pb-field-heading"><h3>How should records be evaluated?</h3></div>
              <div class="pb-mode-options" role="group" aria-label="Evaluation mode">
                <button
                  type="button"
                  aria-pressed={mode === 'rowExpectation'}
                  onclick={() => (mode = 'rowExpectation')}
                  ><ListChecks size={19} /><strong>Check each record</strong><span
                    >Every matching record must pass all rules. Each failing record creates a
                    finding.</span
                  ></button
                >
                <button
                  type="button"
                  aria-pressed={mode === 'tableThreshold'}
                  onclick={() => (mode = 'tableThreshold')}
                  ><Filter size={19} /><strong>Require a minimum count</strong><span
                    >Count the records that pass all rules. Create a finding if too few pass.</span
                  ></button
                >
              </div>
            </section>
            <section class="pb-form-section">
              <div class="pb-field-heading">
                <h3>Context & priority</h3>
                <p>Help your team understand why this check matters.</p>
              </div>
              <div class="pb-two-fields">
                <div>
                  <label for="policy-category">Category</label><Input
                    id="policy-category"
                    bind:value={category}
                    placeholder="Operational"
                  />
                </div>
                <div>
                  <span class="pb-field-label">Finding severity</span><SingleSelect
                    aria-label="Severity"
                    allowClear={false}
                    options={severityOptions}
                    bind:selected={severity}
                    disableSort
                  />
                </div>
              </div>
              <div class="mt-5">
                <label for="policy-description"
                  >Description <span class="pb-optional">Optional</span></label
                ><Textarea
                  id="policy-description"
                  bind:value={description}
                  placeholder="Explain the risk this policy helps prevent…"
                  rows={3}
                />
              </div>
            </section>
            <section class="pb-enable">
              <div>
                <h3>Enable evaluation</h3>
                <p>
                  {enabled
                    ? 'This policy can evaluate wherever it is assigned.'
                    : 'Save the policy without evaluating it. Enable it when you are ready.'}
                </p>
              </div>
              <Switch aria-label="Enable evaluation" bind:checked={enabled} />
            </section>
          {:else if activeSection === 'scope' || activeSection === 'rules'}
            {@const kind = activeSection === 'scope' ? 'candidates' : 'expectations'}
            {@const conditions =
              kind === 'candidates' ? candidateConditions : expectationConditions}
            <div class="pb-rules-heading">
              <div>
                <h3>
                  {kind === 'candidates'
                    ? 'Include records that match'
                    : 'A healthy record must match'}
                </h3>
                <p>
                  {conditions.length > 1
                    ? 'All conditions must match (AND).'
                    : kind === 'candidates'
                      ? 'No filters means all records in the assigned scope.'
                      : 'Choose a field, comparison, and expected value.'}
                </p>
              </div>
              <span class="pb-count"
                >{conditions.length}
                {kind === 'candidates'
                  ? conditions.length === 1
                    ? 'filter'
                    : 'filters'
                  : conditions.length === 1
                    ? 'rule'
                    : 'rules'}</span
              >
            </div>
            {#each conditions as condition, index (condition.id)}
              {#if index > 0}<div class="pb-and"><span>AND</span></div>{/if}
              {@render conditionEditor(kind, condition, index)}
            {:else}
              <div class="pb-empty">
                {#if kind === 'candidates'}<Filter size={24} />{:else}<ListChecks size={24} />{/if}
                <h3>
                  {kind === 'candidates'
                    ? 'Start with all records'
                    : mode === 'tableThreshold'
                      ? 'All matching records count'
                      : 'What should a healthy record look like?'}
                </h3>
                <p>
                  {kind === 'candidates'
                    ? 'Add a filter only when this policy should apply to a subset, such as a device type or status.'
                    : mode === 'tableThreshold'
                      ? 'Add rules to count only records that meet your requirements.'
                      : 'Add the first rule to define the expected state.'}
                </p>
              </div>
            {/each}
            <Button variant="outline" class="pb-add-condition" onclick={() => addCondition(kind)}
              ><Plus size={16} />{kind === 'candidates' ? 'Add filter' : 'Add rule'}</Button
            >
            {#if removedCondition?.kind === kind}<div class="pb-undo" role="status">
                <span>{kind === 'candidates' ? 'Filter' : 'Rule'} removed</span><button
                  type="button"
                  onclick={undoRemove}><Undo2 size={14} />Undo</button
                >
              </div>{/if}
            {#if activeSection === 'rules' && mode === 'tableThreshold'}<section
                class="pb-threshold"
              >
                <label for="policy-threshold">Minimum passing records</label>
                <p>A finding is created if fewer than this number of records pass all rules.</p>
                <Input
                  id="policy-threshold"
                  value={threshold}
                  oninput={(event) => (threshold = event.currentTarget.value)}
                  type="number"
                  min="0"
                  step="1"
                  class="max-w-40"
                />
              </section>{/if}
            {#if activeSection === 'scope'}<div class="pb-note">
                <ShieldCheck size={17} />
                <p>
                  Filters choose records within an assignment. After saving, use the policy page to
                  assign sites or include it in an assigned framework.
                </p>
              </div>{/if}
          {:else if activeSection === 'finding'}
            <section class="pb-form-section">
              <div class="pb-field-heading">
                <h3>Make the finding actionable</h3>
                <p>Insert field tags to personalize findings with the affected record’s details.</p>
              </div>
              <div class="pb-label-row">
                <label for="finding-title">Finding title</label><TagInserter
                  groups={tagGroups}
                  target={titleRef}
                  bind:value={titleTemplate}
                />
              </div>
              <Input id="finding-title" bind:ref={titleRef} bind:value={titleTemplate} />
              <div class="pb-label-row mt-5">
                <label for="finding-summary"
                  >Summary <span class="pb-optional">Optional</span></label
                ><TagInserter groups={tagGroups} target={summaryRef} bind:value={summary} />
              </div>
              <Textarea
                id="finding-summary"
                bind:ref={summaryRef}
                bind:value={summary}
                placeholder="Explain what failed and why it matters…"
                rows={3}
              />
              <div class="pb-label-row mt-5">
                <label for="finding-recommendation"
                  >Recommended action <span class="pb-optional">Optional</span></label
                ><TagInserter
                  groups={tagGroups}
                  target={recommendationRef}
                  bind:value={recommendation}
                />
              </div>
              <Textarea
                id="finding-recommendation"
                bind:ref={recommendationRef}
                bind:value={recommendation}
                placeholder="What should the technician check or fix first?"
                rows={4}
              />
            </section>
            <section class="pb-form-section">
              <div class="pb-field-heading">
                <h3>Reference articles <span class="pb-optional">Optional</span></h3>
                <p>Attach supporting instructions your team can open from a finding.</p>
              </div>
              {#if existingLinksQuery.isError || articlesQuery.isError}<p
                  class="pb-load-error"
                  role="alert"
                >
                  Reference articles could not be loaded. <button
                    type="button"
                    onclick={() => {
                      void articlesQuery.refetch();
                      void existingLinksQuery.refetch();
                    }}>Try again</button
                  >
                </p>{/if}<MultiSelect
                options={articleOptions}
                bind:selected={linkedArticleIds}
                placeholder="Attach reference articles"
                searchPlaceholder="Search articles…"
                disabled={existingLinksQuery.isError || (editing && existingLinksQuery.isPending)}
                maxDisplay={3}
              />
            </section>
            <section class="pb-finding-preview">
              <header>
                <FileText size={16} />
                <h3>Finding preview</h3>
                <span
                  >{severityOptions.find((option) => option.value === severity)?.label} severity</span
                >
              </header>
              <strong>{titleTemplate || 'Your finding title'}</strong>{#if summary}<p>
                  {summary}
                </p>{/if}{#if recommendation}<div>
                  <h4>Recommended action</h4>
                  <p>{recommendation}</p>
                </div>{/if}
              <footer>
                Template tags are replaced with actual values when a finding is created.
              </footer>
            </section>
          {:else}
            <section class="pb-review-status" class:pb-review-ready={!validationIssues.length}>
              <div>
                {#if validationIssues.length}<CircleAlert size={20} />{:else}<Check
                    size={20}
                  />{/if}
                <h3>
                  {validationIssues.length
                    ? `${validationIssues.length} things to finish`
                    : 'Ready to save'}
                </h3>
              </div>
              <p>
                {validationIssues.length
                  ? 'Select an item below to finish its setup.'
                  : 'Review the behavior below, then save your policy.'}
              </p>
              {#each validationIssues as issue}<button type="button" onclick={() => fixIssue(issue)}
                  >{issue}<ArrowRight size={15} /></button
                >{/each}
            </section>
            {#if existingLinksQuery.isError}<p class="pb-load-error" role="alert">
                Reference articles must load before you can save. <button
                  type="button"
                  onclick={() => existingLinksQuery.refetch()}>Try again</button
                >
              </p>{/if}
            <section class="pb-review-section">
              <header>
                <h3>{name || 'Untitled policy'}</h3>
                <button type="button" onclick={() => selectSection('setup')}>Edit setup</button>
              </header>
              <dl>
                <div>
                  <dt>Data</dt>
                  <dd>{selectedTable.label}</dd>
                </div>
                <div>
                  <dt>Evaluation</dt>
                  <dd>
                    {mode === 'rowExpectation'
                      ? 'Every record must pass'
                      : `At least ${threshold || '…'} passing records`}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {enabled ? 'Enabled' : 'Disabled'} · {severityOptions.find(
                      (option) => option.value === severity
                    )?.label} severity
                  </dd>
                </div>
              </dl>
            </section>
            {#each [{ kind: 'candidates' as const, label: 'Records to evaluate', section: 'scope' as const, conditions: candidateConditions }, { kind: 'expectations' as const, label: 'Healthy behavior', section: 'rules' as const, conditions: expectationConditions }] as group}<section
                class="pb-review-section"
              >
                <header>
                  <h3>{group.label}</h3>
                  <button type="button" onclick={() => selectSection(group.section)}>Edit</button>
                </header>
                <ul>
                  {#each group.conditions as condition}<li>
                      {conditionSummary(condition)}
                    </li>{:else}<li>
                      {group.kind === 'candidates'
                        ? 'All records in the assigned scope'
                        : mode === 'tableThreshold'
                          ? 'All matching records count toward the minimum'
                          : 'No rules defined'}
                    </li>{/each}
                </ul>
              </section>{/each}
            <section class="pb-review-section">
              <header>
                <h3>Finding & response</h3>
                <button type="button" onclick={() => selectSection('finding')}>Edit</button>
              </header>
              <p>{titleTemplate || 'A finding title is required.'}</p>
              {#if recommendation}<p class="mt-3">{recommendation}</p>{:else}<p
                  class="pb-value-hint mt-3"
                >
                  No recommended action yet. Adding one helps technicians resolve the finding.
                </p>{/if}
              <p class="pb-value-hint mt-3">
                {linkedArticleIds.length} reference articles attached
              </p>
            </section>
            <div class="pb-note">
              <ShieldCheck size={17} />
              <p>
                {enabled
                  ? 'Saving makes these rules available for evaluation wherever this policy is assigned. Manage direct and framework assignments on the policy page.'
                  : 'This policy will remain disabled. You can assign it and enable evaluation when you are ready.'}
              </p>
            </div>
          {/if}
          <footer class="pb-editor-footer">
            <span
              >{activeSection === 'review'
                ? 'Your changes are saved only when you choose Save or Create.'
                : 'Move freely between sections. Your edits are kept.'}</span
            >{#if activeSection !== 'review'}<Button
                variant="outline"
                onclick={() => {
                  const index = sections.findIndex((section) => section.id === activeSection);
                  selectSection(sections[index + 1]?.id ?? 'review');
                }}
              >
                {activeSection === 'finding' ? 'Review policy' : 'Continue'}<ArrowRight
                  size={14}
                /></Button
              >{/if}
          </footer>
        </div>
      </div>
    </fieldset>
  </div>
{/if}

<AlertDialog.Root bind:open={leaveOpen}>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>Discard unsaved changes?</AlertDialog.Title><AlertDialog.Description
        >Your policy changes have not been saved.</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>Keep editing</AlertDialog.Cancel><Button
        variant="destructive"
        onclick={() => {
          leaveOpen = false;
          pendingNavigation?.();
        }}>Discard changes</Button
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
<AlertDialog.Root
  open={!!pendingTable}
  onOpenChange={(open) => {
    if (!open) pendingTable = '';
  }}
>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title>Change the data being evaluated?</AlertDialog.Title
      ><AlertDialog.Description
        >This clears your filters and rules because the available fields will change. Your policy
        name and finding details will be kept.</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>Keep current data</AlertDialog.Cancel><Button
        onclick={() => {
          table = pendingTable;
          resetForTable();
          pendingTable = '';
        }}>Change data and reset rules</Button
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
