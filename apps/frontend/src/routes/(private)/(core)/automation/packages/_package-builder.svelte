<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Card from '$lib/components/ui/card';
  import * as Select from '$lib/components/ui/select/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import EntityPicker from '$lib/components/domain/entity-picker.svelte';
  import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/svelte';

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

  const capIndex = $derived(
    new Map((capabilitiesQuery.data ?? []).map((c) => [c.id, c])),
  );

  function defaultBindingForInput(meta: {
    allowedBindings: readonly string[];
    entityType?: string;
    typeHint?: string;
  }): Binding {
    // Prefer runtime if allowed — it's the safest default for a fresh input.
    if (meta.allowedBindings.includes('runtime')) {
      return { kind: 'runtime', promptKey: '', required: true };
    }
    if (meta.allowedBindings.includes('literal')) {
      const initialValue =
        meta.typeHint === 'boolean' ? false : meta.typeHint === 'stringArray' ? [] : '';
      return { kind: 'literal', value: initialValue };
    }
    if (meta.allowedBindings.includes('entity')) {
      return {
        kind: 'entity',
        source: 'picker',
        entityType: meta.entityType ?? '',
      };
    }
    return { kind: 'priorOutput', stepPosition: 0, path: '' };
  }

  function addStep() {
    if (!addingCapabilityId) return;
    const cap = capIndex.get(addingCapabilityId);
    if (!cap) return;
    const inputBindings: Record<string, Binding> = {};
    for (const [name, meta] of Object.entries(cap.inputMeta)) {
      inputBindings[name] = defaultBindingForInput(meta);
    }
    draft.steps = [
      ...draft.steps,
      { capabilityId: cap.id, label: cap.name, inputBindings },
    ];
    addingCapabilityId = '';
  }

  function removeStep(index: number) {
    // Adjust priorOutput references pointing at the removed or later steps.
    const filtered = draft.steps.filter((_, i) => i !== index);
    for (let i = 0; i < filtered.length; i++) {
      const step = filtered[i]!;
      for (const [name, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind === 'priorOutput' && binding.stepPosition >= index) {
          // Drop dangling reference — user must rewire.
          const cap = capIndex.get(step.capabilityId);
          const meta = cap?.inputMeta[name];
          step.inputBindings[name] = defaultBindingForInput(
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
    const initialValue =
      meta.typeHint === 'boolean' ? false : meta.typeHint === 'stringArray' ? [] : '';
    const binding: Binding =
      kind === 'literal'
        ? { kind: 'literal', value: initialValue }
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

<div class="flex size-full flex-col gap-4 overflow-auto p-6">
  <div class="flex items-start justify-between gap-3">
    <div class="flex-1 space-y-2">
      <Input
        placeholder="Package name"
        value={draft.name}
        oninput={(e) => (draft.name = (e.target as HTMLInputElement).value)}
        class="max-w-md text-lg font-semibold"
      />
      <Input
        placeholder="Description (optional)"
        value={draft.description}
        oninput={(e) => (draft.description = (e.target as HTMLInputElement).value)}
        class="max-w-lg"
      />
    </div>
    <div class="flex items-center gap-2">
      <Select.Root type="single" bind:value={draft.status}>
        <Select.Trigger class="w-32 capitalize">{draft.status}</Select.Trigger>
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
  </div>

  <div class="space-y-3">
    {#each draft.steps as step, stepIndex (stepIndex)}
      {@const cap = capIndex.get(step.capabilityId)}
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center justify-between text-base">
            <span>Step {stepIndex + 1}: {cap?.name ?? step.capabilityId}</span>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onclick={() => moveStep(stepIndex, -1)}
                disabled={stepIndex === 0}
              >
                <ArrowUp class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => moveStep(stepIndex, 1)}
                disabled={stepIndex === draft.steps.length - 1}
              >
                <ArrowDown class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-rose-500"
                onclick={() => removeStep(stepIndex)}
              >
                <Trash2 class="size-4" />
              </Button>
            </div>
          </Card.Title>
          {#if cap?.description}
            <Card.Description>{cap.description}</Card.Description>
          {/if}
        </Card.Header>
        <Card.Content>
          {#if cap}
            <div class="space-y-3">
              {#each Object.entries(cap.inputMeta) as [inputName, meta]}
                {@const binding = step.inputBindings[inputName]}
                <div class="grid grid-cols-[180px_120px_1fr] items-start gap-3">
                  <div class="pt-1">
                    <div class="font-mono text-xs">{inputName}</div>
                    {#if meta.sensitive}
                      <div class="text-[10px] uppercase text-amber-500">sensitive</div>
                    {/if}
                  </div>
                  <Select.Root
                    type="single"
                    value={binding?.kind ?? 'literal'}
                    onValueChange={(v) =>
                      changeBindingKind(stepIndex, inputName, v as BindingKind)}
                  >
                    <Select.Trigger class="text-xs">{binding?.kind ?? 'literal'}</Select.Trigger>
                    <Select.Content>
                      {#each meta.allowedBindings as kind}
                        <Select.Item value={kind}>{kind}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                  <div>
                    {#if binding?.kind === 'literal'}
                      {#if meta.entityType}
                        <EntityPicker
                          entityType={meta.entityType as EntityType}
                          multiple={meta.typeHint === 'stringArray'}
                          value={binding.value as string | string[] | null}
                          onValueChange={(v) =>
                            setBinding(stepIndex, inputName, { kind: 'literal', value: v })}
                        />
                      {:else if meta.typeHint === 'boolean'}
                        <Checkbox
                          checked={Boolean(binding.value)}
                          onCheckedChange={(c) =>
                            setBinding(stepIndex, inputName, { kind: 'literal', value: Boolean(c) })}
                        />
                      {:else if meta.typeHint === 'stringArray'}
                        <Input
                          placeholder="value1, value2"
                          value={Array.isArray(binding.value)
                            ? (binding.value as string[]).join(', ')
                            : ''}
                          oninput={(e) => {
                            const raw = (e.target as HTMLInputElement).value;
                            const arr = raw.split(',').map((v) => v.trim()).filter(Boolean);
                            setBinding(stepIndex, inputName, { kind: 'literal', value: arr });
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
                      <div class="flex items-center gap-2">
                        <Input
                          placeholder="promptKey"
                          value={binding.promptKey}
                          oninput={(e) =>
                            setBinding(stepIndex, inputName, {
                              ...binding,
                              promptKey: (e.target as HTMLInputElement).value,
                            })}
                        />
                        <label class="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={binding.required}
                            onCheckedChange={(c) =>
                              setBinding(stepIndex, inputName, {
                                ...binding,
                                required: Boolean(c),
                              })}
                          />
                          required
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
                        <Select.Trigger class="text-xs">{binding.source}</Select.Trigger>
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
                      <div class="flex items-center gap-2">
                        <Select.Root
                          type="single"
                          value={String(binding.stepPosition)}
                          onValueChange={(v) =>
                            setBinding(stepIndex, inputName, {
                              ...binding,
                              stepPosition: Number(v),
                              path: '',
                            })}
                        >
                          <Select.Trigger class="text-xs">
                            Step {binding.stepPosition + 1}
                          </Select.Trigger>
                          <Select.Content>
                            {#each upstreamSteps as _s, i}
                              <Select.Item value={String(i)}>Step {i + 1}</Select.Item>
                            {/each}
                          </Select.Content>
                        </Select.Root>
                        <Select.Root
                          type="single"
                          value={binding.path}
                          onValueChange={(v) =>
                            setBinding(stepIndex, inputName, { ...binding, path: v })}
                        >
                          <Select.Trigger class="text-xs">
                            {binding.path || 'output field…'}
                          </Select.Trigger>
                          <Select.Content>
                            {#if upstreamCap}
                              {#each Object.keys(upstreamCap.outputMeta) as field}
                                <Select.Item value={field}>{field}</Select.Item>
                              {/each}
                            {/if}
                          </Select.Content>
                        </Select.Root>
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-rose-500">
              Unknown capability: {step.capabilityId}
            </p>
          {/if}
        </Card.Content>
      </Card.Root>
    {/each}

    <Card.Root>
      <Card.Content class="flex items-center gap-2 py-4">
        <Select.Root type="single" bind:value={addingCapabilityId}>
          <Select.Trigger class="w-72">
            {addingCapabilityId
              ? capIndex.get(addingCapabilityId)?.name
              : 'Choose a capability…'}
          </Select.Trigger>
          <Select.Content>
            {#each capabilitiesQuery.data ?? [] as cap}
              <Select.Item value={cap.id}>
                {cap.name} <span class="ml-2 text-xs text-muted-foreground">{cap.category}</span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <Button
          class="gap-1"
          disabled={!addingCapabilityId}
          onclick={addStep}
        >
          <Plus class="size-4" />
          Add step
        </Button>
      </Card.Content>
    </Card.Root>
  </div>
</div>
