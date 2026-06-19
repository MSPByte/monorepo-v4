<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import ReferenceSelect from './_reference-select.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { toast } from 'svelte-sonner';
  import { Plus, Trash2 } from '@lucide/svelte';
  import { getContext } from 'svelte';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import type { Integration } from '@mspbyte/shared';
  import type {
    CheckCondition,
    ConditionLogic,
    ConditionOperator,
    CheckConfig,
  } from '@mspbyte/shared';
  import type { ComplianceFrameworkCheck as Check } from '@mspbyte/drizzle';
  import {
    getFlatTrackableFields,
    getOperatorsForField,
    opNeedsValue,
    opIsSize,
    type FlatField,
  } from './_schema-helpers.js';

  const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
  const CHECK_TYPES = [
    { value: 'policy_exists', label: 'Policy Exists', group: 'policy' },
    { value: 'policy_not_exists', label: 'Policy Not Exists', group: 'policy' },
    { value: 'policy_count_gte', label: 'Policy Count ≥', group: 'policy' },
    { value: 'field_compare', label: 'Field Compare', group: 'field' },
  ] as const;
  type CheckTypeId = (typeof CHECK_TYPES)[number]['value'];

  let {
    open = $bindable(false),
    mode,
    check = null,
    frameworkId,
    integration,
    onsuccess,
  }: {
    open: boolean;
    mode: 'create' | 'edit';
    check?: Check | null;
    frameworkId: string;
    integration: Integration;
    onsuccess?: () => void;
  } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const createMut = createMutation(() => ({
    mutationFn: (input: {
      frameworkId: string;
      name: string;
      description?: string;
      severity: string;
      checkTypeId: string;
      checkConfig: Record<string, unknown>;
    }) => trpc.compliance.createCheck.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listChecks'] });
    },
  }));

  const updateMut = createMutation(() => ({
    mutationFn: (input: {
      id: string;
      name?: string;
      description?: string | null;
      severity?: string;
      checkTypeId?: string;
      checkConfig?: Record<string, unknown>;
    }) => trpc.compliance.updateCheck.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listChecks'] });
    },
  }));

  type Source = { tableKey: string; label: string; fields: FlatField[] };
  const availableSources = $derived(
    integration.supportedFacets
      .filter((t) => t.db && getFlatTrackableFields(t.db.shape).length > 0)
      .map((t) => {
        return {
          tableKey: t.db!.table,
          label: t.db!.name,
          fields: getFlatTrackableFields(t.db!.shape),
        } satisfies Source;
      })
  );

  let name = $state('');
  let description = $state('');
  let severity = $state<string>('medium');
  let checkTypeId = $state<CheckTypeId>('policy_exists');
  let sourceKey = $state('');
  let conditions = $state<CheckCondition[]>([]);
  let conditionLogic = $state<ConditionLogic>('AND');
  let threshold = $state('1');
  let selectedFieldPath = $state('');
  let fieldOp = $state<ConditionOperator>('eq');
  let fieldValue = $state('');
  let loading = $state(false);

  const selectedSource = $derived(availableSources.find((s) => s.tableKey === sourceKey) ?? null);
  const trackableFields = $derived(selectedSource?.fields ?? []);
  const selectedEvalField = $derived(
    trackableFields.find((f) => f.ingestPath === selectedFieldPath) ?? null
  );
  const showConditions = $derived(checkTypeId !== 'field_compare');
  const showFieldCompare = $derived(checkTypeId === 'field_compare');
  const showThreshold = $derived(
    checkTypeId === 'policy_exists' ||
    checkTypeId === 'policy_count_gte' ||
    checkTypeId === 'policy_not_exists'
  );

  $effect(() => {
    if (open) {
      if (mode === 'edit' && check) {
        name = check.name;
        description = check.description ?? '';
        severity = check.severity;
        const rawType = check.checkTypeId as string;
        if (rawType === 'field_equals' || rawType === 'field_not_equals') {
          checkTypeId = 'field_compare';
        } else {
          checkTypeId = (rawType as CheckTypeId) ?? 'policy_exists';
        }
        const cfg = check.checkConfig as Record<string, unknown>;
        sourceKey = (cfg?.table as string) ?? '';
        threshold = String((cfg?.threshold as number) ?? 1);
        if (cfg?.filter) {
          const filter = cfg.filter as { logic?: ConditionLogic; conditions?: CheckCondition[] };
          conditionLogic = filter.logic ?? 'AND';
          conditions = filter.conditions ?? [];
        } else if (cfg?.match && typeof cfg.match === 'object') {
          conditionLogic = 'AND';
          conditions = Object.entries(cfg.match as Record<string, unknown>).map(([field, value]) => ({
            field,
            op: 'eq' as ConditionOperator,
            value,
          }));
        } else {
          conditionLogic = 'AND';
          conditions = [];
        }
        selectedFieldPath = (cfg?.field as string) ?? '';
        fieldOp =
          rawType === 'field_not_equals'
            ? 'neq'
            : ((cfg?.op as ConditionOperator) ?? 'eq');
        fieldValue = cfg?.value != null ? String(cfg.value) : '';
      } else {
        name = '';
        description = '';
        severity = 'medium';
        checkTypeId = 'policy_exists';
        sourceKey = availableSources[0]?.tableKey ?? '';
        conditions = [];
        conditionLogic = 'AND';
        threshold = '1';
        selectedFieldPath = '';
        fieldOp = 'eq';
        fieldValue = '';
      }
    }
  });

  function addCondition() {
    conditions = [...conditions, { field: '', op: 'eq', value: '' }];
  }

  function removeCondition(i: number) {
    conditions = conditions.filter((_, idx) => idx !== i);
  }

  function updateConditionField(i: number, ingestPath: string) {
    const updated = [...conditions];
    const field = trackableFields.find((f) => f.ingestPath === ingestPath);
    updated[i] = {
      field: ingestPath,
      op: field ? (getOperatorsForField(field)[0]?.value ?? 'eq') : 'eq',
      value: '',
    };
    conditions = updated;
  }

  function updateConditionOp(i: number, op: ConditionOperator) {
    const updated = [...conditions];
    updated[i] = {
      ...updated[i]!,
      op,
      value: opNeedsValue(op) ? updated[i]!.value : undefined,
    };
    conditions = updated;
  }

  function updateConditionValue(i: number, value: string) {
    const updated = [...conditions];
    updated[i] = { ...updated[i]!, value };
    conditions = updated;
  }

  function coerceFieldValue(raw: string, flatField: FlatField | null): unknown {
    if (!flatField) return raw;
    if (flatField.field.type === 'number') return Number(raw);
    if (flatField.field.type === 'boolean') return raw === 'true';
    return raw;
  }

  function coerceConditionValue(condition: CheckCondition): CheckCondition {
    if (!opNeedsValue(condition.op)) {
      return { ...condition, value: undefined };
    }

    const flatField = trackableFields.find((f) => f.ingestPath === condition.field) ?? null;
    if (!flatField) return condition;

    if (opIsSize(condition.op)) {
      return { ...condition, value: Number(condition.value) };
    }

    if (flatField.field.type === 'number') {
      return { ...condition, value: Number(condition.value) };
    }

    if (flatField.field.type === 'boolean') {
      return { ...condition, value: condition.value === true || condition.value === 'true' };
    }

    return condition;
  }

  function buildConfig(): CheckConfig {
    const validConditions = conditions
      .filter((c) => c.field.trim())
      .map((condition) => coerceConditionValue(condition));
    const filter =
      showConditions && validConditions.length > 0
        ? { logic: conditionLogic, conditions: validConditions }
        : undefined;
    return {
      table: sourceKey,
      ...(filter ? { filter } : {}),
      ...(showThreshold ? { threshold: Number(threshold) || 1 } : {}),
      ...(showFieldCompare
        ? {
            field: selectedFieldPath,
            op: fieldOp,
            value: coerceFieldValue(fieldValue, selectedEvalField),
          }
        : {}),
    };
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!sourceKey) {
      toast.error('Data source is required');
      return;
    }
    if (showFieldCompare && !selectedFieldPath) {
      toast.error('Field is required for Field Compare checks');
      return;
    }

    loading = true;
    try {
      const checkConfig = buildConfig() as Record<string, unknown>;
      if (mode === 'create') {
        await createMut.mutateAsync({
          frameworkId,
          name: name.trim(),
          description: description.trim() || undefined,
          severity,
          checkTypeId,
          checkConfig,
        });
        toast.info('Check added');
      } else if (check) {
        await updateMut.mutateAsync({
          id: check.id,
          name: name.trim(),
          description: description.trim() || null,
          severity,
          checkTypeId,
          checkConfig,
        });
        toast.info('Check updated');
      }
      open = false;
      onsuccess?.();
    } catch (err) {
      toast.error(`Failed to save check: ${String(err)}`);
    } finally {
      loading = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay />
    <Dialog.Content class="min-w-3/5 flex flex-col gap-0 p-0 max-h-[90vh]">
      <Dialog.Header class="p-4 border-b shrink-0">
        <Dialog.Title>{mode === 'create' ? 'Add Check' : 'Edit Check'}</Dialog.Title>
        <Dialog.Description>Configure the compliance check parameters.</Dialog.Description>
      </Dialog.Header>

      <div class="flex flex-col p-4 gap-4 overflow-y-auto">
        <div class="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input
            bind:value={name}
            disabled={!authStore.isAllowed('Integrations.Write')}
            placeholder="e.g. MFA Required for All Users"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea
            bind:value={description}
            disabled={!authStore.isAllowed('Integrations.Write')}
            placeholder="Optional description..."
            rows={2}
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Severity</Label>
            <Select.Root
              type="single"
              bind:value={severity}
              disabled={!authStore.isAllowed('Integrations.Write')}
            >
              <Select.Trigger class="w-full capitalize">{severity}</Select.Trigger>
              <Select.Content>
                {#each SEVERITIES as s}
                  <Select.Item value={s} class="capitalize">{s}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Check Type</Label>
            <Select.Root
              type="single"
              bind:value={checkTypeId}
              onValueChange={() => {
                conditions = [];
                selectedFieldPath = '';
                fieldOp = 'eq';
                fieldValue = '';
              }}
              disabled={!authStore.isAllowed('Integrations.Write')}
            >
              <Select.Trigger class="w-full">
                {CHECK_TYPES.find((t) => t.value === checkTypeId)?.label ?? checkTypeId}
              </Select.Trigger>
              <Select.Content>
                {#each CHECK_TYPES as t}
                  <Select.Item value={t.value}>{t.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>Data Source</Label>
          <Select.Root
            type="single"
            bind:value={sourceKey}
            onValueChange={() => {
              conditions = [];
              selectedFieldPath = '';
              fieldOp = 'eq';
              fieldValue = '';
            }}
            disabled={!authStore.isAllowed('Integrations.Write')}
          >
            <Select.Trigger class="w-full">
              {selectedSource?.label ?? 'Select a source...'}
            </Select.Trigger>
            <Select.Content>
              {#each availableSources as src}
                <Select.Item value={src.tableKey}>{src.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        {#if showThreshold}
          <div class="flex flex-col gap-1.5">
            <Label>Threshold</Label>
            <Input
              type="number"
              bind:value={threshold}
              disabled={!authStore.isAllowed('Integrations.Write')}
              min="1"
            />
          </div>
        {/if}

        {#if showFieldCompare}
          <div class="flex flex-col gap-1.5">
            <Label>Field Comparison</Label>
            <div class="flex gap-2 items-center flex-wrap">
              <SingleSelect
                placeholder="Select field..."
                bind:selected={selectedFieldPath}
                options={trackableFields.map((f) => ({ label: f.label, value: f.ingestPath }))}
                onchange={(v) => {
                  const f = trackableFields.find((f) => f.ingestPath === v);
                  if (f) fieldOp = getOperatorsForField(f)[0]?.value ?? 'eq';
                  fieldValue = '';
                }}
                disabled={!authStore.isAllowed('Integrations.Write')}
              />
              {#if selectedEvalField}
                <Select.Root
                  type="single"
                  bind:value={fieldOp}
                  onValueChange={() => (fieldValue = '')}
                  disabled={!authStore.isAllowed('Integrations.Write')}
                >
                  <Select.Trigger class="w-36 shrink-0">
                    {getOperatorsForField(selectedEvalField).find((o) => o.value === fieldOp)?.label ?? fieldOp}
                  </Select.Trigger>
                  <Select.Content>
                    {#each getOperatorsForField(selectedEvalField) as opt}
                      <Select.Item value={opt.value}>{opt.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                {#if opNeedsValue(fieldOp)}
                  {#if opIsSize(fieldOp)}
                    <Input
                      type="number"
                      bind:value={fieldValue}
                      placeholder="count"
                      min="0"
                      class="w-24 shrink-0"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    />
                  {:else if selectedEvalField.field.options && (selectedEvalField.field.type === 'enum' || (selectedEvalField.field.modality === 'array' && (fieldOp === 'contains' || fieldOp === 'not_contains')))}
                    <Select.Root
                      type="single"
                      bind:value={fieldValue}
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    >
                      <Select.Trigger class="flex-1 min-w-28">
                        {selectedEvalField.field.options.find((o) => o.value === fieldValue)?.label ?? (fieldValue || 'Select...')}
                      </Select.Trigger>
                      <Select.Content>
                        {#each selectedEvalField.field.options as opt}
                          <Select.Item value={opt.value}>{opt.label}</Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  {:else if selectedEvalField.field.type === 'boolean'}
                    <Select.Root
                      type="single"
                      bind:value={fieldValue}
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    >
                      <Select.Trigger class="flex-1 min-w-28">
                        {fieldValue === 'true' ? 'True' : fieldValue === 'false' ? 'False' : 'Select...'}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="true">True</Select.Item>
                        <Select.Item value="false">False</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  {:else if selectedEvalField.field.reference && (fieldOp === 'contains' || fieldOp === 'not_contains')}
                    <ReferenceSelect
                      ref={selectedEvalField.field.reference}
                      selected={fieldValue}
                      onchange={(v) => { fieldValue = v; }}
                      class="flex-1 min-w-28"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    />
                  {:else}
                    <Input
                      bind:value={fieldValue}
                      type={selectedEvalField.field.type === 'number' ? 'number' : 'text'}
                      placeholder="expected value"
                      class="flex-1 min-w-28"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    />
                  {/if}
                {/if}
              {/if}
            </div>
          </div>
        {/if}

        {#if showConditions}
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Label>Conditions</Label>
                {#if conditions.length > 1}
                  <div class="flex items-center rounded-md border overflow-hidden text-xs">
                    <button
                      disabled={!authStore.isAllowed('Integrations.Write')}
                      class="px-2 py-0.5 transition-colors {conditionLogic === 'AND' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                      onclick={() => (conditionLogic = 'AND')}
                    >AND</button>
                    <button
                      disabled={!authStore.isAllowed('Integrations.Write')}
                      class="px-2 py-0.5 transition-colors {conditionLogic === 'OR' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                      onclick={() => (conditionLogic = 'OR')}
                    >OR</button>
                  </div>
                {/if}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onclick={addCondition}
                class="h-7 px-2 gap-1"
                disabled={!authStore.isAllowed('Integrations.Write')}
              >
                <Plus class="size-3" /> Add
              </Button>
            </div>
            {#if conditions.length === 0}
              <span class="text-xs text-muted-foreground">No conditions — matches all rows</span>
            {/if}
            {#each conditions as cond, i}
              {@const condField = trackableFields.find((f) => f.ingestPath === cond.field) ?? null}
              {@const condOps = condField ? getOperatorsForField(condField) : []}
              <div class="flex gap-2 items-center">
                <div class="min-w-0 flex-1">
                  <SingleSelect
                    selected={cond.field}
                    placeholder="Select field..."
                    options={trackableFields.map((f) => ({ label: f.label, value: f.ingestPath }))}
                    onchange={(v) => updateConditionField(i, v)}
                    disabled={!authStore.isAllowed('Integrations.Write')}
                  />
                </div>
                {#if condField}
                  <Select.Root
                    type="single"
                    value={cond.op}
                    onValueChange={(v) => updateConditionOp(i, v as ConditionOperator)}
                    disabled={!authStore.isAllowed('Integrations.Write')}
                  >
                    <Select.Trigger class="w-32 shrink-0">
                      {condOps.find((o) => o.value === cond.op)?.label ?? cond.op}
                    </Select.Trigger>
                    <Select.Content>
                      {#each condOps as opt}
                        <Select.Item value={opt.value}>{opt.label}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                {/if}
                {#if condField && opNeedsValue(cond.op)}
                  {#if opIsSize(cond.op)}
                    <Input
                      type="number"
                      value={String(cond.value ?? '')}
                      oninput={(e) => updateConditionValue(i, (e.target as HTMLInputElement).value)}
                      placeholder="n"
                      min="0"
                      class="w-20 shrink-0"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    />
                  {:else if condField.field.options && (condField.field.type === 'enum' || (condField.field.modality === 'array' && (cond.op === 'contains' || cond.op === 'not_contains')))}
                    <Select.Root
                      type="single"
                      value={String(cond.value ?? '')}
                      onValueChange={(v) => updateConditionValue(i, v)}
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    >
                      <Select.Trigger class="flex-1 min-w-0 truncate">
                        {condField.field.options.find((o) => o.value === cond.value)?.label ?? String(cond.value || 'Select...')}
                      </Select.Trigger>
                      <Select.Content>
                        {#each condField.field.options as opt}
                          <Select.Item value={opt.value}>{opt.label}</Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  {:else if condField.field.type === 'boolean'}
                    <Select.Root
                      type="single"
                      value={String(cond.value ?? '')}
                      onValueChange={(v) => updateConditionValue(i, v)}
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    >
                      <Select.Trigger class="flex-1 min-w-0">
                        {cond.value === 'true' || cond.value === true ? 'True' : cond.value === 'false' || cond.value === false ? 'False' : 'Select...'}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="true">True</Select.Item>
                        <Select.Item value="false">False</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  {:else if condField.field.reference && (cond.op === 'contains' || cond.op === 'not_contains')}
                    <ReferenceSelect
                      ref={condField.field.reference}
                      selected={String(cond.value ?? '')}
                      onchange={(v) => updateConditionValue(i, v)}
                      class="flex-1 min-w-0"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    />
                  {:else}
                    <Input
                      value={String(cond.value ?? '')}
                      oninput={(e) => updateConditionValue(i, (e.target as HTMLInputElement).value)}
                      type={condField.field.type === 'number' ? 'number' : 'text'}
                      placeholder="value"
                      class="flex-1 min-w-0"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                    />
                  {/if}
                {/if}
                <Button
                  variant="ghost"
                  disabled={!authStore.isAllowed('Integrations.Write')}
                  onclick={() => removeCondition(i)}
                  class="p-1.5! h-fit rounded text-muted-foreground hover:text-destructive hover:bg-destructive/20!"
                >
                  <Trash2 class="size-4" />
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <Dialog.Footer class="border-t shrink-0">
        <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button
          onclick={handleSubmit}
          disabled={loading || !authStore.isAllowed('Integrations.Write')}
        >
          {loading ? 'Saving...' : 'Save'}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
