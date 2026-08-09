<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Select from '$lib/components/ui/select/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import EntityPicker from '$lib/components/domain/entity-picker.svelte';
  import StepNode from '$lib/components/domain/step-node.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { fieldLabel } from '$lib/utils/label';
  import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from '@lucide/svelte';

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license';
  type BindingKind = 'literal' | 'runtime' | 'entity' | 'priorOutput';

  export type Binding =
    | { kind: 'literal'; value: unknown }
    | { kind: 'runtime'; promptKey: string; required: boolean }
    | {
        kind: 'entity';
        source: 'row-context' | 'picker';
        entityType: string;
        contextKey?: string;
      }
    | { kind: 'priorOutput'; stepPosition: number; path: string };

  export type Step = {
    capabilityId: string;
    label?: string;
    inputBindings: Record<string, Binding>;
  };

  export type PackageDraft = {
    name: string;
    description: string;
    status: 'draft' | 'active' | 'archived';
    steps: Step[];
  };

  type Props = {
    initial: PackageDraft;
    saving: boolean;
    onSave: (draft: PackageDraft) => void;
  };

  let { initial, saving, onSave }: Props = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const capabilitiesQuery = createQuery(() => ({
    queryKey: ['packages.metadata.capabilities'],
    queryFn: () => trpc.packages.capabilities.query(),
    staleTime: 5 * 60_000,
  }));

  let draft = $state<PackageDraft>({
    name: initial.name,
    description: initial.description,
    status: initial.status,
    steps: structuredClone(initial.steps),
  });

  let addingCapabilityId = $state('');

  const capIndex = $derived(new Map((capabilitiesQuery.data ?? []).map((c) => [c.id, c])));

  const capabilityOptions = $derived(
    (capabilitiesQuery.data ?? []).map((c) => ({
      value: c.id,
      label: `${c.name}  ·  ${c.category}`,
    })),
  );

  const statusBadgeClass = $derived.by(() => {
    if (draft.status === 'active')
      return 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400';
    if (draft.status === 'archived') return 'border-muted-foreground/30 text-muted-foreground';
    return 'border-amber-500/40 text-amber-600 dark:text-amber-400';
  });

  function defaultBindingForInput(
    inputName: string,
    meta: {
      allowedBindings: readonly string[];
      entityType?: string;
      typeHint?: string;
    },
  ): Binding {
    // promptKey defaults to the input name so a fresh runtime binding is
    // immediately valid — the user can rename to dedupe across steps.
    if (meta.allowedBindings.includes('runtime')) {
      return { kind: 'runtime', promptKey: inputName, required: true };
    }
    if (meta.allowedBindings.includes('literal')) {
      const initialValue =
        meta.typeHint === 'boolean' ? false : meta.typeHint === 'stringArray' ? [] : '';
      return { kind: 'literal', value: initialValue };
    }
    if (meta.allowedBindings.includes('entity')) {
      return { kind: 'entity', source: 'picker', entityType: meta.entityType ?? '' };
    }
    return { kind: 'priorOutput', stepPosition: 0, path: '' };
  }

  // Required = the input is required by the capability. Anything with an
  // explicit `required: false` is treated as optional and left off unless the
  // author opts in via "Add optional field".
  function isRequiredInput(meta: { required?: boolean }): boolean {
    return meta.required !== false;
  }

  function addStep() {
    if (!addingCapabilityId) return;
    const cap = capIndex.get(addingCapabilityId);
    if (!cap) return;
    const inputBindings: Record<string, Binding> = {};
    for (const [name, meta] of Object.entries(cap.inputMeta)) {
      if (!isRequiredInput(meta)) continue;
      inputBindings[name] = defaultBindingForInput(name, meta);
    }
    draft.steps = [
      ...draft.steps,
      { capabilityId: cap.id, label: cap.name, inputBindings },
    ];
    addingCapabilityId = '';
  }

  function addOptionalInput(stepIndex: number, inputName: string) {
    const step = draft.steps[stepIndex]!;
    const cap = capIndex.get(step.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    step.inputBindings[inputName] = defaultBindingForInput(inputName, meta);
    draft.steps = [...draft.steps];
  }

  function removeOptionalInput(stepIndex: number, inputName: string) {
    const step = draft.steps[stepIndex]!;
    delete step.inputBindings[inputName];
    draft.steps = [...draft.steps];
  }

  function removeStep(index: number) {
    const filtered = draft.steps.filter((_, i) => i !== index);
    // Any priorOutput that pointed at (or past) the removed step becomes
    // dangling — reset it to a fresh default so the user is forced to rewire.
    for (let i = 0; i < filtered.length; i++) {
      const step = filtered[i]!;
      for (const [name, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind === 'priorOutput' && binding.stepPosition >= index) {
          const cap = capIndex.get(step.capabilityId);
          const meta = cap?.inputMeta[name];
          step.inputBindings[name] = defaultBindingForInput(
            name,
            meta ?? { allowedBindings: ['literal'] },
          );
        }
      }
    }
    draft.steps = filtered;
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    draft.steps = next;
  }

  function changeBindingKind(stepIndex: number, inputName: string, kind: BindingKind) {
    const step = draft.steps[stepIndex]!;
    const cap = capIndex.get(step.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    const entityType = meta.entityType ?? '';
    const literalValue =
      meta.typeHint === 'boolean' ? false : meta.typeHint === 'stringArray' ? [] : '';
    const binding: Binding =
      kind === 'literal'
        ? { kind: 'literal', value: literalValue }
        : kind === 'runtime'
          ? { kind: 'runtime', promptKey: inputName, required: true }
          : kind === 'entity'
            ? { kind: 'entity', source: 'picker', entityType }
            : { kind: 'priorOutput', stepPosition: 0, path: '' };
    step.inputBindings[inputName] = binding;
    draft.steps = [...draft.steps];
  }

  function setBinding(stepIndex: number, inputName: string, binding: Binding) {
    draft.steps[stepIndex]!.inputBindings[inputName] = binding;
    draft.steps = [...draft.steps];
  }

  function bindingHint(kind: BindingKind): string {
    if (kind === 'literal') return 'Same value every run';
    if (kind === 'runtime') return 'Asked at run time';
    if (kind === 'entity') return 'Picked from your data';
    return 'From a prior step';
  }

  function canSave(): boolean {
    if (!draft.name.trim()) return false;
    if (draft.steps.length === 0) return false;
    for (const step of draft.steps) {
      const cap = capIndex.get(step.capabilityId);
      if (!cap) return false;
      for (const [name, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind === 'runtime' && !binding.promptKey.trim()) return false;
        if (binding.kind === 'priorOutput' && !binding.path.trim()) return false;
        if (binding.kind === 'literal') {
          const meta = cap.inputMeta[name];
          if (!meta) return false;
        }
      }
    }
    return true;
  }
</script>

<div class="flex size-full flex-col overflow-hidden">
  <header class="border-b bg-background">
    <div class="flex flex-wrap items-center gap-4 px-6 py-4">
      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => goto('/automation/packages')}
      >
        <ArrowLeft class="size-3.5" />
        All packages
      </button>
      <div class="min-w-0 flex-1">
        <Input
          placeholder="Untitled package"
          value={draft.name}
          oninput={(e) => (draft.name = (e.target as HTMLInputElement).value)}
          class="h-10 w-full max-w-lg text-base font-semibold"
        />
      </div>
      <Badge variant="outline" class={statusBadgeClass + ' capitalize'}>{draft.status}</Badge>
      <Select.Root type="single" bind:value={draft.status}>
        <Select.Trigger class="h-10 w-32 capitalize">{draft.status}</Select.Trigger>
        <Select.Content>
          <Select.Item value="draft">Draft</Select.Item>
          <Select.Item value="active">Active</Select.Item>
          <Select.Item value="archived">Archived</Select.Item>
        </Select.Content>
      </Select.Root>
      <Button onclick={() => onSave(draft)} disabled={!canSave() || saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
    {#if !canSave() && draft.name.trim() && draft.steps.length > 0}
      <div class="border-t bg-amber-500/5 px-6 py-2 text-xs text-amber-600 dark:text-amber-500">
        Fill in every input's binding — runtime bindings need a prompt key, prior-output
        bindings need a source field.
      </div>
    {/if}
  </header>

  <div class="flex-1 overflow-auto">
    <div class="flex flex-col gap-6 p-6">
      <Input
        placeholder="Describe what this package does…"
        value={draft.description}
        oninput={(e) => (draft.description = (e.target as HTMLInputElement).value)}
        class="h-10 w-full max-w-2xl text-sm"
      />

      {#if draft.steps.length === 0}
        <div class="rounded-lg border border-dashed p-12 text-center">
          <h2 class="text-base font-medium">No steps yet</h2>
          <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Steps run in order. Each one wraps a managed capability. Pick your first one
            below to start.
          </p>
        </div>
      {/if}

      <div class="max-w-4xl space-y-0">
        {#each draft.steps as step, stepIndex (stepIndex)}
          {@const cap = capIndex.get(step.capabilityId)}
          {@const isLast = stepIndex === draft.steps.length - 1}
          <div class="grid grid-cols-[36px_1fr] gap-4">
            <div class="flex flex-col items-center">
              <StepNode status="draft" number={stepIndex + 1} />
              {#if !isLast}
                <div class="w-px flex-1 border-l border-dashed border-border"></div>
              {/if}
            </div>
            <div class={isLast ? 'pb-2' : 'pb-6'}>
              <div class="rounded-lg border bg-card">
                <div class="flex items-start justify-between gap-3 border-b p-4">
                  <div class="min-w-0 space-y-0.5">
                    <div class="font-medium">
                      {cap?.name ?? step.capabilityId}
                    </div>
                    <div class="font-mono text-xs text-muted-foreground">
                      {step.capabilityId}
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="size-8 p-0"
                      onclick={() => moveStep(stepIndex, -1)}
                      disabled={stepIndex === 0}
                      aria-label="Move up"
                    >
                      <ArrowUp class="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="size-8 p-0"
                      onclick={() => moveStep(stepIndex, 1)}
                      disabled={stepIndex === draft.steps.length - 1}
                      aria-label="Move down"
                    >
                      <ArrowDown class="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="size-8 p-0 text-muted-foreground hover:text-rose-500"
                      onclick={() => removeStep(stepIndex)}
                      aria-label="Remove step"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                </div>

                {#if cap}
                  {@const boundInputNames = Object.keys(step.inputBindings)}
                  {@const availableOptional = Object.entries(cap.inputMeta)
                    .filter(
                      ([name, meta]) =>
                        !isRequiredInput(meta) && !(name in step.inputBindings),
                    )
                    .map(([name, meta]) => ({
                      value: name,
                      label: fieldLabel(name, (meta as { label?: string }).label),
                    }))}
                  <div class="divide-y">
                    {#each boundInputNames as inputName (inputName)}
                      {@const meta = cap.inputMeta[inputName]}
                      {#if meta}
                        {@const binding = step.inputBindings[inputName]}
                        {@const label = fieldLabel(inputName, meta.label)}
                        {@const optional = !isRequiredInput(meta)}
                        <div class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[200px_1fr]">
                          <div class="space-y-0.5">
                            <div class="flex items-start justify-between gap-2">
                              <div class="text-sm font-medium">{label}</div>
                              {#if optional}
                                <button
                                  type="button"
                                  class="text-muted-foreground transition-colors hover:text-rose-500"
                                  aria-label={`Remove ${label}`}
                                  onclick={() => removeOptionalInput(stepIndex, inputName)}
                                >
                                  <Trash2 class="size-3.5" />
                                </button>
                              {/if}
                            </div>
                            {#if meta.description}
                              <div class="text-xs text-muted-foreground">{meta.description}</div>
                            {/if}
                            <div class="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] uppercase tracking-wide">
                              {#if optional}
                                <span class="text-muted-foreground">Optional</span>
                              {/if}
                              {#if meta.sensitive}
                                <span class="text-amber-600 dark:text-amber-500">Sensitive</span>
                              {/if}
                              {#if meta.entityType}
                                <span class="text-muted-foreground">
                                  {meta.entityType.replace('_', ' ')}
                                </span>
                              {/if}
                            </div>
                          </div>
                        <div class="space-y-2">
                          <div class="flex flex-wrap items-center gap-2">
                            <Select.Root
                              type="single"
                              value={binding?.kind ?? 'literal'}
                              onValueChange={(v) =>
                                changeBindingKind(stepIndex, inputName, v as BindingKind)}
                            >
                              <Select.Trigger class="h-8 w-32 text-xs capitalize">
                                {binding?.kind ?? 'literal'}
                              </Select.Trigger>
                              <Select.Content>
                                {#each meta.allowedBindings as kind}
                                  <Select.Item value={kind} class="capitalize">
                                    {kind}
                                  </Select.Item>
                                {/each}
                              </Select.Content>
                            </Select.Root>
                            <span class="text-xs text-muted-foreground">
                              {bindingHint(binding?.kind ?? 'literal')}
                            </span>
                          </div>

                          <div>
                            {#if binding?.kind === 'literal'}
                              {#if meta.entityType}
                                <EntityPicker
                                  entityType={meta.entityType as EntityType}
                                  multiple={meta.typeHint === 'stringArray'}
                                  value={binding.value as string | string[] | null}
                                  onValueChange={(v) =>
                                    setBinding(stepIndex, inputName, {
                                      kind: 'literal',
                                      value: v,
                                    })}
                                />
                              {:else if meta.typeHint === 'boolean'}
                                <label class="flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={Boolean(binding.value)}
                                    onCheckedChange={(c) =>
                                      setBinding(stepIndex, inputName, {
                                        kind: 'literal',
                                        value: Boolean(c),
                                      })}
                                  />
                                  <span class="text-muted-foreground">
                                    {binding.value ? 'true' : 'false'}
                                  </span>
                                </label>
                              {:else if meta.typeHint === 'stringArray'}
                                <Input
                                  placeholder="value1, value2"
                                  value={Array.isArray(binding.value)
                                    ? (binding.value as string[]).join(', ')
                                    : ''}
                                  oninput={(e) => {
                                    const raw = (e.target as HTMLInputElement).value;
                                    const arr = raw
                                      .split(',')
                                      .map((v) => v.trim())
                                      .filter(Boolean);
                                    setBinding(stepIndex, inputName, {
                                      kind: 'literal',
                                      value: arr,
                                    });
                                  }}
                                />
                              {:else}
                                <Input
                                  type={meta.sensitive ? 'password' : 'text'}
                                  value={typeof binding.value === 'string' ? binding.value : ''}
                                  oninput={(e) =>
                                    setBinding(stepIndex, inputName, {
                                      kind: 'literal',
                                      value: (e.target as HTMLInputElement).value,
                                    })}
                                />
                              {/if}
                            {:else if binding?.kind === 'runtime'}
                              <div class="flex flex-wrap items-center gap-2">
                                <Input
                                  placeholder="Prompt key"
                                  value={binding.promptKey}
                                  oninput={(e) =>
                                    setBinding(stepIndex, inputName, {
                                      ...binding,
                                      promptKey: (e.target as HTMLInputElement).value,
                                    })}
                                  class="max-w-xs"
                                />
                                <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Checkbox
                                    checked={binding.required}
                                    onCheckedChange={(c) =>
                                      setBinding(stepIndex, inputName, {
                                        ...binding,
                                        required: Boolean(c),
                                      })}
                                  />
                                  Required
                                </label>
                              </div>
                            {:else if binding?.kind === 'entity'}
                              <Select.Root
                                type="single"
                                value={binding.source}
                                onValueChange={(v) =>
                                  setBinding(stepIndex, inputName, {
                                    ...binding,
                                    source: v as 'row-context' | 'picker',
                                  })}
                              >
                                <Select.Trigger class="h-9 w-52 text-sm">
                                  {binding.source === 'picker'
                                    ? 'Prompt with picker'
                                    : 'From row context'}
                                </Select.Trigger>
                                <Select.Content>
                                  <Select.Item value="picker">Prompt with picker</Select.Item>
                                  <Select.Item value="row-context">From row context</Select.Item>
                                </Select.Content>
                              </Select.Root>
                            {:else if binding?.kind === 'priorOutput'}
                              {@const upstreamSteps = draft.steps.slice(0, stepIndex)}
                              {@const upstreamCap = capIndex.get(
                                upstreamSteps[binding.stepPosition]?.capabilityId ?? '',
                              )}
                              {@const stepOpts = upstreamSteps.map((s, i) => ({
                                value: String(i),
                                label: `Step ${i + 1}: ${s.label ?? s.capabilityId}`,
                              }))}
                              {@const outputOpts = upstreamCap
                                ? Object.entries(upstreamCap.outputMeta).map(([k, m]) => ({
                                    value: k,
                                    label: fieldLabel(k, (m as { label?: string }).label),
                                  }))
                                : []}
                              <div class="grid gap-2 sm:grid-cols-2">
                                <SingleSelect
                                  options={stepOpts}
                                  selected={String(binding.stepPosition)}
                                  placeholder="Prior step…"
                                  disableSort
                                  onchange={(v) =>
                                    setBinding(stepIndex, inputName, {
                                      ...binding,
                                      stepPosition: Number(v),
                                      path: '',
                                    })}
                                />
                                <SingleSelect
                                  options={outputOpts}
                                  selected={binding.path}
                                  placeholder="Output field…"
                                  onchange={(v) =>
                                    setBinding(stepIndex, inputName, { ...binding, path: v })}
                                />
                              </div>
                            {/if}
                          </div>
                        </div>
                      </div>
                      {/if}
                    {/each}
                    {#if availableOptional.length > 0}
                      <div class="flex flex-wrap items-center gap-2 p-4">
                        <div class="min-w-64 sm:max-w-72">
                          <SingleSelect
                            options={availableOptional}
                            selected=""
                            placeholder="Add an optional field…"
                            onchange={(v) => v && addOptionalInput(stepIndex, v)}
                          />
                        </div>
                        <span class="text-xs text-muted-foreground">
                          {availableOptional.length} available
                        </span>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="p-4 text-sm text-rose-500">
                    Unknown capability: {step.capabilityId}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}

        <div class="grid grid-cols-[36px_1fr] gap-4">
          <div class="flex flex-col items-center">
            <div class="flex size-9 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 text-muted-foreground">
              <Plus class="size-4" />
            </div>
          </div>
          <div class="pb-2">
            <div class="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-4">
              <div class="flex-1 min-w-64 sm:max-w-96">
                <SingleSelect
                  options={capabilityOptions}
                  selected={addingCapabilityId}
                  placeholder="Add a capability…"
                  onchange={(v) => (addingCapabilityId = v)}
                />
              </div>
              <Button class="gap-1.5" disabled={!addingCapabilityId} onclick={addStep}>
                <Plus class="size-4" />
                Add step
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
