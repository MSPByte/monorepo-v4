<script lang="ts" module>
  export type Binding =
    | { kind: 'literal'; value: unknown }
    | { kind: 'runtime'; promptKey: string; required: boolean }
    | {
        kind: 'entity';
        source: 'row-context' | 'picker';
        entityType: string;
        contextKey?: string;
      }
    | { kind: 'priorOutput'; stepPosition: number; path: string; lane?: 'main' | 'onSuccess' | 'onFailure' }
    | { kind: 'failureContext'; path: 'runId' | 'status' | 'siteId' | 'stepPosition' | 'capabilityId' | 'capabilityName' | 'errorClass' | 'message' }
    | { kind: 'generated'; generator: string; params: Record<string, unknown> }
    | { kind: 'siteFact'; key: string; required: boolean }
    | { kind: 'template'; template: string };

  export type Step = {
    capabilityId: string;
    label?: string;
    optional?: boolean;
    inputBindings: Record<string, Binding>;
  };

  export type PackagePrompt = {
    id: string;
    label: string;
    description?: string;
    required: boolean;
    section?: string;
    order: number;
  };

  export type OutcomeSteps = {
    onSuccess: Step[];
    onFailure: Step[];
  };

  export type PackageDraft = {
    name: string;
    description: string;
    status: 'draft' | 'active' | 'archived';
    steps: Step[];
    prompts: PackagePrompt[];
    outcomeSteps: OutcomeSteps;
    // Empty arrays => global. Non-empty restricts which sites, groups, or
    // tenant links this package can run against.
    allowedSites: string[];
    allowedSiteGroups: string[];
    allowedIntegrationLinks: string[];
  };
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import EntityPicker from '$lib/components/domain/entity-picker.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import BindingVariableInserter from '$lib/components/binding-variable-inserter.svelte';
  import CapabilityPicker from './_capability-picker.svelte';
  import PackageDetails from './_package-details.svelte';
  import {
    inputTypeLabel,
    sourceBorderClass,
    sourceHint,
    sourceIconColor,
    sourceLabel,
    sourceOf,
    type Source,
  } from './_binding-presentation';
  import { fieldLabel } from '$lib/utils/label';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import {
    ArrowLeft,
    ArrowUp,
    ArrowDown,
    ChevronUp,
    ChevronDown,
    Plus,
    Trash2,
    ArrowUpRight,
    CornerDownRight,
    Keyboard,
    Database,
    Pin,
    Link2,
    Sparkles,
    Circle,
    AlertTriangle,
    Info,
    SlidersHorizontal,
    Braces,
    TriangleAlert,
    CheckCircle2,
  } from '@lucide/svelte';

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license' | 'm365_role';
  type Selection =
    | { kind: 'details' }
    | { kind: 'step'; index: number }
    | { kind: 'reaction'; lane: 'onSuccess' | 'onFailure'; index: number };

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

  const generatorsQuery = createQuery(() => ({
    queryKey: ['packages.metadata.generators'],
    queryFn: () => trpc.packages.generators.query(),
    staleTime: 5 * 60_000,
  }));

  const siteFactFieldsQuery = createQuery(() => ({
    queryKey: ['packages.metadata.siteFactFields'],
    queryFn: () => trpc.packages.siteFactFields.query(),
    staleTime: 5 * 60_000,
  }));

  // Matches declared site facts to an input's loose type hint.
  function factFieldsFor(typeHint: string | undefined) {
    const all = siteFactFieldsQuery.data ?? [];
    if (!typeHint) return all;
    return all.filter((f) => {
      if (typeHint === 'boolean') return f.type === 'boolean' && f.valueMode === 'single';
      if (typeHint === 'number') return f.type === 'number' && f.valueMode === 'single';
      if (typeHint === 'stringArray') return f.type === 'string' && f.valueMode === 'multiple';
      // text / password / upn: any single-value string field.
      return f.type === 'string' && f.valueMode === 'single';
    });
  }

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list.scopePicker'],
    queryFn: () => trpc.sites.list.query(),
    staleTime: 60_000,
  }));

  const siteGroupsQuery = createQuery(() => ({
    queryKey: ['siteGroups.list.scopePicker'],
    queryFn: () => trpc.siteGroups.list.query(),
    staleTime: 60_000,
  }));

  const siteOptions = $derived(
    (sitesQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))
  );
  const siteGroupOptions = $derived(
    (siteGroupsQuery.data ?? []).map((g) => ({ value: g.id, label: g.name }))
  );
  const tenantLinksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list.packageScope'],
    queryFn: () => trpc.integrationLinks.list.query({ status: 'active' }),
    staleTime: 60_000,
  }));
  const tenantLinkOptions = $derived(
    (tenantLinksQuery.data ?? [])
      .filter((link) => INTEGRATIONS[link.integrationId as ProviderId]?.scope === 'tenant')
      .map((link) => ({
        value: link.id,
        label: link.name ?? link.externalId ?? link.id,
        subLabel: INTEGRATIONS[link.integrationId as ProviderId]?.name ?? link.integrationId,
      }))
  );

  // Finds the first runtime generator that supports this input type.
  function generatorFor(
    typeHint: string | undefined
  ): { id: string; defaults: Record<string, unknown> } | undefined {
    if (!typeHint) return undefined;
    const g = (generatorsQuery.data ?? []).find((gen) => gen.appliesToTypeHints.includes(typeHint));
    return g ? { id: g.id, defaults: g.defaults as Record<string, unknown> } : undefined;
  }

  let draft = $state<PackageDraft>({
    name: initial.name,
    description: initial.description,
    status: initial.status,
    steps: structuredClone(initial.steps),
    prompts: structuredClone(initial.prompts ?? []),
    outcomeSteps: structuredClone(initial.outcomeSteps ?? { onSuccess: [], onFailure: [] }),
    allowedSites: [...(initial.allowedSites ?? [])],
    allowedSiteGroups: [...(initial.allowedSiteGroups ?? [])],
    allowedIntegrationLinks: [...(initial.allowedIntegrationLinks ?? [])],
  });

  // The inspector selection can target package details, a main step, or a terminal reaction.
  let selected = $state<Selection>(initial.steps.length > 0 ? { kind: 'step', index: 0 } : { kind: 'details' });
  let capabilityPickerOpen = $state(false);
  let capabilityPickerTarget = $state<'main' | 'onSuccess' | 'onFailure'>('main');
  let activeTemplateRef = $state<HTMLTextAreaElement | null>(null);

  const capIndex = $derived(new Map((capabilitiesQuery.data ?? []).map((c) => [c.id, c])));


  function allowedSourcesFor(meta: {
    allowedBindings: readonly string[];
    typeHint?: string;
    entityType?: string;
    sensitive?: boolean;
  }, allowFailureContext = false): Source[] {
    const set = new Set(meta.allowedBindings);
    const out: Source[] = [];
    if (set.has('literal')) out.push('fixed');
    // Templates only apply to non-sensitive scalar text inputs.
    if (
      set.has('literal') &&
      !meta.entityType &&
      !meta.sensitive &&
      meta.typeHint !== 'boolean' &&
      meta.typeHint !== 'stringArray'
    ) {
      out.push('template');
    }
    if (set.has('runtime') || set.has('entity')) out.push('runtime');
    if (set.has('priorOutput')) out.push('wire');
    if (allowFailureContext && set.has('failureContext')) out.push('failure');
    // Avoid presenting generator UI when no registered generator can fulfill it.
    if (set.has('generated') && generatorFor(meta.typeHint)) out.push('generated');
    if (set.has('siteFact')) out.push('fact');
    return out;
  }

  function isRequiredInput(meta: { required?: boolean }): boolean {
    return meta.required !== false;
  }

  function defaultBindingFor(
    source: Source,
    inputName: string,
    meta: {
      allowedBindings: readonly string[];
      entityType?: string;
      typeHint?: string;
      required?: boolean;
      defaultValue?: unknown;
    }
  ): Binding {
    if (source === 'fixed') {
      const initialValue =
        meta.defaultValue ?? (meta.typeHint === 'boolean' ? false : meta.typeHint === 'stringArray' ? [] : '');
      return { kind: 'literal', value: initialValue };
    }
    if (source === 'runtime') {
      // Entity-only schemas must retain their server-valid picker shape.
      if (!meta.allowedBindings.includes('runtime') && meta.allowedBindings.includes('entity')) {
        return { kind: 'entity', source: 'picker', entityType: meta.entityType ?? '' };
      }
      return { kind: 'runtime', promptKey: inputName, required: meta.required !== false };
    }
    if (source === 'row') {
      return { kind: 'entity', source: 'row-context', entityType: meta.entityType ?? '' };
    }
    if (source === 'generated') {
      const gen = generatorFor(meta.typeHint);
      if (!gen) return { kind: 'literal', value: '' };
      return {
        kind: 'generated',
        generator: gen.id,
        params: { ...gen.defaults },
      };
    }
    if (source === 'fact') {
      return { kind: 'siteFact', key: '', required: true };
    }
    if (source === 'failure') return { kind: 'failureContext', path: 'message' };
    if (source === 'template') return { kind: 'template', template: '' };
    return { kind: 'priorOutput', stepPosition: 0, path: '' };
  }

  function defaultForInput(
    inputName: string,
    meta: {
      allowedBindings: readonly string[];
      entityType?: string;
      typeHint?: string;
      required?: boolean;
      defaultValue?: unknown;
    }
  ): Binding {
    const allowed = allowedSourcesFor(meta);
    const preferred: Source =
      meta.defaultValue !== undefined && allowed.includes('fixed')
        ? 'fixed'
        : allowed.includes('runtime')
          ? 'runtime'
          : (allowed[0] ?? 'fixed');
    return defaultBindingFor(preferred, inputName, meta);
  }

  function failurePromptKey(inputName: string): string {
    return `onFailure.${inputName}`;
  }

  function promptFor(
    promptKey: string,
    inputName: string,
    meta: { label?: string; description?: string; required?: boolean },
    lane: 'main' | 'onSuccess' | 'onFailure' = 'main',
  ) {
    return {
      id: promptKey,
      label: fieldLabel(inputName, meta.label),
      description: meta.description,
      required: meta.required !== false,
      section: lane === 'onFailure' ? 'On failure' : 'Run details',
      order: draft.prompts.length,
    } satisfies PackagePrompt;
  }

  function ensurePrompt(
    promptKey: string,
    inputName: string,
    meta: { label?: string; description?: string; required?: boolean },
    lane: 'main' | 'onSuccess' | 'onFailure' = 'main',
  ) {
    if (draft.prompts.some((prompt) => prompt.id === promptKey)) return;
    draft.prompts = [...draft.prompts, promptFor(promptKey, inputName, meta, lane)];
  }

  function runtimeBindingForLane(
    binding: Binding,
    inputName: string,
    meta: { label?: string; description?: string; required?: boolean },
    lane: 'main' | 'onSuccess' | 'onFailure',
  ): Binding {
    if (binding.kind !== 'runtime') return binding;
    const promptKey = lane === 'onFailure' ? failurePromptKey(inputName) : inputName;
    ensurePrompt(promptKey, inputName, meta, lane);
    return { ...binding, promptKey };
  }

  function activePromptIds(): Set<string> {
    const ids = new Set<string>();
    const allSteps = [
      ...draft.steps,
      ...draft.outcomeSteps.onSuccess,
      ...draft.outcomeSteps.onFailure,
    ];
    for (const step of allSteps) {
      for (const binding of Object.values(step.inputBindings)) {
        if (binding.kind === 'runtime') ids.add(binding.promptKey);
      }
    }
    return ids;
  }

  function promptIdsForSteps(steps: Step[]): Set<string> {
    const ids = new Set<string>();
    for (const step of steps) {
      for (const binding of Object.values(step.inputBindings)) {
        if (binding.kind === 'runtime') ids.add(binding.promptKey);
      }
    }
    return ids;
  }

  function pruneUnusedPrompts() {
    const active = activePromptIds();
    draft.prompts = draft.prompts.filter((prompt) => active.has(prompt.id));
  }

  function buildStep(capabilityId: string, lane: 'main' | 'onSuccess' | 'onFailure' = 'main'): Step | null {
    if (!capabilityId) return null;
    const cap = capIndex.get(capabilityId);
    if (!cap) return null;
    const inputBindings: Record<string, Binding> = {};
    for (const [name, meta] of Object.entries(cap.inputMeta)) {
      if (!isRequiredInput(meta)) continue;
      inputBindings[name] = runtimeBindingForLane(defaultForInput(name, meta), name, meta, lane);
    }
    return { capabilityId: cap.id, label: cap.name, optional: false, inputBindings };
  }

  function addStep(capabilityId: string) {
    const step = buildStep(capabilityId, capabilityPickerTarget);
    if (!step) return;
    if (capabilityPickerTarget === 'main') {
      const nextIndex = draft.steps.length;
      draft.steps = [...draft.steps, step];
      selected = { kind: 'step', index: nextIndex };
    } else {
      const lane = capabilityPickerTarget;
      const nextIndex = draft.outcomeSteps[lane].length;
      draft.outcomeSteps = {
        ...draft.outcomeSteps,
        [lane]: [...draft.outcomeSteps[lane], step],
      };
      selected = { kind: 'reaction', lane, index: nextIndex };
    }
    capabilityPickerOpen = false;
  }

  function openCapabilityPicker(target: 'main' | 'onSuccess' | 'onFailure' = 'main') {
    capabilityPickerTarget = target;
    capabilityPickerOpen = true;
  }

  function removeOutcomeStep(lane: 'onSuccess' | 'onFailure', index: number) {
    draft.outcomeSteps = {
      ...draft.outcomeSteps,
      [lane]: draft.outcomeSteps[lane].filter((_, position) => position !== index),
    };
    pruneUnusedPrompts();
    if (selected.kind === 'reaction' && selected.lane === lane && selected.index === index) {
      selected = { kind: 'details' };
    }
  }

  function remapMovedSourcePosition(position: number, from: number, to: number): number {
    if (position === from) return to;
    if (from < to && position > from && position <= to) return position - 1;
    if (from > to && position >= to && position < from) return position + 1;
    return position;
  }

  // Wires identify a source by its position. Reordering must carry every
  // source reference with the step it belongs to, across the main path and
  // terminal reaction lanes.
  function remapMovedWireSources(
    movedLane: 'main' | 'onSuccess' | 'onFailure',
    from: number,
    to: number,
  ) {
    const remap = (steps: Step[]) => steps.map((step) => ({
      ...step,
      inputBindings: Object.fromEntries(
        Object.entries(step.inputBindings).map(([name, binding]) => {
          if (binding.kind !== 'priorOutput') return [name, binding];
          const sourceLane = binding.lane ?? 'main';
          if (sourceLane !== movedLane) return [name, binding];
          return [name, { ...binding, stepPosition: remapMovedSourcePosition(binding.stepPosition, from, to) }];
        }),
      ),
    }));

    draft.steps = remap(draft.steps);
    draft.outcomeSteps = {
      onSuccess: remap(draft.outcomeSteps.onSuccess),
      onFailure: remap(draft.outcomeSteps.onFailure),
    };
  }

  function setWorkflowStepLabel(
    lane: 'main' | 'onSuccess' | 'onFailure',
    index: number,
    label: string,
  ) {
    const normalized = label.trim() || undefined;
    if (lane === 'main') {
      const step = draft.steps[index];
      if (!step) return;
      draft.steps = draft.steps.map((candidate, position) =>
        position === index ? { ...candidate, label: normalized } : candidate,
      );
      return;
    }
    const step = draft.outcomeSteps[lane][index];
    if (!step) return;
    draft.outcomeSteps = {
      ...draft.outcomeSteps,
      [lane]: draft.outcomeSteps[lane].map((candidate, position) =>
        position === index ? { ...candidate, label: normalized } : candidate,
      ),
    };
  }

  function moveReactionStep(lane: 'onSuccess' | 'onFailure', index: number, direction: -1 | 1) {
    const target = index + direction;
    const steps = draft.outcomeSteps[lane];
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    draft.outcomeSteps = { ...draft.outcomeSteps, [lane]: next };
    remapMovedWireSources(lane, index, target);
    if (selected.kind === 'reaction' && selected.lane === lane) {
      if (selected.index === index) selected = { kind: 'reaction', lane, index: target };
      else if (selected.index === target) selected = { kind: 'reaction', lane, index: index };
    }
  }

  function reactionStep(): Step | null {
    if (selected.kind !== 'reaction') return null;
    return draft.outcomeSteps[selected.lane][selected.index] ?? null;
  }

  function setReactionBinding(inputName: string, binding: Binding) {
    if (selected.kind !== 'reaction') return;
    const { lane, index } = selected;
    draft.outcomeSteps = {
      ...draft.outcomeSteps,
      [lane]: draft.outcomeSteps[lane].map((step, position) =>
        position === index ? { ...step, inputBindings: { ...step.inputBindings, [inputName]: binding } } : step,
      ),
    };
  }

  function changeReactionSource(inputName: string, source: Source) {
    if (selected.kind !== 'reaction') return;
    const reaction = reactionStep();
    if (!reaction) return;
    const cap = capIndex.get(reaction.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    const binding = runtimeBindingForLane(
      defaultBindingFor(source, inputName, meta),
      inputName,
      meta,
      selected.lane,
    );
    setReactionBinding(inputName, binding);
    pruneUnusedPrompts();
  }

  function addOptionalReactionInput(inputName: string) {
    if (selected.kind !== 'reaction') return;
    const reaction = reactionStep();
    if (!reaction) return;
    const cap = capIndex.get(reaction.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    const binding = runtimeBindingForLane(
      defaultForInput(inputName, meta),
      inputName,
      meta,
      selected.lane,
    );
    setReactionBinding(inputName, binding);
  }

  function removeOptionalReactionInput(inputName: string) {
    if (selected.kind !== 'reaction') return;
    const { lane, index } = selected;
    const reaction = draft.outcomeSteps[lane][index];
    if (!reaction) return;
    const nextBindings = { ...reaction.inputBindings };
    delete nextBindings[inputName];
    draft.outcomeSteps = {
      ...draft.outcomeSteps,
      [lane]: draft.outcomeSteps[lane].map((step, position) =>
        position === index ? { ...step, inputBindings: nextBindings } : step,
      ),
    };
    pruneUnusedPrompts();
  }

  type ReactionWireBinding = Extract<Binding, { kind: 'priorOutput' }>;

  function reactionWireSteps(): Array<{ value: string; label: string; lane: 'main' | 'onSuccess' | 'onFailure'; position: number; step: Step }> {
    if (selected.kind !== 'reaction') return [];
    const ownLane = selected.lane;
    // On-failure reactions cannot wire from main steps (main steps failed).
    const main = ownLane === 'onFailure' ? [] : draft.steps.map((step, position) => ({
      value: `main:${position}`,
      label: `Main · Step ${String(position + 1).padStart(2, '0')}: ${step.label ?? capIndex.get(step.capabilityId)?.name ?? step.capabilityId}`,
      lane: 'main' as const,
      position,
      step,
    }));
    const earlierReactions = draft.outcomeSteps[ownLane]
      .slice(0, selected.index)
      .map((step, position) => ({
        value: `${ownLane}:${position}`,
        label: `${ownLane === 'onSuccess' ? 'On success' : 'On failure'} · Step ${String(position + 1).padStart(2, '0')}: ${step.label ?? capIndex.get(step.capabilityId)?.name ?? step.capabilityId}`,
        lane: ownLane,
        position,
        step,
      }));
    return [...main, ...earlierReactions];
  }

  function reactionWireOutputs(binding: ReactionWireBinding, inputMeta: { priorOutputCompat?: readonly string[] }) {
    const sourceLane = binding.lane ?? 'main';
    const source = reactionWireSteps().find(
      (candidate) => candidate.lane === sourceLane && candidate.position === binding.stepPosition,
    );
    const cap = source ? capIndex.get(source.step.capabilityId) : undefined;
    if (!cap) return [];
    return Object.entries(cap.outputMeta)
      .filter(([, meta]) => {
        if (!inputMeta.priorOutputCompat || inputMeta.priorOutputCompat.length === 0) return true;
        return !!meta.outputType && inputMeta.priorOutputCompat.includes(meta.outputType);
      })
      .map(([value, meta]) => ({ value, label: fieldLabel(value, meta.label) }));
  }


  function setStepOptional(index: number, value: boolean) {
    draft.steps[index]!.optional = value;
    draft.steps = [...draft.steps];
  }


  function addOptionalInput(stepIndex: number, inputName: string) {
    if (selected.kind === 'reaction') {
      addOptionalReactionInput(inputName);
      return;
    }
    const step = draft.steps[stepIndex]!;
    const cap = capIndex.get(step.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    step.inputBindings[inputName] = defaultForInput(inputName, meta);
    if (step.inputBindings[inputName]?.kind === 'runtime') ensurePrompt(inputName, inputName, meta);
    draft.steps = [...draft.steps];
  }

  function removeOptionalInput(stepIndex: number, inputName: string) {
    if (selected.kind === 'reaction') {
      removeOptionalReactionInput(inputName);
      return;
    }
    const step = draft.steps[stepIndex]!;
    delete step.inputBindings[inputName];
    draft.steps = [...draft.steps];
    pruneUnusedPrompts();
  }

  function removeStep(index: number) {
    const filtered = draft.steps.filter((_, i) => i !== index);
    for (let i = 0; i < filtered.length; i++) {
      const step = filtered[i]!;
      for (const [name, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind === 'priorOutput' && binding.stepPosition >= index) {
          const cap = capIndex.get(step.capabilityId);
          const meta = cap?.inputMeta[name];
          step.inputBindings[name] = defaultForInput(
            name,
            meta ?? { allowedBindings: ['literal'] }
          );
        }
      }
    }
    draft.steps = filtered;
    if (selected.kind === 'step') {
      if (filtered.length === 0) selected = { kind: 'details' };
      else if (selected.index >= filtered.length) selected = { kind: 'step', index: filtered.length - 1 };
    }
    pruneUnusedPrompts();
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    draft.steps = next;
    remapMovedWireSources('main', index, target);
    if (selected.kind === 'step') {
      if (selected.index === index) selected = { kind: 'step', index: target };
      else if (selected.index === target) selected = { kind: 'step', index: index };
    }
  }

  function changeSource(stepIndex: number, inputName: string, source: Source) {
    if (selected.kind === 'reaction') {
      changeReactionSource(inputName, source);
      return;
    }
    const step = draft.steps[stepIndex]!;
    const cap = capIndex.get(step.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    step.inputBindings[inputName] = defaultBindingFor(source, inputName, meta);
    if (step.inputBindings[inputName]?.kind === 'runtime') ensurePrompt(inputName, inputName, meta);
    draft.steps = [...draft.steps];
    pruneUnusedPrompts();
  }

  function setBinding(stepIndex: number, inputName: string, binding: Binding) {
    if (selected.kind === 'reaction') {
      setReactionBinding(inputName, binding);
      return;
    }
    draft.steps[stepIndex]!.inputBindings[inputName] = binding;
    draft.steps = [...draft.steps];
  }

  const statusBadgeClass = $derived.by(() => {
    if (draft.status === 'active')
      return 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10';
    if (draft.status === 'archived')
      return 'border-muted-foreground/30 text-muted-foreground bg-muted/40';
    return 'border-amber-500/40 text-amber-700 dark:text-amber-500 bg-amber-500/10';
  });

  // Canvas chips summarize each step's configured data sources.
  type StepSummary = {
    prompts: number;
    wires: Array<{ from: number; path: string }>;
    row: number;
    literals: number;
    generated: number;
    facts: number;
  };
  function summarize(step: Step): StepSummary {
    const s: StepSummary = {
      prompts: 0,
      wires: [],
      row: 0,
      literals: 0,
      generated: 0,
      facts: 0,
    };
    for (const binding of Object.values(step.inputBindings)) {
      if (binding.kind === 'runtime') s.prompts += 1;
      else if (binding.kind === 'priorOutput')
        s.wires.push({ from: binding.stepPosition, path: binding.path });
      else if (binding.kind === 'entity') {
        if (binding.source === 'row-context') s.row += 1;
        else s.prompts += 1;
      } else if (binding.kind === 'generated') s.generated += 1;
      else if (binding.kind === 'siteFact') s.facts += 1;
      else s.literals += 1; // covers 'literal' and 'template'
    }
    return s;
  }

  // Shows which downstream main-step inputs consume each output.
  function downstreamReaders(
    stepIndex: number
  ): Map<string, Array<{ toStep: number; toInput: string }>> {
    const map = new Map<string, Array<{ toStep: number; toInput: string }>>();
    for (let i = stepIndex + 1; i < draft.steps.length; i++) {
      const step = draft.steps[i]!;
      for (const [inputName, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind !== 'priorOutput') continue;
        if (binding.stepPosition !== stepIndex) continue;
        const arr = map.get(binding.path) ?? [];
        arr.push({ toStep: i, toInput: inputName });
        map.set(binding.path, arr);
      }
    }
    return map;
  }

  // A selected step is always inspected through the same panel. Main-step
  // outputs can be read by later main steps and success reactions; outcome
  // outputs can be read by later reactions in the same lane.
  function workflowReaders(
    lane: 'main' | 'onSuccess' | 'onFailure',
    stepIndex: number,
  ): Map<string, Array<{ lane: 'main' | 'onSuccess' | 'onFailure'; toStep: number; toInput: string }>> {
    const map = new Map<string, Array<{ lane: 'main' | 'onSuccess' | 'onFailure'; toStep: number; toInput: string }>>();
    const inspect = (steps: Step[], targetLane: 'main' | 'onSuccess' | 'onFailure', start: number) => {
      for (let i = start; i < steps.length; i++) {
        for (const [toInput, binding] of Object.entries(steps[i]!.inputBindings)) {
          if (binding.kind !== 'priorOutput') continue;
          const sourceLane = binding.lane ?? 'main';
          if (sourceLane !== lane || binding.stepPosition !== stepIndex) continue;
          const readers = map.get(binding.path) ?? [];
          readers.push({ lane: targetLane, toStep: i, toInput });
          map.set(binding.path, readers);
        }
      }
    };
    if (lane === 'main') {
      inspect(draft.steps, 'main', stepIndex + 1);
      inspect(draft.outcomeSteps.onSuccess, 'onSuccess', 0);
    } else {
      inspect(draft.outcomeSteps[lane], lane, stepIndex + 1);
    }
    return map;
  }

  function inputGroupFor(
    capability: { inputMeta: Record<string, { group?: string; order?: number }>; inputGroups?: Record<string, { label: string; description?: string; order?: number; advanced?: boolean }> },
    inputName: string,
  ) {
    const meta = capability.inputMeta[inputName];
    const id = meta?.group ?? 'general';
    return {
      id,
      label: capability.inputGroups?.[id]?.label ?? 'Configuration',
      description: capability.inputGroups?.[id]?.description,
      order: capability.inputGroups?.[id]?.order ?? 0,
      inputOrder: meta?.order ?? 0,
    };
  }

  function canSave(): boolean {
    if (!draft.name.trim()) return false;
    if (draft.steps.length === 0) return false;
    if (draft.prompts.some((prompt) => !prompt.id.trim() || !prompt.label.trim())) return false;
    const allSteps = [
      ...draft.steps,
      ...draft.outcomeSteps.onSuccess,
      ...draft.outcomeSteps.onFailure,
    ];
    for (const step of allSteps) {
      const cap = capIndex.get(step.capabilityId);
      if (!cap) return false;
      for (const [name, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind === 'runtime' && !binding.promptKey.trim()) return false;
        if (binding.kind === 'priorOutput' && !binding.path.trim()) return false;
        if (binding.kind === 'failureContext' && !binding.path.trim()) return false;
        if (binding.kind === 'literal') {
          const meta = cap.inputMeta[name];
          if (!meta) return false;
        }
        if (binding.kind === 'generated') {
          if (!binding.generator.trim()) return false;
        }
        if (binding.kind === 'siteFact' && !binding.key.trim()) return false;
        if (binding.kind === 'template' && !binding.template.trim()) return false;
      }
    }
    return true;
  }

  const selectedStep = $derived(selected.kind === 'step' ? (draft.steps[selected.index] ?? null) : null);
  const selectedReaction = $derived(selected.kind === 'reaction' ? (draft.outcomeSteps[selected.lane][selected.index] ?? null) : null);
  const selectedWorkflowStep = $derived(selectedStep ?? selectedReaction);
  const selectedCap = $derived(
    selectedStep ? capIndex.get(selectedStep.capabilityId) :
    selectedReaction ? capIndex.get(selectedReaction.capabilityId) : undefined
  );
  // Stable string key for per-input UI state (prompt key editor visibility, textarea refs).
  const selectedKey = $derived(
    selected.kind === 'step' ? `step-${selected.index}` :
    selected.kind === 'reaction' ? `reaction-${selected.lane}-${selected.index}` :
    'details'
  );
  const publishedPrompts = $derived(
    draft.prompts
      .filter((prompt) => activePromptIds().has(prompt.id))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  );
  const normalPromptIds = $derived(
    new Set([
      ...promptIdsForSteps(draft.steps),
      ...promptIdsForSteps(draft.outcomeSteps.onSuccess),
    ]),
  );
  const failurePromptIds = $derived(promptIdsForSteps(draft.outcomeSteps.onFailure));
  const normalPublishedPrompts = $derived(
    publishedPrompts.filter((prompt) => normalPromptIds.has(prompt.id) && !failurePromptIds.has(prompt.id)),
  );
  const failurePublishedPrompts = $derived(
    publishedPrompts.filter((prompt) => failurePromptIds.has(prompt.id)),
  );

  function updatePrompt(id: string, patch: Partial<PackagePrompt>) {
    draft.prompts = draft.prompts.map((prompt) => prompt.id === id ? { ...prompt, ...patch } : prompt);
  }

  function setPromptRequired(id: string, required: boolean) {
    updatePrompt(id, { required });
    const applyRequired = (steps: Step[]) => steps.map((step) => ({
      ...step,
      inputBindings: Object.fromEntries(
        Object.entries(step.inputBindings).map(([name, binding]) => [
          name,
          binding.kind === 'runtime' && binding.promptKey === id ? { ...binding, required } : binding,
        ])
      ),
    }));
    draft.steps = applyRequired(draft.steps);
    draft.outcomeSteps = {
      onSuccess: applyRequired(draft.outcomeSteps.onSuccess),
      onFailure: applyRequired(draft.outcomeSteps.onFailure),
    };
  }

  // Tracks per-input visibility for advanced prompt-key editing.
  let showPromptKeyEditor = $state<Record<string, boolean>>({});
</script>

<div class="flex size-full flex-col overflow-hidden">
  <!-- Header bar -->
  <header class="border-b bg-background">
    <div class="flex flex-wrap items-center gap-3 px-6 py-3">
      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => goto('/automation/packages')}
      >
        <ArrowLeft class="size-3.5" />
        All packages
      </button>

      <div class="mx-2 h-5 w-px bg-border"></div>

      <Input
        placeholder="Untitled package"
        value={draft.name}
        oninput={(e) => (draft.name = (e.target as HTMLInputElement).value)}
        class="h-9 w-full max-w-md text-base font-semibold"
      />

      <div
        class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium capitalize {statusBadgeClass}"
      >
        <Circle class="size-2 fill-current" />
        {draft.status}
      </div>

      <div class="ml-auto flex items-center gap-2">
        <Select.Root type="single" bind:value={draft.status}>
          <Select.Trigger class="h-9 w-32 capitalize">{draft.status}</Select.Trigger>
          <Select.Content>
            <Select.Item value="draft">Draft</Select.Item>
            <Select.Item value="active">Active</Select.Item>
            <Select.Item value="archived">Archived</Select.Item>
          </Select.Content>
        </Select.Root>
        <Button
          onclick={() => onSave({ ...draft, prompts: publishedPrompts })}
          disabled={!canSave() || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
    {#if !canSave() && draft.name.trim() && draft.steps.length > 0}
      <div
        class="flex items-center gap-2 border-t bg-amber-500/5 px-6 py-1.5 text-xs text-amber-700 dark:text-amber-500"
      >
        <AlertTriangle class="size-3.5" />
        Some inputs still need to be filled in.
      </div>
    {/if}
  </header>

  <!-- Two-pane body -->
  <div class="grid min-h-0 flex-1 grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr]">
    <!-- Canvas: node list -->
    <aside class="flex min-h-0 flex-col border-r bg-muted/20">
      <div class="border-b px-4 py-3">
        <div class="flex items-baseline justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Steps
          </h2>
          <span class="font-mono text-[11px] tabular-nums text-muted-foreground">
            {String(draft.steps.length).padStart(2, '0')}
          </span>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <button
          type="button"
          onclick={() => (selected = { kind: 'details' })}
          class="flex w-full items-center gap-2 border-b px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 {selected.kind === 'details' ? 'bg-muted/60' : ''}"
        >
          <Info class="size-3.5 text-muted-foreground" />
          <span class="text-muted-foreground">Package details</span>
        </button>

        {#if draft.steps.length === 0}
          <div class="p-4 text-center text-sm text-muted-foreground">
            No steps yet. Add one below to begin.
          </div>
        {:else}
          <ol class="p-3">
            {#each draft.steps as step, i (i)}
              {@const cap = capIndex.get(step.capabilityId)}
              {@const summary = summarize(step)}
              {@const isSelected = selected.kind === 'step' && selected.index === i}
              {@const isLast = i === draft.steps.length - 1}
              <li class="relative">
                {#if !isLast}
                  <span
                    aria-hidden="true"
                    class="absolute left-[22px] top-11 h-[calc(100%-8px)] w-px bg-border"
                  ></span>
                {/if}
                <button
                  type="button"
                  onclick={() => (selected = { kind: 'step', index: i })}
                  class="group relative mb-1.5 flex w-full items-start gap-3 rounded-md border p-3 text-left transition-all {isSelected
                    ? 'border-primary/50 bg-background shadow-sm ring-1 ring-primary/20'
                    : 'border-transparent hover:border-border hover:bg-background/70'}"
                >
                  <span
                    class="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-background font-mono text-[11px] font-semibold tabular-nums {isSelected
                      ? 'border-primary text-primary'
                      : 'border-muted-foreground/30 text-muted-foreground'}"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="truncate text-sm font-medium">
                      {step.label ?? cap?.name ?? step.capabilityId}
                    </div>
                    <div class="truncate font-mono text-[10px] text-muted-foreground/70">
                      {cap?.category ?? '—'}
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                      {#if summary.wires.length > 0}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-cyan-500/10 px-1.5 py-0.5 font-mono text-cyan-700 dark:text-cyan-400"
                          title="Wired from earlier steps"
                        >
                          <Link2 class="size-2.5" />
                          {summary.wires.length}
                        </span>
                      {/if}
                      {#if summary.prompts > 0}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-700 dark:text-amber-500"
                          title="Prompts at run time"
                        >
                          <Keyboard class="size-2.5" />
                          {summary.prompts}
                        </span>
                      {/if}
                      {#if summary.row > 0}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-violet-500/10 px-1.5 py-0.5 font-mono text-violet-700 dark:text-violet-400"
                          title="From triggering row"
                        >
                          <Pin class="size-2.5" />
                          {summary.row}
                        </span>
                      {/if}
                      {#if summary.generated > 0}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-700 dark:text-emerald-400"
                          title="Generated at run time"
                        >
                          <Sparkles class="size-2.5" />
                          {summary.generated}
                        </span>
                      {/if}
                      {#if summary.facts > 0}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-fuchsia-500/10 px-1.5 py-0.5 font-mono text-fuchsia-700 dark:text-fuchsia-400"
                          title="From site facts"
                        >
                          <Database class="size-2.5" />
                          {summary.facts}
                        </span>
                      {/if}
                      {#if summary.literals > 0}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-stone-500/10 px-1.5 py-0.5 font-mono text-stone-600 dark:text-stone-400"
                          title="Fixed values"
                        >
                          {summary.literals}
                        </span>
                      {/if}
                      {#if step.optional}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-sky-500/10 px-1.5 py-0.5 font-mono text-sky-700 dark:text-sky-400"
                          title="Can be skipped at run time"
                        >
                          opt
                        </span>
                      {/if}
                    </div>
                  </div>
                </button>
              </li>
            {/each}
          </ol>
        {/if}

        <!-- Add step control -->
        <div class="border-t bg-background/60 p-3">
          <Button
            variant="outline"
            class="h-auto w-full items-center justify-between gap-3 overflow-hidden px-3 py-3 text-left"
            onclick={() => openCapabilityPicker()}
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">
                Add capability
              </span>
              <span class="block text-[11px] text-muted-foreground">Browse catalog</span>
            </span>
            <span
              class="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[10px] font-mono text-muted-foreground"
            >
              <SlidersHorizontal class="size-3" />
              {capabilitiesQuery.data?.length ?? 0}
            </span>
          </Button>
        </div>

        <!-- On Failure lane -->
        <div class="border-t">
          <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center gap-1.5">
              <TriangleAlert class="size-3 text-rose-500" />
              <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-600 dark:text-rose-500">On Failure</span>
            </div>
            <button
              type="button"
              class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              onclick={() => openCapabilityPicker('onFailure')}
              title="Add failure reaction"
            >
              <Plus class="size-3" /> Add
            </button>
          </div>
          {#if draft.outcomeSteps.onFailure.length === 0}
            <p class="px-4 pb-3 text-[11px] text-muted-foreground">Runs after a halted or partial package. Add a reaction above.</p>
          {:else}
            <ol class="space-y-1 px-3 pb-3">
              {#each draft.outcomeSteps.onFailure as reaction, i (i)}
                {@const reactionCap = capIndex.get(reaction.capabilityId)}
                {@const reactionSummary = summarize(reaction)}
                {@const isSelected = selected.kind === 'reaction' && selected.lane === 'onFailure' && selected.index === i}
                <li>
                  <div
                    role="button"
                    tabindex="0"
                    onclick={() => (selected = { kind: 'reaction', lane: 'onFailure', index: i })}
                    onkeydown={(e) => e.key === 'Enter' && (selected = { kind: 'reaction', lane: 'onFailure', index: i })}
                    class="group relative flex w-full cursor-pointer items-start gap-3 rounded-md border p-2.5 text-left transition-all {isSelected
                      ? 'border-rose-500/50 bg-rose-500/5 shadow-sm ring-1 ring-rose-500/20'
                      : 'border-transparent hover:border-border hover:bg-background/70'}"
                  >
                    <span class="flex size-7 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[10px] font-semibold {isSelected ? 'border-rose-500 text-rose-600 dark:text-rose-400' : 'border-muted-foreground/30 text-muted-foreground'}">
                      F{i + 1}
                    </span>
                    <div class="min-w-0 flex-1 space-y-1">
                      <div class="truncate text-xs font-medium">{reaction.label ?? reactionCap?.name ?? reaction.capabilityId}</div>
                      <div class="flex flex-wrap items-center gap-1 text-[10px]">
                        {#if reactionSummary.wires.length > 0}
                          <span class="inline-flex items-center gap-0.5 rounded-sm bg-cyan-500/10 px-1 py-0.5 font-mono text-cyan-700 dark:text-cyan-400"><Link2 class="size-2" />{reactionSummary.wires.length}</span>
                        {/if}
                        {#if reactionSummary.prompts > 0}
                          <span class="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/10 px-1 py-0.5 font-mono text-amber-700 dark:text-amber-500"><Keyboard class="size-2" />{reactionSummary.prompts}</span>
                        {/if}
                        {#if reactionSummary.facts > 0}
                          <span class="inline-flex items-center gap-0.5 rounded-sm bg-fuchsia-500/10 px-1 py-0.5 font-mono text-fuchsia-700 dark:text-fuchsia-400"><Database class="size-2" />{reactionSummary.facts}</span>
                        {/if}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                      onclick={(e) => { e.stopPropagation(); removeOutcomeStep('onFailure', i); }}
                      aria-label="Remove reaction"
                    >
                      <Trash2 class="size-3" />
                    </button>
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
        </div>

        <!-- On Success lane (secondary) -->
        <div class="border-t">
          <div class="flex items-center justify-between px-4 py-2">
            <div class="flex items-center gap-1.5">
              <CheckCircle2 class="size-3 text-muted-foreground" />
              <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">On Success</span>
            </div>
            <button
              type="button"
              class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              onclick={() => openCapabilityPicker('onSuccess')}
              title="Add success reaction"
            >
              <Plus class="size-3" /> Add
            </button>
          </div>
          {#if draft.outcomeSteps.onSuccess.length > 0}
            <ol class="space-y-1 px-3 pb-3">
              {#each draft.outcomeSteps.onSuccess as reaction, i (i)}
                {@const reactionCap = capIndex.get(reaction.capabilityId)}
                {@const reactionSummary = summarize(reaction)}
                {@const isSelected = selected.kind === 'reaction' && selected.lane === 'onSuccess' && selected.index === i}
                <li>
                  <div
                    role="button"
                    tabindex="0"
                    onclick={() => (selected = { kind: 'reaction', lane: 'onSuccess', index: i })}
                    onkeydown={(e) => e.key === 'Enter' && (selected = { kind: 'reaction', lane: 'onSuccess', index: i })}
                    class="group relative flex w-full cursor-pointer items-start gap-3 rounded-md border p-2.5 text-left transition-all {isSelected
                      ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm ring-1 ring-emerald-500/20'
                      : 'border-transparent hover:border-border hover:bg-background/70'}"
                  >
                    <span class="flex size-7 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[10px] font-semibold {isSelected ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-muted-foreground/30 text-muted-foreground'}">
                      S{i + 1}
                    </span>
                    <div class="min-w-0 flex-1 space-y-1">
                      <div class="truncate text-xs font-medium">{reaction.label ?? reactionCap?.name ?? reaction.capabilityId}</div>
                      <div class="flex flex-wrap items-center gap-1 text-[10px]">
                        {#if reactionSummary.wires.length > 0}
                          <span class="inline-flex items-center gap-0.5 rounded-sm bg-cyan-500/10 px-1 py-0.5 font-mono text-cyan-700 dark:text-cyan-400"><Link2 class="size-2" />{reactionSummary.wires.length}</span>
                        {/if}
                        {#if reactionSummary.prompts > 0}
                          <span class="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/10 px-1 py-0.5 font-mono text-amber-700 dark:text-amber-500"><Keyboard class="size-2" />{reactionSummary.prompts}</span>
                        {/if}
                        {#if reactionSummary.facts > 0}
                          <span class="inline-flex items-center gap-0.5 rounded-sm bg-fuchsia-500/10 px-1 py-0.5 font-mono text-fuchsia-700 dark:text-fuchsia-400"><Database class="size-2" />{reactionSummary.facts}</span>
                        {/if}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                      onclick={(e) => { e.stopPropagation(); removeOutcomeStep('onSuccess', i); }}
                      aria-label="Remove reaction"
                    >
                      <Trash2 class="size-3" />
                    </button>
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </div>

      <!-- Legend anchor -->
      <div class="border-t bg-background/40 px-4 py-2.5 text-[10px] text-muted-foreground">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
          <span class="inline-flex items-center gap-1">
            <Keyboard class="size-2.5 text-amber-600 dark:text-amber-400" /> prompt
          </span>
          <span class="inline-flex items-center gap-1">
            <Link2 class="size-2.5 text-cyan-600 dark:text-cyan-400" /> wired
          </span>
          <span class="inline-flex items-center gap-1">
            <Braces class="size-2.5 text-blue-600 dark:text-blue-400" /> template
          </span>
          <span class="inline-flex items-center gap-1">
            <Pin class="size-2.5 text-violet-600 dark:text-violet-400" /> row
          </span>
          <span class="inline-flex items-center gap-1">
            <Sparkles class="size-2.5 text-emerald-600 dark:text-emerald-400" /> generated
          </span>
          <span class="inline-flex items-center gap-1">
            <Database class="size-2.5 text-fuchsia-600 dark:text-fuchsia-400" /> fact
          </span>
          <span class="inline-flex items-center gap-1">
            <span class="size-2 rounded-sm bg-stone-500/60"></span> fixed
          </span>
        </div>
      </div>
    </aside>

    <!-- Inspector -->
    <section class="flex min-h-0 flex-col overflow-y-auto">
      {#if selected.kind === 'details'}
        <PackageDetails
          bind:draft
          {siteOptions}
          {siteGroupOptions}
          {tenantLinkOptions}
          {normalPublishedPrompts}
          {failurePublishedPrompts}
          onUpdatePrompt={updatePrompt}
          onSetPromptRequired={setPromptRequired}
        />
      {:else if selectedWorkflowStep && selectedCap}
        {@const cap = selectedCap}
        {@const step = selectedWorkflowStep}
        {@const stepIndex = selected.index}
        {@const lane = selected.kind === 'reaction' ? selected.lane : 'main'}
        {@const boundInputNames = Object.keys(step.inputBindings).sort((a, b) => {
          const aGroup = inputGroupFor(cap, a);
          const bGroup = inputGroupFor(cap, b);
          return aGroup.order - bGroup.order || aGroup.inputOrder - bGroup.inputOrder || a.localeCompare(b);
        })}
        {@const availableOptional = Object.entries(cap.inputMeta)
          .filter(([name, meta]) => !isRequiredInput(meta) && !(name in step.inputBindings))
          .map(([name, meta]) => ({
            value: name,
            label: fieldLabel(name, (meta as { label?: string }).label),
          }))}
        {@const readers = workflowReaders(lane, stepIndex)}
        <!-- Step header -->
        <div class="border-b bg-muted/20 px-6 py-4">
          <div class="flex items-start gap-4">
            <div
              class="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background font-mono text-sm font-semibold tabular-nums text-muted-foreground"
            >
              {lane === 'main' ? String(stepIndex + 1).padStart(2, '0') : `${lane === 'onFailure' ? 'F' : 'S'}${String(stepIndex + 1).padStart(2, '0')}`}
            </div>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="truncate text-lg font-semibold">{cap.name}</h2>
                <span
                  class="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  {lane === 'main' ? cap.category : lane === 'onFailure' ? 'On Failure' : 'On Success'}
                </span>
              </div>
              {#if cap.description}
                <p class="text-sm text-muted-foreground">{cap.description}</p>
              {/if}
              {#if lane === 'main'}
                <div class="pt-1 font-mono text-[10px] text-muted-foreground/70">
                  {cap.id}
                </div>
              {/if}
              <input
                class="min-w-0 w-full bg-transparent pt-1 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:text-foreground"
                aria-label="Step name"
                placeholder={cap.name}
                value={step.label ?? cap.name}
                oninput={(event) =>
                  setWorkflowStepLabel(lane, stepIndex, (event.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="flex shrink-0 items-center gap-1">
              {#if lane === 'main'}
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0"
                onclick={() => moveStep(stepIndex, -1)}
                disabled={stepIndex === 0}
                aria-label="Move step up"
              >
                <ArrowUp class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0"
                onclick={() => moveStep(stepIndex, 1)}
                disabled={stepIndex === draft.steps.length - 1}
                aria-label="Move step down"
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
              {:else}
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0"
                onclick={() => moveReactionStep(lane, stepIndex, -1)}
                disabled={stepIndex === 0}
                aria-label="Move step up"
              >
                <ArrowUp class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0"
                onclick={() => moveReactionStep(lane, stepIndex, 1)}
                disabled={stepIndex === draft.outcomeSteps[lane].length - 1}
                aria-label="Move step down"
              >
                <ArrowDown class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0 text-muted-foreground hover:text-rose-500"
                onclick={() => removeOutcomeStep(lane, stepIndex)}
                aria-label="Remove step"
              >
                <Trash2 class="size-4" />
              </Button>
              {/if}
            </div>
          </div>
        </div>

        <!-- Inputs -->
        <div class="mx-auto w-full max-w-3xl space-y-6 p-6">
          <div class="flex items-baseline justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Inputs
            </h3>
            <span class="text-xs text-muted-foreground">
              {boundInputNames.length} configured
            </span>
          </div>

          {#if boundInputNames.length === 0}
            <p class="text-sm text-muted-foreground">
              This capability takes no inputs. It's ready to run as-is.
            </p>
          {/if}

          <div class="space-y-3">
            {#each boundInputNames as inputName, inputIndex (inputName)}
              {@const meta = cap.inputMeta[inputName]}
              {#if meta}
                {@const group = inputGroupFor(cap, inputName)}
                {@const previousGroup = inputIndex > 0 ? inputGroupFor(cap, boundInputNames[inputIndex - 1]!) : null}
                {#if !previousGroup || previousGroup.id !== group.id}
                  <div class="pt-3 first:pt-0">
                    <h4 class="text-sm font-semibold">{group.label}</h4>
                    {#if group.description}
                      <p class="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
                    {/if}
                  </div>
                {/if}
                {@const binding = step.inputBindings[inputName]}
                {@const label = fieldLabel(inputName, meta.label)}
                {@const optional = !isRequiredInput(meta)}
                {@const currentSource = sourceOf(binding)}
                {@const allowed = allowedSourcesFor(meta, lane === 'onFailure')}
                <div
                  class="rounded-lg border border-l-[3px] bg-card {sourceBorderClass(
                    currentSource
                  )}"
                >
                  <div class="flex items-start justify-between gap-3 border-b px-4 py-3">
                    <div class="min-w-0 space-y-0.5">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-medium">{label}</span>
                        <span
                          class="rounded-sm border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          title="Field type"
                        >
                          {inputTypeLabel(meta)}
                        </span>
                        {#if !optional}
                          <span
                            class="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-500"
                          >
                            Required
                          </span>
                        {:else}
                          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Optional
                          </span>
                        {/if}
                        {#if meta.sensitive}
                          <span
                            class="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-500"
                          >
                            Sensitive
                          </span>
                        {/if}
                      </div>
                      {#if meta.description}
                        <p class="text-xs text-muted-foreground">{meta.description}</p>
                      {/if}
                    </div>
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

                  <!-- Source picker -->
                  <div
                    class="flex flex-wrap gap-1 border-b bg-muted/30 p-1.5"
                  >
                    {#each allowed as src (src)}
                      {@const isActive = currentSource === src}
                      <button
                        type="button"
                        onclick={() => changeSource(stepIndex, inputName, src)}
                        class="group relative flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-all {isActive
                          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                          : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
                        title={sourceHint(src, meta)}
                      >
                        {#if src === 'fixed'}
                          <Circle class="size-3 {isActive ? sourceIconColor('fixed') : ''}" />
                        {:else if src === 'runtime'}
                          <Keyboard class="size-3 {isActive ? sourceIconColor('runtime') : ''}" />
                        {:else if src === 'generated'}
                          <Sparkles class="size-3 {isActive ? sourceIconColor('generated') : ''}" />
                        {:else if src === 'fact'}
                          <Database class="size-3 {isActive ? sourceIconColor('fact') : ''}" />
                        {:else if src === 'row'}
                          <Pin class="size-3 {isActive ? sourceIconColor('row') : ''}" />
                        {:else}
                          <Link2 class="size-3 {isActive ? sourceIconColor('wire') : ''}" />
                        {/if}
                        {sourceLabel(src)}
                      </button>
                    {/each}
                  </div>

                  <!-- Editor for current source -->
                  <div class="space-y-2 p-4">
                    <p class="text-xs text-muted-foreground">
                      {sourceHint(currentSource, meta)}
                    </p>

                    {#if binding?.kind === 'template'}
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] text-muted-foreground font-mono">Use <code>{'{{variable}}'}</code> to insert values.</span>
                        <BindingVariableInserter
                          lane={lane}
                          mainSteps={lane === 'main' ? draft.steps.slice(0, stepIndex) : draft.steps}
                          laneSteps={lane === 'main' ? [] : draft.outcomeSteps[lane].slice(0, stepIndex)}
                          prompts={draft.prompts}
                          siteFactFields={siteFactFieldsQuery.data ?? []}
                          {capIndex}
                          target={activeTemplateRef}
                          value={binding.template}
                          oninsert={(v) => setBinding(stepIndex, inputName, { kind: 'template', template: v })}
                        />
                      </div>
                      <Textarea
                        placeholder="e.g. step 1 hostname, failure message…"
                        value={binding.template}
                        rows={4}
                        onfocus={(e) => (activeTemplateRef = e.currentTarget as HTMLTextAreaElement)}
                        oninput={(e) => setBinding(stepIndex, inputName, { kind: 'template', template: (e.target as HTMLTextAreaElement).value })}
                      />
                    {:else if binding?.kind === 'literal'}
                      {#if meta.entityType}
                        <EntityPicker
                          entityType={meta.entityType as EntityType}
                          multiple={meta.typeHint === 'stringArray'}
                          value={binding.value as string | string[] | null}
                          onValueChange={(v) => setBinding(stepIndex, inputName, { kind: 'literal', value: v })}
                        />
                      {:else if meta.typeHint === 'boolean'}
                        <label class="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={Boolean(binding.value)}
                            onCheckedChange={(c) => setBinding(stepIndex, inputName, { kind: 'literal', value: Boolean(c) })}
                          />
                          <span class="text-muted-foreground">{binding.value ? 'true' : 'false'}</span>
                        </label>
                      {:else if meta.typeHint === 'stringArray' && meta.choices && meta.choices.length > 0}
                        <MultiSelect
                          options={meta.choices as { value: string; label: string }[]}
                          selected={Array.isArray(binding.value) ? binding.value as string[] : []}
                          placeholder="Choose one or more…"
                          onchange={(v) => setBinding(stepIndex, inputName, { kind: 'literal', value: v })}
                        />
                      {:else if meta.typeHint === 'stringArray'}
                        <Input
                          placeholder="value1, value2"
                          value={Array.isArray(binding.value) ? (binding.value as string[]).join(', ') : ''}
                          oninput={(e) => {
                            const arr = (e.target as HTMLInputElement).value.split(',').map((v) => v.trim()).filter(Boolean);
                            setBinding(stepIndex, inputName, { kind: 'literal', value: arr });
                          }}
                        />
                      {:else if meta.choices && meta.choices.length > 0}
                        <SingleSelect
                          options={meta.choices as { value: string; label: string }[]}
                          selected={typeof binding.value === 'string' ? binding.value : ''}
                          placeholder="Choose…"
                          onchange={(v) => setBinding(stepIndex, inputName, { kind: 'literal', value: v })}
                        />
                      {:else}
                        <Input
                          type={meta.sensitive ? 'password' : 'text'}
                          value={typeof binding.value === 'string' ? binding.value : ''}
                          oninput={(e) => setBinding(stepIndex, inputName, { kind: 'literal', value: (e.target as HTMLInputElement).value })}
                        />
                      {/if}
                    {:else if binding?.kind === 'runtime'}
                      <div class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {#if meta.entityType}
                          A picker for <span class="font-mono">{meta.entityType.replace('_', ' ')}</span> will appear when this runs.
                        {:else if meta.typeHint === 'password'}
                          A password field will appear. Operators can generate a strong random password or set a specific one.
                        {:else}
                          A text input will appear when this runs.
                        {/if}
                      </div>
                      <button
                        type="button"
                        class="text-xs text-muted-foreground hover:text-foreground"
                        onclick={() => (showPromptKeyEditor[`${selectedKey}:${inputName}`] = !showPromptKeyEditor[`${selectedKey}:${inputName}`])}
                      >
                        {showPromptKeyEditor[`${selectedKey}:${inputName}`] ? 'Hide' : 'Show'} prompt key
                        <span class="ml-1 font-mono opacity-60">({binding.promptKey})</span>
                      </button>
                      {#if showPromptKeyEditor[`${selectedKey}:${inputName}`]}
                        <div class="grid gap-2 pt-1 sm:grid-cols-[1fr_auto]">
                          <Input
                            placeholder="Prompt key"
                            value={binding.promptKey}
                            oninput={(e) => setBinding(stepIndex, inputName, { ...binding, promptKey: (e.target as HTMLInputElement).value })}
                          />
                          <label class="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                            <Checkbox
                              checked={binding.required}
                              onCheckedChange={(c) => setBinding(stepIndex, inputName, { ...binding, required: Boolean(c) })}
                            />
                            Required at run time
                          </label>
                        </div>
                        <p class="text-[11px] text-muted-foreground">Steps that share a prompt key answer the same question once.</p>
                      {/if}
                    {:else if binding?.kind === 'entity' && binding.source === 'picker'}
                      <div class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">A picker will appear when this runs.</div>
                    {:else if binding?.kind === 'entity' && binding.source === 'row-context'}
                      <div class="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
                        <span class="text-xs text-muted-foreground">Context key</span>
                        <Input
                          placeholder="e.g. identityId"
                          value={binding.contextKey ?? ''}
                          oninput={(e) => setBinding(stepIndex, inputName, { ...binding, contextKey: (e.target as HTMLInputElement).value })}
                        />
                      </div>
                      <p class="text-[11px] text-muted-foreground">Leave empty to use the input name — usually what you want.</p>
                    {:else if binding?.kind === 'generated'}
                      {@const gen = (generatorsQuery.data ?? []).find((g) => g.id === binding.generator)}
                      {#if !gen}
                        <div class="rounded-md border border-dashed border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-500">
                          Generator "{binding.generator}" not found. Pick another source.
                        </div>
                      {:else if binding.generator === 'password'}
                        {@const pwParams = binding.params as { length?: number; symbols?: boolean; excludeAmbiguous?: boolean }}
                        <div class="space-y-3">
                          <div class="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                            <span class="text-xs text-muted-foreground">Length</span>
                            <Input
                              type="number" min={8} max={128} value={pwParams.length ?? 20}
                              oninput={(e) => { const n = Number((e.target as HTMLInputElement).value); setBinding(stepIndex, inputName, { ...binding, params: { ...binding.params, length: Number.isFinite(n) ? n : 20 } }); }}
                              class="max-w-32"
                            />
                            <span class="font-mono text-[11px] text-muted-foreground"> chars </span>
                          </div>
                          <label class="flex items-center gap-2 text-xs">
                            <Checkbox checked={pwParams.symbols ?? true} onCheckedChange={(c) => setBinding(stepIndex, inputName, { ...binding, params: { ...binding.params, symbols: Boolean(c) } })} />
                            <span class="text-muted-foreground">Include symbols <span class="ml-1 font-mono opacity-60">(!@#$%…)</span></span>
                          </label>
                          <label class="flex items-center gap-2 text-xs">
                            <Checkbox checked={pwParams.excludeAmbiguous ?? false} onCheckedChange={(c) => setBinding(stepIndex, inputName, { ...binding, params: { ...binding.params, excludeAmbiguous: Boolean(c) } })} />
                            <span class="text-muted-foreground">Exclude ambiguous characters <span class="ml-1 font-mono opacity-60">(0/O, 1/l/I…)</span></span>
                          </label>
                          <p class="text-[11px] text-muted-foreground">A fresh password is generated for every run. Wire the step's <span class="font-mono">temporaryPassword</span> output to capture it.</p>
                        </div>
                      {:else}
                        <div class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{gen.description}</div>
                      {/if}
                    {:else if binding?.kind === 'siteFact'}
                      {@const factOpts = factFieldsFor(meta.typeHint).map((f) => ({ value: f.key, label: f.label, subLabel: `${f.fieldTypeLabel ?? f.type} · ${f.section}` }))}
                      <div class="space-y-3">
                        {#if factOpts.length === 0}
                          <div class="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                            No declared site profile fields match this input's type. Add one under Sites → Profile fields, then come back.
                          </div>
                        {:else}
                          <SingleSelect options={factOpts} selected={binding.key} placeholder="Pick a site fact…" onchange={(v) => setBinding(stepIndex, inputName, { ...binding, key: v })} />
                        {/if}
                        <label class="flex items-center gap-2 text-xs">
                          <Checkbox checked={binding.required} onCheckedChange={(c) => setBinding(stepIndex, inputName, { ...binding, required: Boolean(c) })} />
                          <span class="text-muted-foreground">Required <span class="ml-1 opacity-60">(fail the step if the site has no value)</span></span>
                        </label>
                      </div>
                    {:else if binding?.kind === 'priorOutput'}
                      {#if lane === 'main'}
                      {@const upstreamSteps = draft.steps.slice(0, stepIndex)}
                      {@const upstreamCap = capIndex.get(upstreamSteps[binding.stepPosition]?.capabilityId ?? '')}
                      {@const stepOpts = upstreamSteps.map((s, i) => ({ value: String(i), label: `Step ${String(i + 1).padStart(2, '0')}: ${s.label ?? capIndex.get(s.capabilityId)?.name ?? s.capabilityId}` }))}
                      {@const compatTypes = (meta as { priorOutputCompat?: string[] }).priorOutputCompat}
                      {@const outputOpts = upstreamCap ? Object.entries(upstreamCap.outputMeta).filter(([, m]) => { if (!compatTypes || compatTypes.length === 0) return true; const t = (m as { outputType?: string }).outputType; return t ? compatTypes.includes(t) : false; }).map(([k, m]) => ({ value: k, label: fieldLabel(k, (m as { label?: string }).label) })) : []}
                      {#if upstreamSteps.length === 0}
                        <div class="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                          No earlier steps to wire from. Add one before this step or pick a different source.
                        </div>
                      {:else}
                        <div class="grid gap-2 sm:grid-cols-2">
                          <SingleSelect options={stepOpts} selected={String(binding.stepPosition)} placeholder="Prior step…" disableSort onchange={(v: string) => setBinding(stepIndex, inputName, { ...binding, stepPosition: Number(v), path: '' })} />
                          <SingleSelect options={outputOpts} selected={binding.path} placeholder="Output field…" onchange={(v: string) => setBinding(stepIndex, inputName, { ...binding, path: v })} />
                        </div>
                        {#if upstreamCap && outputOpts.length === 0}
                          <div class="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                            The selected step has no compatible outputs for this input. Try a different step.
                          </div>
                        {/if}
                      {/if}
                      {:else}
                        {@const wireSteps = reactionWireSteps()}
                        {@const sourceLane = binding.lane ?? 'main'}
                        {@const selectedWireStep = `${sourceLane}:${binding.stepPosition}`}
                        {@const outputOptions = reactionWireOutputs(binding, meta)}
                        {#if wireSteps.length === 0}
                          <div class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            Add a main step or an earlier reaction before wiring this input.
                          </div>
                        {:else}
                          <div class="grid gap-2 sm:grid-cols-2">
                            <SingleSelect
                              options={wireSteps.map(({ value, label }) => ({ value, label }))}
                              selected={selectedWireStep}
                              placeholder="Source step…"
                              disableSort
                              onchange={(v) => {
                                const source = wireSteps.find((candidate) => candidate.value === v);
                                if (!source) return;
                                setBinding(stepIndex, inputName, {
                                  ...binding,
                                  lane: source.lane,
                                  stepPosition: source.position,
                                  path: '',
                                });
                              }}
                            />
                            <SingleSelect
                              options={outputOptions}
                              selected={binding.path}
                              placeholder="Output field…"
                              onchange={(path) => setBinding(stepIndex, inputName, { ...binding, path })}
                            />
                          </div>
                          {#if outputOptions.length === 0}
                            <p class="text-xs text-amber-700 dark:text-amber-400">
                              The selected step has no compatible outputs for this input.
                            </p>
                          {/if}
                        {/if}
                      {/if}
                    {/if}
                  </div>
                </div>
              {/if}
            {/each}
          </div>

          {#if availableOptional.length > 0}
            <div class="rounded-md border border-dashed p-3">
              <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                  <SingleSelect
                    options={availableOptional}
                    selected=""
                    placeholder="Add an optional field…"
                    onchange={(v: string) => v && addOptionalInput(stepIndex, v)}
                  />
                </div>
                <span class="whitespace-nowrap text-xs text-muted-foreground">
                  {availableOptional.length} more
                </span>
              </div>
            </div>
          {/if}

          <!-- Reactions are terminal workflow actions; only main steps may be optional. -->
          {#if lane === 'main' && readers.size > 0}
            <div class="rounded-lg border p-4 space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="space-y-0.5">
                  <div class="text-sm font-medium">Optional step</div>
                  <p class="text-xs text-muted-foreground">
                    When optional, the operator can choose to skip this step at run time.
                  </p>
                </div>
                <label class="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={!!step.optional}
                    disabled={true}
                    onCheckedChange={(c) => setStepOptional(stepIndex, Boolean(c))}
                  />
                  <span class="text-sm text-muted-foreground select-none">
                    {step.optional ? 'Optional' : 'Required'}
                  </span>
                </label>
              </div>
              <div class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
                <AlertTriangle class="size-3.5 shrink-0 mt-0.5" />
                <span>
                  This step's outputs are wired to later steps — it cannot be marked optional until those wires are removed.
                </span>
              </div>
            </div>
          {:else if lane === 'main'}
            <div class="rounded-lg border p-4">
              <div class="flex items-center justify-between gap-3">
                <div class="space-y-0.5">
                  <div class="text-sm font-medium">Optional step</div>
                  <p class="text-xs text-muted-foreground">
                    When optional, the operator can choose to skip this step at run time.
                  </p>
                </div>
                <label class="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={!!step.optional}
                    onCheckedChange={(c) => setStepOptional(stepIndex, Boolean(c))}
                  />
                  <span class="text-sm text-muted-foreground select-none">
                    {step.optional ? 'Optional' : 'Required'}
                  </span>
                </label>
              </div>
            </div>
          {/if}

          <!-- Outputs -->
          {#if Object.keys(cap.outputMeta).length > 0}
            <div class="space-y-3 pt-2">
              <h3 class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Outputs
              </h3>
              <div class="overflow-hidden rounded-lg border">
                <table class="w-full text-sm">
                  <tbody class="divide-y">
                    {#each Object.entries(cap.outputMeta) as [key, m] (key)}
                      {@const outputLabel = fieldLabel(key, (m as { label?: string }).label)}
                      {@const usedBy = readers.get(key) ?? []}
                      <tr>
                        <td class="w-1/3 px-3 py-2 align-top">
                          <div class="font-medium">{outputLabel}</div>
                          <div class="font-mono text-[11px] text-muted-foreground/80">{key}</div>
                        </td>
                        <td class="px-3 py-2 text-xs text-muted-foreground">
                          {#if usedBy.length === 0}
                            <span class="italic">Not wired downstream</span>
                          {:else}
                            <div class="flex flex-col gap-0.5">
                              {#each usedBy as u (u.toStep + ':' + u.toInput)}
                                <button
                                  type="button"
                                  onclick={() => {
                                    selected = u.lane === 'main'
                                      ? { kind: 'step', index: u.toStep }
                                      : { kind: 'reaction', lane: u.lane, index: u.toStep };
                                  }}
                                  class="inline-flex items-center gap-1.5 self-start rounded-sm bg-cyan-500/10 px-2 py-0.5 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-400"
                                >
                                  <CornerDownRight class="size-3" />
                                  {u.lane === 'main' ? 'Step' : u.lane === 'onFailure' ? 'On failure' : 'On success'} {String(u.toStep + 1).padStart(2, '0')} · {fieldLabel(
                                    u.toInput,
                                    capIndex.get(
                                      (u.lane === 'main'
                                        ? draft.steps[u.toStep]
                                        : draft.outcomeSteps[u.lane][u.toStep])?.capabilityId ?? ''
                                    )?.inputMeta[u.toInput]?.label
                                  )}
                                  <ArrowUpRight class="size-3" />
                                </button>
                              {/each}
                            </div>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        </div>
      {:else if selected.kind === 'reaction' && selectedReaction && selectedCap}
        {@const reaction = selectedReaction}
        {@const reactionCap = selectedCap}
        {@const lane = selected.lane}
        {@const reactionIndex = selected.index}
        {@const boundInputNames = Object.keys(reaction.inputBindings).sort((a, b) => {
          const aGroup = inputGroupFor(reactionCap, a);
          const bGroup = inputGroupFor(reactionCap, b);
          return aGroup.order - bGroup.order || aGroup.inputOrder - bGroup.inputOrder || a.localeCompare(b);
        })}
        {@const availableOptionalReaction = Object.entries(reactionCap.inputMeta)
          .filter(([name, meta]) => !isRequiredInput(meta) && !(name in reaction.inputBindings))
          .map(([name, meta]) => ({ value: name, label: fieldLabel(name, (meta as { label?: string }).label) }))}

        <!-- Reaction header -->
        <div class="border-b bg-muted/20 px-6 py-4">
          <div class="flex items-start gap-4">
            <div class="flex size-11 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-semibold tabular-nums text-muted-foreground
              {lane === 'onFailure' ? 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400' : 'border-border bg-background'}">
              {lane === 'onFailure' ? 'F' : 'S'}{String(reactionIndex + 1).padStart(2, '0')}
            </div>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="truncate text-lg font-semibold">{reactionCap.name}</h2>
                <span class="rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider
                  {lane === 'onFailure' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : 'bg-muted text-muted-foreground'}">
                  {lane === 'onFailure' ? 'On Failure' : 'On Success'}
                </span>
              </div>
              <div class="flex items-center gap-1">
                <input
                  class="min-w-0 flex-1 bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:text-foreground"
                  placeholder="Custom label (optional)"
                  value={reaction.label ?? ''}
                  oninput={(e) => {
                    const steps = [...draft.outcomeSteps[lane]];
                    steps[reactionIndex] = { ...reaction, label: (e.target as HTMLInputElement).value || undefined };
                    draft = { ...draft, outcomeSteps: { ...draft.outcomeSteps, [lane]: steps } };
                  }}
                />
              </div>
            </div>
            <div class="flex items-center gap-1">
              <Button
                variant="ghost" size="icon" class="h-8 w-8"
                disabled={reactionIndex === 0}
                onclick={() => moveReactionStep(lane, reactionIndex, -1)}
                title="Move up"
              >
                <ChevronUp class="size-4" />
              </Button>
              <Button
                variant="ghost" size="icon" class="h-8 w-8"
                disabled={reactionIndex === draft.outcomeSteps[lane].length - 1}
                onclick={() => moveReactionStep(lane, reactionIndex, 1)}
                title="Move down"
              >
                <ChevronDown class="size-4" />
              </Button>
              <Button
                variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-rose-500"
                onclick={() => removeOutcomeStep(lane, reactionIndex)}
                title="Remove step"
              >
                <Trash2 class="size-4" />
              </Button>
            </div>
          </div>
          {#if reactionCap.description}
            <p class="mt-3 text-sm text-muted-foreground">{reactionCap.description}</p>
          {/if}
        </div>

        <!-- Reaction inputs -->
        <div class="mx-auto w-full max-w-2xl space-y-4 p-6">
          {#each boundInputNames as inputName (inputName)}
            {@const meta = reactionCap.inputMeta[inputName]}
            {@const binding = reaction.inputBindings[inputName]}
            {#if meta && binding}
              {@const currentSource = sourceOf(binding)}
              {@const allowedSrcs = allowedSourcesFor(meta, lane === 'onFailure').filter(
                (s) => s !== 'wire' || reactionWireSteps().length > 0
              )}
              <section class="rounded-lg border bg-card">
                <div class="flex items-start justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="text-sm font-medium">{fieldLabel(inputName, meta.label)}</h3>
                      <span class="rounded-sm border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{inputTypeLabel(meta)}</span>
                    </div>
                    {#if meta.description}<p class="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>{/if}
                  </div>
                  <span class="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {meta.required === false ? 'Optional' : 'Required'}
                  </span>
                  {#if meta.required === false}
                    <button
                      type="button"
                      class="text-muted-foreground transition-colors hover:text-rose-500"
                      onclick={() => removeOptionalReactionInput(inputName)}
                    >
                      <Trash2 class="size-3.5" />
                    </button>
                  {/if}
                </div>

                <!-- Source picker -->
                <div class="border-b px-4 py-3">
                  <div class="flex flex-wrap gap-1.5">
                    {#each allowedSrcs as src (src)}
                      <button
                        type="button"
                        class="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors
                          {currentSource === src ? sourceBorderClass(src) + ' ' + sourceIconColor(src) : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'}"
                        onclick={() => changeReactionSource(inputName, src as Source)}
                      >
                        {sourceLabel(src)}
                      </button>
                    {/each}
                  </div>
                </div>

                <!-- Reaction binding editor -->
                <div class="space-y-2 p-4">
                  <p class="text-xs text-muted-foreground">{sourceHint(currentSource, meta)}</p>

                  {#if binding.kind === 'template'}
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] text-muted-foreground font-mono">Use <code>{'{{variable}}'}</code> to insert values.</span>
                      <BindingVariableInserter
                        {lane}
                        mainSteps={draft.steps}
                        laneSteps={draft.outcomeSteps[lane].slice(0, reactionIndex)}
                        prompts={draft.prompts}
                        siteFactFields={siteFactFieldsQuery.data ?? []}
                        {capIndex}
                        target={activeTemplateRef}
                        value={binding.template}
                        oninsert={(v) => setReactionBinding(inputName, { kind: 'template', template: v })}
                      />
                    </div>
                    <Textarea
                      placeholder="e.g. failure message, step 1 hostname…"
                      value={binding.template}
                      rows={4}
                      onfocus={(e) => (activeTemplateRef = e.currentTarget as HTMLTextAreaElement)}
                      oninput={(e) => setReactionBinding(inputName, { kind: 'template', template: (e.target as HTMLTextAreaElement).value })}
                    />
                  {:else if binding.kind === 'literal'}
                    {#if meta.entityType}
                      <EntityPicker
                        entityType={meta.entityType as EntityType}
                        multiple={meta.typeHint === 'stringArray'}
                        value={binding.value as string | string[] | null}
                        onValueChange={(v) => setReactionBinding(inputName, { kind: 'literal', value: v })}
                      />
                    {:else if meta.typeHint === 'boolean'}
                      <label class="flex items-center gap-2 text-sm">
                        <Checkbox checked={Boolean(binding.value)} onCheckedChange={(c) => setReactionBinding(inputName, { kind: 'literal', value: Boolean(c) })} />
                        <span class="text-muted-foreground">{binding.value ? 'true' : 'false'}</span>
                      </label>
                    {:else if meta.typeHint === 'stringArray' && meta.choices && meta.choices.length > 0}
                      <MultiSelect
                        options={meta.choices as { value: string; label: string }[]}
                        selected={Array.isArray(binding.value) ? binding.value as string[] : []}
                        placeholder="Choose one or more…"
                        onchange={(v) => setReactionBinding(inputName, { kind: 'literal', value: v })}
                      />
                    {:else if meta.choices && meta.choices.length > 0}
                      <SingleSelect
                        options={meta.choices as { value: string; label: string }[]}
                        selected={typeof binding.value === 'string' ? binding.value : ''}
                        onchange={(v) => setReactionBinding(inputName, { kind: 'literal', value: v })}
                      />
                    {:else if meta.typeHint === 'stringArray'}
                      <Input
                        placeholder="value1, value2"
                        value={Array.isArray(binding.value) ? (binding.value as string[]).join(', ') : ''}
                        oninput={(e) => { const arr = (e.target as HTMLInputElement).value.split(',').map((v) => v.trim()).filter(Boolean); setReactionBinding(inputName, { kind: 'literal', value: arr }); }}
                      />
                    {:else}
                      <Input
                        type={meta.sensitive ? 'password' : 'text'}
                        value={typeof binding.value === 'string' ? binding.value : ''}
                        oninput={(e) => setReactionBinding(inputName, { kind: 'literal', value: (e.target as HTMLInputElement).value })}
                      />
                    {/if}
                  {:else if binding.kind === 'runtime'}
                    <div class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      The operator will answer this before the package starts.
                    </div>
                  {:else if binding.kind === 'siteFact'}
                    <SingleSelect
                      options={factFieldsFor(meta.typeHint).map((f) => ({ value: f.key, label: f.label, subLabel: `${f.fieldTypeLabel ?? f.type} · ${f.section}` }))}
                      selected={binding.key}
                      placeholder="Choose a site profile field…"
                      onchange={(k) => setReactionBinding(inputName, { ...binding, key: k })}
                    />
                  {:else if binding.kind === 'failureContext'}
                    <SingleSelect
                      options={[
                        { value: 'message', label: 'Error message' },
                        { value: 'capabilityName', label: 'Failed capability' },
                        { value: 'errorClass', label: 'Error class' },
                        { value: 'stepPosition', label: 'Failed step number' },
                        { value: 'status', label: 'Run status' },
                        { value: 'runId', label: 'Run ID' },
                        { value: 'siteId', label: 'Site ID' },
                      ]}
                      selected={binding.path}
                      disableSort
                      onchange={(p) => setReactionBinding(inputName, { ...binding, path: p as typeof binding.path })}
                    />
                  {:else if binding.kind === 'generated'}
                    <p class="text-xs text-muted-foreground">{sourceHint('generated', meta)}</p>
                  {:else if binding.kind === 'priorOutput'}
                    {@const wireSteps = reactionWireSteps()}
                    {@const srcLane = binding.lane ?? 'main'}
                    {@const selectedWireStep = `${srcLane}:${binding.stepPosition}`}
                    {@const outputOptions = reactionWireOutputs(binding, meta)}
                    {#if wireSteps.length === 0}
                      <div class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        Add a main step or an earlier reaction before wiring this input.
                      </div>
                    {:else}
                      <div class="grid gap-2 sm:grid-cols-2">
                        <SingleSelect
                          options={wireSteps.map(({ value, label }) => ({ value, label }))}
                          selected={selectedWireStep}
                          placeholder="Source step…"
                          disableSort
                          onchange={(v) => {
                            const src = wireSteps.find((w) => w.value === v);
                            if (!src) return;
                            setReactionBinding(inputName, { ...binding, lane: src.lane, stepPosition: src.position, path: '' });
                          }}
                        />
                        <SingleSelect
                          options={outputOptions}
                          selected={binding.path}
                          placeholder="Output field…"
                          onchange={(p) => setReactionBinding(inputName, { ...binding, path: p })}
                        />
                      </div>
                      {#if outputOptions.length === 0}
                        <p class="text-xs text-amber-700 dark:text-amber-400">The selected step has no compatible outputs for this input.</p>
                      {/if}
                    {/if}
                  {/if}
                </div>
              </section>
            {/if}
          {/each}

          {#if availableOptionalReaction.length > 0}
            <div class="rounded-md border border-dashed p-3">
              <SingleSelect
                options={availableOptionalReaction}
                selected=""
                placeholder="Add an optional input…"
                onchange={(v) => v && addOptionalReactionInput(v)}
              />
            </div>
          {/if}
        </div>
      {:else}
        <div class="p-6 text-sm text-rose-500">Unknown capability.</div>
      {/if}
    </section>
  </div>
</div>

<CapabilityPicker
  bind:open={capabilityPickerOpen}
  target={capabilityPickerTarget}
  capabilities={capabilitiesQuery.data ?? []}
  onAdd={addStep}
/>
