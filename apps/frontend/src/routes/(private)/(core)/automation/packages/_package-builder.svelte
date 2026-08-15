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
    | { kind: 'siteFact'; key: string; required: boolean };

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
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import EntityPicker from '$lib/components/domain/entity-picker.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { fieldLabel } from '$lib/utils/label';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import {
    ArrowLeft,
    ArrowUp,
    ArrowDown,
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
    Search,
    SlidersHorizontal,
    X,
  } from '@lucide/svelte';

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license' | 'm365_role';
  type Source = 'fixed' | 'runtime' | 'row' | 'wire' | 'failure' | 'generated' | 'fact';

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

  // Which declared fact fields are compatible with a given input typeHint.
  // Mapping is intentionally loose — a string fact can drive text/password/upn
  // inputs; number → number; boolean → boolean; multi-value → stringArray.
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

  // Sites, groups, and tenant links feed the scope pickers in the details panel.
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

  // Pick the first generator that supports a given input's typeHint. Today
  // that's password ↔ 'password'; more generators plug in the same way.
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

  const isGlobalScope = $derived(
    draft.allowedSites.length === 0 &&
      draft.allowedSiteGroups.length === 0 &&
      draft.allowedIntegrationLinks.length === 0
  );

  // Selection defaults to the first step when the package loads; -1 = meta (details).
  let selectedIndex = $state<number>(initial.steps.length > 0 ? 0 : -1);
  let capabilityPickerOpen = $state(false);
  let capabilityPickerTarget = $state<'main' | 'onSuccess' | 'onFailure'>('main');
  let reactionEditor = $state<{ lane: 'onSuccess' | 'onFailure'; index: number } | null>(null);
  let capabilitySearch = $state('');
  let vendorFilters = $state<string[]>([]);
  let categoryFilters = $state<string[]>([]);

  const capIndex = $derived(new Map((capabilitiesQuery.data ?? []).map((c) => [c.id, c])));

  const capabilityCatalog = $derived(
    (capabilitiesQuery.data ?? []).map((c) => ({
      ...c,
      searchText: [c.name, c.vendor, c.category, c.description, c.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }))
  );
  const capabilityVendors = $derived(
    [...new Set(capabilityCatalog.map((c) => c.vendor))].sort((a, b) => a.localeCompare(b))
  );
  const capabilityCategories = $derived(
    [...new Set(capabilityCatalog.map((c) => c.category).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    )
  );
  const filteredCapabilities = $derived.by(() => {
    const query = capabilitySearch.trim().toLowerCase();
    return capabilityCatalog.filter((c) => {
      if (vendorFilters.length > 0 && !vendorFilters.includes(c.vendor)) return false;
      if (categoryFilters.length > 0 && !categoryFilters.includes(c.category)) return false;
      if (query && !c.searchText.includes(query)) return false;
      return true;
    });
  });

  // Map an underlying binding to a UX-facing source. `entity+picker` collapses
  // into `runtime` visually — they behave identically at run time (a picker
  // shows) and the two shapes existed only for legacy reasons.
  function sourceOf(binding: Binding | undefined): Source {
    if (!binding) return 'fixed';
    if (binding.kind === 'literal') return 'fixed';
    if (binding.kind === 'runtime') return 'runtime';
    if (binding.kind === 'priorOutput') return 'wire';
    if (binding.kind === 'failureContext') return 'failure';
    if (binding.kind === 'generated') return 'generated';
    if (binding.kind === 'siteFact') return 'fact';
    // entity kind:
    return binding.source === 'row-context' ? 'row' : 'runtime';
  }

  function allowedSourcesFor(meta: {
    allowedBindings: readonly string[];
    typeHint?: string;
  }, allowFailureContext = false): Source[] {
    const set = new Set(meta.allowedBindings);
    const out: Source[] = [];
    if (set.has('literal')) out.push('fixed');
    if (set.has('runtime') || set.has('entity')) out.push('runtime');
    // Row-trigger execution is not implemented by the worker yet. Do not
    // advertise a source authors cannot successfully run.
    if (set.has('priorOutput')) out.push('wire');
    if (allowFailureContext && set.has('failureContext')) out.push('failure');
    // Only show `generated` if a registered generator applies to this typeHint,
    // otherwise it's dead UI.
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
      // If the underlying schema only allows entity+picker (no true runtime),
      // fall back to that shape so the mutation validates server-side.
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
      // Fall back to a fixed literal if no generator applies — shouldn't
      // happen since allowedSourcesFor filters this out, but keeps the type
      // exhaustive.
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
      selectedIndex = nextIndex;
    } else {
      draft.outcomeSteps = {
        ...draft.outcomeSteps,
        [capabilityPickerTarget]: [...draft.outcomeSteps[capabilityPickerTarget], step],
      };
    }
    capabilityPickerOpen = false;
    capabilitySearch = '';
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
  }

  function reactionStep(editor = reactionEditor): Step | null {
    if (!editor) return null;
    return draft.outcomeSteps[editor.lane][editor.index] ?? null;
  }

  function setReactionBinding(inputName: string, binding: Binding) {
    if (!reactionEditor) return;
    const { lane, index } = reactionEditor;
    const reaction = draft.outcomeSteps[lane][index];
    if (!reaction) return;
    draft.outcomeSteps = {
      ...draft.outcomeSteps,
      [lane]: draft.outcomeSteps[lane].map((step, position) =>
        position === index ? { ...step, inputBindings: { ...step.inputBindings, [inputName]: binding } } : step,
      ),
    };
  }

  function changeReactionSource(inputName: string, source: Source) {
    const reaction = reactionStep();
    if (!reaction) return;
    const cap = capIndex.get(reaction.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    const binding = runtimeBindingForLane(
      defaultBindingFor(source, inputName, meta),
      inputName,
      meta,
      reactionEditor?.lane ?? 'onSuccess',
    );
    setReactionBinding(inputName, binding);
    pruneUnusedPrompts();
  }

  function addOptionalReactionInput(inputName: string) {
    const reaction = reactionStep();
    if (!reaction) return;
    const cap = capIndex.get(reaction.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    const binding = runtimeBindingForLane(
      defaultForInput(inputName, meta),
      inputName,
      meta,
      reactionEditor?.lane ?? 'onSuccess',
    );
    setReactionBinding(inputName, binding);
  }

  function removeOptionalReactionInput(inputName: string) {
    if (!reactionEditor) return;
    const { lane, index } = reactionEditor;
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

  function reactionWireSteps() {
    if (!reactionEditor) return [] as Array<{ value: string; label: string; lane: 'main' | 'onSuccess' | 'onFailure'; position: number; step: Step }>;
    const ownLane = reactionEditor.lane;
    const main = ownLane === 'onFailure' ? [] : draft.steps.map((step, position) => ({
      value: `main:${position}`,
      label: `Main · Step ${String(position + 1).padStart(2, '0')}: ${step.label ?? capIndex.get(step.capabilityId)?.name ?? step.capabilityId}`,
      lane: 'main' as const,
      position,
      step,
    }));
    const earlierReactions = draft.outcomeSteps[ownLane]
      .slice(0, reactionEditor.index)
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

  function toggleFilter(current: string[], value: string): string[] {
    return current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
  }

  function clearCapabilityFilters() {
    capabilitySearch = '';
    vendorFilters = [];
    categoryFilters = [];
  }

  function formatVendorLabel(value: string): string {
    return value.replace(/[_-]+/g, ' ').toUpperCase();
  }

  function formatCategoryLabel(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function addOptionalInput(stepIndex: number, inputName: string) {
    const step = draft.steps[stepIndex]!;
    const cap = capIndex.get(step.capabilityId);
    const meta = cap?.inputMeta[inputName];
    if (!meta) return;
    step.inputBindings[inputName] = defaultForInput(inputName, meta);
    if (step.inputBindings[inputName]?.kind === 'runtime') ensurePrompt(inputName, inputName, meta);
    draft.steps = [...draft.steps];
  }

  function removeOptionalInput(stepIndex: number, inputName: string) {
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
    if (selectedIndex >= filtered.length) selectedIndex = filtered.length - 1;
    pruneUnusedPrompts();
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.steps.length) return;
    const next = [...draft.steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    draft.steps = next;
    if (selectedIndex === index) selectedIndex = target;
    else if (selectedIndex === target) selectedIndex = index;
  }

  function changeSource(stepIndex: number, inputName: string, source: Source) {
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

  // Per-step summary chips used on the canvas. Encodes the shape of the
  // step's data sources at a glance: how many prompts, whether it's wired
  // from prior steps, whether it reads from row context.
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
      else s.literals += 1;
    }
    return s;
  }

  // Outputs of a step that at least one downstream step reads. Rendered in
  // the inspector so the user can see wiring in both directions.
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

  function sourceLabel(source: Source): string {
    if (source === 'fixed') return 'Fixed value';
    if (source === 'runtime') return 'Ask when run';
    if (source === 'row') return 'From triggering row';
    if (source === 'generated') return 'Generate';
    if (source === 'fact') return 'From site fact';
    if (source === 'failure') return 'From failure';
    return 'Wire from step';
  }

  function sourceHint(
    source: Source,
    meta: { entityType?: string; typeHint?: string } | undefined
  ): string {
    if (source === 'fixed') return 'Same value every run.';
    if (source === 'runtime')
      return meta?.entityType
        ? 'The operator picks from a live list when they start the run.'
        : 'The operator enters this when they start the run.';
    if (source === 'row')
      return 'Auto-filled from the row that triggered this package (from a table row-action).';
    if (source === 'generated') return 'Produced by a generator at run time.';
    if (source === 'fact')
      return "Reads a value from the run's site profile facts — needs a site selected at run time.";
    if (source === 'failure') return 'Reads the dependable error context created when the main package fails.';
    return 'Reads a specific output from an earlier step in this package.';
  }

  function sourceIconColor(source: Source): string {
    if (source === 'fixed') return 'text-stone-500 dark:text-stone-400';
    if (source === 'runtime') return 'text-amber-600 dark:text-amber-400';
    if (source === 'row') return 'text-violet-600 dark:text-violet-400';
    if (source === 'generated') return 'text-emerald-600 dark:text-emerald-400';
    if (source === 'fact') return 'text-fuchsia-600 dark:text-fuchsia-400';
    if (source === 'failure') return 'text-rose-600 dark:text-rose-400';
    return 'text-cyan-600 dark:text-cyan-400';
  }

  function sourceBorderClass(source: Source): string {
    if (source === 'fixed') return 'border-l-stone-400/60 dark:border-l-stone-500/60';
    if (source === 'runtime') return 'border-l-amber-500/70';
    if (source === 'row') return 'border-l-violet-500/70';
    if (source === 'generated') return 'border-l-emerald-500/70';
    if (source === 'fact') return 'border-l-fuchsia-500/70';
    if (source === 'failure') return 'border-l-rose-500/70';
    return 'border-l-cyan-500/70';
  }

  // This is intentionally a presentation layer over the existing capability
  // metadata. The upcoming shared type-registry work will own these labels
  // across packages, site facts, and compliance policies; authors should not
  // have to wait for that larger migration to see the shape of a field today.
  function inputTypeLabel(meta: { entityType?: string; typeHint?: string }): string {
    const entityLabels: Record<string, string> = {
      integration_link: 'Integration link',
      m365_identity: 'Microsoft 365 identity',
      m365_group: 'Microsoft 365 group',
      m365_license: 'Microsoft 365 license',
      m365_role: 'Microsoft 365 role',
      site: 'MSPByte site',
    };
    if (meta.entityType) return entityLabels[meta.entityType] ?? meta.entityType.replace(/[_-]+/g, ' ');
    const labels: Record<string, string> = {
      boolean: 'Boolean',
      number: 'Number',
      stringArray: 'Text list',
      password: 'Secret text',
      upn: 'User principal name',
      postalCode: 'Postal code',
      city: 'City',
      countryCode: 'Country code',
      state: 'State / region',
      text: 'Text',
    };
    return labels[meta.typeHint ?? 'text'] ?? 'Text';
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
      }
    }
    return true;
  }

  const selectedStep = $derived(selectedIndex >= 0 ? (draft.steps[selectedIndex] ?? null) : null);
  const selectedCap = $derived(selectedStep ? capIndex.get(selectedStep.capabilityId) : undefined);
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

  // Inspector: prompt-key hint. When the promptKey differs from the input
  // name the user is doing something intentional (dedup across steps) — we
  // surface it. Otherwise we keep it collapsed.
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
          onclick={() => (selectedIndex = -1)}
          class="flex w-full items-center gap-2 border-b px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 {selectedIndex ===
          -1
            ? 'bg-muted/60'
            : ''}"
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
              {@const isSelected = selectedIndex === i}
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
                  onclick={() => (selectedIndex = i)}
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
                      {cap?.name ?? step.capabilityId}
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
      {#if selectedIndex === -1}
        <!-- Package meta panel -->
        <div class="mx-auto w-full max-w-2xl space-y-6 p-6">
          <div>
            <h2 class="text-lg font-semibold">Package details</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Give the package a name your team will recognize and describe what it does. This copy
              shows up in the runner and in audit logs.
            </p>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium" for="pkg-name-inspector">Name</label>
            <Input
              id="pkg-name-inspector"
              placeholder="e.g. Onboard new M365 user"
              value={draft.name}
              oninput={(e) => (draft.name = (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium" for="pkg-desc-inspector">Description</label>
            <Textarea
              id="pkg-desc-inspector"
              placeholder="Describe when and why this package should be run."
              value={draft.description}
              oninput={(e) => (draft.description = (e.target as HTMLTextAreaElement).value)}
              rows={4}
            />
          </div>

          <div class="space-y-3 rounded-lg border p-4">
            <div class="flex items-baseline justify-between gap-3">
              <div>
                <h3 class="text-sm font-medium">Scope</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Restrict where this package can run. Leave both empty to make it global.
                </p>
              </div>
              <span
                class="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider {isGlobalScope
                  ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}"
              >
                {isGlobalScope
                  ? 'Global'
                  : `${draft.allowedSites.length} sites · ${draft.allowedSiteGroups.length} groups · ${draft.allowedIntegrationLinks.length} tenants`}
              </span>
            </div>
            <div class="space-y-2">
              <div class="text-xs text-muted-foreground">Allowed sites</div>
              <MultiSelect
                options={siteOptions}
                selected={draft.allowedSites}
                placeholder="Any site (global)"
                onchange={(v) => (draft.allowedSites = v)}
              />
            </div>
            <div class="space-y-2">
              <div class="text-xs text-muted-foreground">Allowed site groups</div>
              <MultiSelect
                options={siteGroupOptions}
                selected={draft.allowedSiteGroups}
                placeholder="No group restriction"
                onchange={(v) => (draft.allowedSiteGroups = v)}
              />
            </div>
            <div class="space-y-2">
              <div class="text-xs text-muted-foreground">Allowed tenant links</div>
              <MultiSelect
                options={tenantLinkOptions}
                selected={draft.allowedIntegrationLinks}
                placeholder="No tenant restriction"
                onchange={(v) => (draft.allowedIntegrationLinks = v)}
              />
            </div>
          </div>

          <div class="space-y-3 rounded-lg border bg-muted/10 p-4">
            <div class="flex items-baseline justify-between gap-3">
              <div>
                <h3 class="text-sm font-medium">Run experience</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  These are the only questions an operator sees when they run this preset.
                </p>
              </div>
              <span class="font-mono text-[11px] text-muted-foreground">
                {normalPublishedPrompts.length} {normalPublishedPrompts.length === 1 ? 'prompt' : 'prompts'}
              </span>
            </div>
            {#if normalPublishedPrompts.length === 0}
              <p class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                This package runs with its preset values. Add a capability input as “Ask when run” to publish a question.
              </p>
            {:else}
              <div class="space-y-2">
                {#each normalPublishedPrompts as prompt (prompt.id)}
                  <div class="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div class="min-w-0 space-y-1">
                      <Input
                        value={prompt.label}
                        aria-label={`Prompt label for ${prompt.id}`}
                        oninput={(event) => updatePrompt(prompt.id, { label: (event.target as HTMLInputElement).value })}
                        class="h-8 text-sm font-medium"
                      />
                      <Input
                        value={prompt.description ?? ''}
                        placeholder="Help the operator understand this choice"
                        aria-label={`Prompt help for ${prompt.id}`}
                        oninput={(event) => updatePrompt(prompt.id, { description: (event.target as HTMLInputElement).value })}
                        class="h-8 text-xs"
                      />
                    </div>
                    <label class="flex items-center gap-2 whitespace-nowrap pt-1 text-xs text-muted-foreground">
                      <Checkbox
                        checked={prompt.required}
                        onCheckedChange={(checked) => setPromptRequired(prompt.id, Boolean(checked))}
                      />
                      Required
                    </label>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          {#if draft.outcomeSteps.onFailure.length > 0}
            <div class="space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
              <div class="flex items-baseline justify-between gap-3">
                <div>
                  <h3 class="text-sm font-medium">On failure run experience</h3>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    These questions are only used if this package reaches its failure lane. They stay separate from normal-run inputs.
                  </p>
                </div>
                <span class="font-mono text-[11px] text-muted-foreground">
                  {failurePublishedPrompts.length} {failurePublishedPrompts.length === 1 ? 'prompt' : 'prompts'}
                </span>
              </div>
              {#if failurePublishedPrompts.length === 0}
                <p class="rounded-md border border-dashed border-rose-500/30 px-3 py-2 text-xs text-muted-foreground">
                  This failure lane uses preset values and site facts only.
                </p>
              {:else}
                <div class="space-y-2">
                  {#each failurePublishedPrompts as prompt (prompt.id)}
                    <div class="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-start">
                      <div class="min-w-0 space-y-1">
                        <Input
                          value={prompt.label}
                          aria-label={`Failure prompt label for ${prompt.id}`}
                          oninput={(event) => updatePrompt(prompt.id, { label: (event.target as HTMLInputElement).value })}
                          class="h-8 text-sm font-medium"
                        />
                        <Input
                          value={prompt.description ?? ''}
                          placeholder="Help the operator understand this failure input"
                          aria-label={`Failure prompt help for ${prompt.id}`}
                          oninput={(event) => updatePrompt(prompt.id, { description: (event.target as HTMLInputElement).value })}
                          class="h-8 text-xs"
                        />
                      </div>
                      <label class="flex items-center gap-2 whitespace-nowrap pt-1 text-xs text-muted-foreground">
                        <Checkbox
                          checked={prompt.required}
                          onCheckedChange={(checked) => setPromptRequired(prompt.id, Boolean(checked))}
                        />
                        Required
                      </label>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <div class="space-y-3 rounded-lg border p-4">
            <div>
              <h3 class="text-sm font-medium">After the package finishes</h3>
              <p class="mt-0.5 text-xs text-muted-foreground">
                Add one-way reactions for completion or failure. These run after the main path and cannot branch back into it.
              </p>
            </div>
            <div class="grid gap-3 lg:grid-cols-2">
              {#each [
                { id: 'onSuccess' as const, title: 'On success', description: 'Run only when every main step completes.', tone: 'border-emerald-500/30 bg-emerald-500/5' },
                { id: 'onFailure' as const, title: 'On failure', description: 'Run after a halted or partial package.', tone: 'border-rose-500/30 bg-rose-500/5' },
              ] as lane}
                <section class="rounded-md border p-3 {lane.tone}">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h4 class="text-sm font-medium">{lane.title}</h4>
                      <p class="mt-0.5 text-xs text-muted-foreground">{lane.description}</p>
                    </div>
                    <Button variant="outline" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={() => openCapabilityPicker(lane.id)}>
                      <Plus class="size-3" /> Add reaction
                    </Button>
                  </div>
                  {#if draft.outcomeSteps[lane.id].length === 0}
                    <p class="mt-3 border-t border-current/10 pt-3 text-xs text-muted-foreground">No reaction configured.</p>
                  {:else}
                    <ol class="mt-3 space-y-1.5 border-t border-current/10 pt-3">
                      {#each draft.outcomeSteps[lane.id] as reaction, reactionIndex (reactionIndex)}
                        {@const reactionCap = capIndex.get(reaction.capabilityId)}
                        <li class="flex items-center gap-2 rounded border bg-background/80 px-2.5 py-2 text-xs">
                          <span class="font-mono text-muted-foreground">{String(reactionIndex + 1).padStart(2, '0')}</span>
                          <button
                            type="button"
                            class="min-w-0 flex-1 truncate text-left font-medium transition-colors hover:text-primary"
                            onclick={() => (reactionEditor = { lane: lane.id, index: reactionIndex })}
                          >
                            {reactionCap?.name ?? reaction.capabilityId}
                          </button>
                          <button
                            type="button"
                            class="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onclick={() => (reactionEditor = { lane: lane.id, index: reactionIndex })}
                          >
                            Configure
                          </button>
                          <button type="button" class="text-muted-foreground hover:text-rose-500" onclick={() => removeOutcomeStep(lane.id, reactionIndex)} aria-label={`Remove ${reactionCap?.name ?? reaction.capabilityId}`}>
                            <Trash2 class="size-3.5" />
                          </button>
                        </li>
                      {/each}
                    </ol>
                  {/if}
                </section>
              {/each}
            </div>
          </div>

          {#if draft.steps.length === 0}
            <div class="rounded-lg border border-dashed p-8 text-center">
              <div class="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
                <Sparkles class="size-4 text-muted-foreground" />
              </div>
              <p class="mt-3 text-sm font-medium">Add your first step</p>
              <p class="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                Pick a capability from the left panel to start composing.
              </p>
            </div>
          {/if}
        </div>
      {:else if selectedStep && selectedCap}
        {@const cap = selectedCap}
        {@const step = selectedStep}
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
        {@const readers = downstreamReaders(selectedIndex)}
        <!-- Step header -->
        <div class="border-b bg-muted/20 px-6 py-4">
          <div class="flex items-start gap-4">
            <div
              class="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background font-mono text-sm font-semibold tabular-nums text-muted-foreground"
            >
              {String(selectedIndex + 1).padStart(2, '0')}
            </div>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="truncate text-lg font-semibold">{cap.name}</h2>
                <span
                  class="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  {cap.category}
                </span>
              </div>
              {#if cap.description}
                <p class="text-sm text-muted-foreground">{cap.description}</p>
              {/if}
              <div class="pt-1 font-mono text-[10px] text-muted-foreground/70">
                {cap.id}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0"
                onclick={() => moveStep(selectedIndex, -1)}
                disabled={selectedIndex === 0}
                aria-label="Move step up"
              >
                <ArrowUp class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0"
                onclick={() => moveStep(selectedIndex, 1)}
                disabled={selectedIndex === draft.steps.length - 1}
                aria-label="Move step down"
              >
                <ArrowDown class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="size-8 p-0 text-muted-foreground hover:text-rose-500"
                onclick={() => removeStep(selectedIndex)}
                aria-label="Remove step"
              >
                <Trash2 class="size-4" />
              </Button>
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
                {@const allowed = allowedSourcesFor(meta)}
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
                        onclick={() => removeOptionalInput(selectedIndex, inputName)}
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
                        onclick={() => changeSource(selectedIndex, inputName, src)}
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

                    {#if binding?.kind === 'literal'}
                      {#if meta.entityType}
                        <EntityPicker
                          entityType={meta.entityType as EntityType}
                          multiple={meta.typeHint === 'stringArray'}
                          value={binding.value as string | string[] | null}
                          onValueChange={(v) =>
                            setBinding(selectedIndex, inputName, {
                              kind: 'literal',
                              value: v,
                            })}
                        />
                      {:else if meta.typeHint === 'boolean'}
                        <label class="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={Boolean(binding.value)}
                            onCheckedChange={(c) =>
                              setBinding(selectedIndex, inputName, {
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
                            setBinding(selectedIndex, inputName, {
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
                            setBinding(selectedIndex, inputName, {
                              kind: 'literal',
                              value: (e.target as HTMLInputElement).value,
                            })}
                        />
                      {/if}
                    {:else if binding?.kind === 'runtime'}
                      <div
                        class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                      >
                        {#if meta.entityType}
                          A picker for
                          <span class="font-mono">{meta.entityType.replace('_', ' ')}</span>
                          will appear when this runs.
                        {:else if meta.typeHint === 'password'}
                          A password field will appear. Operators can generate a strong random
                          password or set a specific one.
                        {:else}
                          A text input will appear when this runs.
                        {/if}
                      </div>
                      <button
                        type="button"
                        class="text-xs text-muted-foreground hover:text-foreground"
                        onclick={() =>
                          (showPromptKeyEditor[`${selectedIndex}:${inputName}`] =
                            !showPromptKeyEditor[`${selectedIndex}:${inputName}`])}
                      >
                        {showPromptKeyEditor[`${selectedIndex}:${inputName}`] ? 'Hide' : 'Show'} prompt
                        key
                        <span class="ml-1 font-mono opacity-60">
                          ({binding.promptKey})
                        </span>
                      </button>
                      {#if showPromptKeyEditor[`${selectedIndex}:${inputName}`]}
                        <div class="grid gap-2 pt-1 sm:grid-cols-[1fr_auto]">
                          <Input
                            placeholder="Prompt key"
                            value={binding.promptKey}
                            oninput={(e) =>
                              setBinding(selectedIndex, inputName, {
                                ...binding,
                                promptKey: (e.target as HTMLInputElement).value,
                              })}
                          />
                          <label
                            class="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
                          >
                            <Checkbox
                              checked={binding.required}
                              onCheckedChange={(c) =>
                                setBinding(selectedIndex, inputName, {
                                  ...binding,
                                  required: Boolean(c),
                                })}
                            />
                            Required at run time
                          </label>
                        </div>
                        <p class="text-[11px] text-muted-foreground">
                          Steps that share a prompt key answer the same question once.
                        </p>
                      {/if}
                    {:else if binding?.kind === 'entity' && binding.source === 'picker'}
                      <!-- Legacy shape: entity+picker. Renders same UX as runtime. -->
                      <div
                        class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                      >
                        A picker will appear when this runs.
                      </div>
                    {:else if binding?.kind === 'entity' && binding.source === 'row-context'}
                      <div class="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
                        <span class="text-xs text-muted-foreground">Context key</span>
                        <Input
                          placeholder="e.g. identityId"
                          value={binding.contextKey ?? ''}
                          oninput={(e) =>
                            setBinding(selectedIndex, inputName, {
                              ...binding,
                              contextKey: (e.target as HTMLInputElement).value,
                            })}
                        />
                      </div>
                      <p class="text-[11px] text-muted-foreground">
                        Leave empty to use the input name — usually what you want.
                      </p>
                    {:else if binding?.kind === 'generated'}
                      {@const gen = (generatorsQuery.data ?? []).find(
                        (g) => g.id === binding.generator
                      )}
                      {#if !gen}
                        <div
                          class="rounded-md border border-dashed border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-500"
                        >
                          Generator "{binding.generator}" not found. Pick another source.
                        </div>
                      {:else if binding.generator === 'password'}
                        {@const pwParams = binding.params as {
                          length?: number;
                          symbols?: boolean;
                          excludeAmbiguous?: boolean;
                        }}
                        <div class="space-y-3">
                          <div class="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                            <span class="text-xs text-muted-foreground">Length</span>
                            <Input
                              type="number"
                              min={8}
                              max={128}
                              value={pwParams.length ?? 20}
                              oninput={(e) => {
                                const n = Number((e.target as HTMLInputElement).value);
                                setBinding(selectedIndex, inputName, {
                                  ...binding,
                                  params: {
                                    ...binding.params,
                                    length: Number.isFinite(n) ? n : 20,
                                  },
                                });
                              }}
                              class="max-w-32"
                            />
                            <span class="font-mono text-[11px] text-muted-foreground"> chars </span>
                          </div>
                          <label class="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={pwParams.symbols ?? true}
                              onCheckedChange={(c) =>
                                setBinding(selectedIndex, inputName, {
                                  ...binding,
                                  params: { ...binding.params, symbols: Boolean(c) },
                                })}
                            />
                            <span class="text-muted-foreground">
                              Include symbols
                              <span class="ml-1 font-mono opacity-60">(!@#$%…)</span>
                            </span>
                          </label>
                          <label class="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={pwParams.excludeAmbiguous ?? false}
                              onCheckedChange={(c) =>
                                setBinding(selectedIndex, inputName, {
                                  ...binding,
                                  params: {
                                    ...binding.params,
                                    excludeAmbiguous: Boolean(c),
                                  },
                                })}
                            />
                            <span class="text-muted-foreground">
                              Exclude ambiguous characters
                              <span class="ml-1 font-mono opacity-60">(0/O, 1/l/I…)</span>
                            </span>
                          </label>
                          <p class="text-[11px] text-muted-foreground">
                            A fresh password is generated for every run. If it needs to be captured,
                            wire the step's <span class="font-mono">temporaryPassword</span>
                            output downstream.
                          </p>
                        </div>
                      {:else}
                        <div
                          class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                        >
                          {gen.description}
                        </div>
                      {/if}
                    {:else if binding?.kind === 'siteFact'}
                      {@const factOpts = factFieldsFor(meta.typeHint).map((f) => ({
                        value: f.key,
                        label: f.label,
                        subLabel: `${f.type}${f.valueMode === 'multiple' ? '[]' : ''} · ${f.section}`,
                      }))}
                      <div class="space-y-3">
                        {#if factOpts.length === 0}
                          <div
                            class="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500"
                          >
                            No declared site profile fields match this input's type. Add one under
                            Sites → Profile fields, then come back.
                          </div>
                        {:else}
                          <SingleSelect
                            options={factOpts}
                            selected={binding.key}
                            placeholder="Pick a site fact…"
                            onchange={(v) =>
                              setBinding(selectedIndex, inputName, { ...binding, key: v })}
                          />
                        {/if}
                        <label class="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={binding.required}
                            onCheckedChange={(c) =>
                              setBinding(selectedIndex, inputName, {
                                ...binding,
                                required: Boolean(c),
                              })}
                          />
                          <span class="text-muted-foreground">
                            Required
                            <span class="ml-1 opacity-60">
                              (fail the step if the site has no value)
                            </span>
                          </span>
                        </label>
                      </div>
                    {:else if binding?.kind === 'priorOutput'}
                      {@const upstreamSteps = draft.steps.slice(0, selectedIndex)}
                      {@const upstreamCap = capIndex.get(
                        upstreamSteps[binding.stepPosition]?.capabilityId ?? ''
                      )}
                      {@const stepOpts = upstreamSteps.map((s, i) => ({
                        value: String(i),
                        label: `Step ${String(i + 1).padStart(2, '0')}: ${s.label ?? capIndex.get(s.capabilityId)?.name ?? s.capabilityId}`,
                      }))}
                      {@const compatTypes = (meta as { priorOutputCompat?: string[] }).priorOutputCompat}
                      {@const outputOpts = upstreamCap
                        ? Object.entries(upstreamCap.outputMeta)
                            .filter(([, m]) => {
                              if (!compatTypes || compatTypes.length === 0) return true;
                              const t = (m as { outputType?: string }).outputType;
                              return t ? compatTypes.includes(t) : false;
                            })
                            .map(([k, m]) => ({
                              value: k,
                              label: fieldLabel(k, (m as { label?: string }).label),
                            }))
                        : []}
                      {#if upstreamSteps.length === 0}
                        <div
                          class="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500"
                        >
                          No earlier steps to wire from. Add one before this step or pick a
                          different source.
                        </div>
                      {:else}
                        <div class="grid gap-2 sm:grid-cols-2">
                          <SingleSelect
                            options={stepOpts}
                            selected={String(binding.stepPosition)}
                            placeholder="Prior step…"
                            disableSort
                            onchange={(v: string) =>
                              setBinding(selectedIndex, inputName, {
                                ...binding,
                                stepPosition: Number(v),
                                path: '',
                              })}
                          />
                          <SingleSelect
                            options={outputOpts}
                            selected={binding.path}
                            placeholder="Output field…"
                            onchange={(v: string) =>
                              setBinding(selectedIndex, inputName, { ...binding, path: v })}
                          />
                        </div>
                        {#if upstreamCap && outputOpts.length === 0}
                          <div
                            class="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500"
                          >
                            The selected step has no compatible outputs for this input. Try a
                            different step.
                          </div>
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
                    onchange={(v: string) => v && addOptionalInput(selectedIndex, v)}
                  />
                </div>
                <span class="whitespace-nowrap text-xs text-muted-foreground">
                  {availableOptional.length} more
                </span>
              </div>
            </div>
          {/if}

          <!-- Optional step toggle -->
          {#if readers.size > 0}
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
                    onCheckedChange={(c) => setStepOptional(selectedIndex, Boolean(c))}
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
          {:else}
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
                    onCheckedChange={(c) => setStepOptional(selectedIndex, Boolean(c))}
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
                                  onclick={() => (selectedIndex = u.toStep)}
                                  class="inline-flex items-center gap-1.5 self-start rounded-sm bg-cyan-500/10 px-2 py-0.5 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-400"
                                >
                                  <CornerDownRight class="size-3" />
                                  Step {String(u.toStep + 1).padStart(2, '0')} · {fieldLabel(
                                    u.toInput,
                                    capIndex.get(draft.steps[u.toStep]!.capabilityId)?.inputMeta[
                                      u.toInput
                                    ]?.label
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
      {:else}
        <div class="p-6 text-sm text-rose-500">Unknown capability.</div>
      {/if}
    </section>
  </div>
</div>

<Dialog.Root bind:open={capabilityPickerOpen}>
  <Dialog.Content
    class="flex h-[min(88vh,820px)] w-[min(96vw,1320px)] max-w-[min(96vw,1320px)] flex-col overflow-hidden p-0 sm:max-w-[min(96vw,1320px)]"
  >
    <Dialog.Header class="border-b bg-muted/20 px-6 py-5">
      <Dialog.Title class="text-xl font-semibold tracking-tight">
        {capabilityPickerTarget === 'main'
          ? 'Add capability'
          : capabilityPickerTarget === 'onSuccess'
            ? 'Add success reaction'
            : 'Add failure reaction'}
      </Dialog.Title>
      <Dialog.Description>
        {capabilityPickerTarget === 'main'
          ? 'Search the catalog, narrow the list, then insert the next step.'
          : 'Choose the next one-way reaction for this terminal lane.'}
      </Dialog.Description>
    </Dialog.Header>

    <div class="border-b bg-background px-6 py-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="relative max-w-2xl flex-1">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={capabilitySearch}
            oninput={(e) => (capabilitySearch = (e.target as HTMLInputElement).value)}
            placeholder="Search capability, vendor, category, or id"
            class="h-11 rounded-lg border-border/70 pl-9 text-sm"
          />
        </div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span class="rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono">
            {filteredCapabilities.length} shown
          </span>
          <span class="rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono">
            {capabilityCatalog.length} total
          </span>
        </div>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 lg:grid-cols-[280px_1fr]">
      <aside class="flex min-h-0 flex-col border-r bg-muted/[0.18]">
        <div class="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div
              class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Filters
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              {vendorFilters.length + categoryFilters.length} active
            </div>
          </div>
          <button
            type="button"
            class="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onclick={clearCapabilityFilters}
            disabled={!capabilitySearch &&
              vendorFilters.length === 0 &&
              categoryFilters.length === 0}
          >
            Clear
          </button>
        </div>

        <ScrollArea.Root class="min-h-0 flex-1">
          <div class="space-y-6 p-5">
            <div class="space-y-3">
              <div
                class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Vendors
              </div>
              <div class="flex flex-wrap gap-2">
                {#each capabilityVendors as vendor}
                  <button
                    type="button"
                    class="rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.08em] transition-colors {vendorFilters.includes(
                      vendor
                    )
                      ? 'border-primary/40 bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground/80 hover:border-foreground/20 hover:bg-background'}"
                    onclick={() => (vendorFilters = toggleFilter(vendorFilters, vendor))}
                  >
                    {formatVendorLabel(vendor)}
                  </button>
                {/each}
              </div>
            </div>

            <div class="space-y-3">
              <div
                class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Categories
              </div>
              <div class="flex flex-wrap gap-2">
                {#each capabilityCategories as category}
                  <button
                    type="button"
                    class="rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors {categoryFilters.includes(
                      category
                    )
                      ? 'border-primary/20 bg-primary/12 text-primary'
                      : 'border-border bg-background text-foreground/80 hover:border-foreground/20 hover:bg-background'}"
                    onclick={() => (categoryFilters = toggleFilter(categoryFilters, category))}
                  >
                    {formatCategoryLabel(category)}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </ScrollArea.Root>
      </aside>

      <div class="flex min-h-0 flex-col">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/[0.08] px-6 py-3"
        >
          <div class="text-sm font-medium text-foreground">Capability results</div>
          {#if capabilitySearch || vendorFilters.length > 0 || categoryFilters.length > 0}
            <div class="flex flex-wrap items-center gap-2">
              {#each vendorFilters as vendor}
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-primary"
                >
                  {formatVendorLabel(vendor)}
                  <button
                    type="button"
                    class="text-primary/70 hover:text-primary"
                    onclick={() => (vendorFilters = vendorFilters.filter((v) => v !== vendor))}
                    aria-label={`Remove ${vendor} vendor filter`}
                  >
                    <X class="size-3" />
                  </button>
                </span>
              {/each}
              {#each categoryFilters as category}
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] text-primary"
                >
                  {formatCategoryLabel(category)}
                  <button
                    type="button"
                    class="text-primary/70 hover:text-primary"
                    onclick={() =>
                      (categoryFilters = categoryFilters.filter((c) => c !== category))}
                    aria-label={`Remove ${category} category filter`}
                  >
                    <X class="size-3" />
                  </button>
                </span>
              {/each}
            </div>
          {/if}
        </div>

        <ScrollArea.Root class="min-h-0 flex-1">
          <div class="p-4 md:p-5">
            {#if filteredCapabilities.length === 0}
              <div class="rounded-xl border border-dashed p-10 text-center">
                <p class="text-sm font-medium">No matching capabilities</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  Adjust the search or clear some filters to see more results.
                </p>
              </div>
            {:else}
              <div class="grid gap-3 xl:grid-cols-2">
                {#each filteredCapabilities as capability (capability.id)}
                  <button
                    type="button"
                    class="w-full rounded-xl border border-border/80 bg-background p-4 text-left transition-colors hover:border-primary/30 hover:bg-muted/20"
                    onclick={() => addStep(capability.id)}
                  >
                    <div class="flex h-full items-start justify-between gap-4">
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-sm font-semibold text-foreground">
                            {capability.name}
                          </span>
                          <span
                            class="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-background"
                          >
                            {formatVendorLabel(capability.vendor)}
                          </span>
                          <span
                            class="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
                          >
                            {formatCategoryLabel(capability.category)}
                          </span>
                        </div>
                        {#if capability.description}
                          <p class="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                            {capability.description}
                          </p>
                        {/if}
                        <div class="mt-3 font-mono text-[11px] text-muted-foreground/80">
                          {capability.id}
                        </div>
                      </div>
                      <span
                        class="shrink-0 rounded-full border border-primary/20 bg-primary/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary"
                      >
                        Add
                      </span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </ScrollArea.Root>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root
  open={!!reactionEditor}
  onOpenChange={(open) => {
    if (!open) reactionEditor = null;
  }}
>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
    {#if reactionEditor && reactionStep()}
      {@const reaction = reactionStep()!}
      {@const reactionCap = capIndex.get(reaction.capabilityId)}
      {#if reactionCap}
        {@const availableOptionalInputs = Object.entries(reactionCap.inputMeta)
          .filter(([name, meta]) => meta.required === false && !(name in reaction.inputBindings))
          .map(([name, meta]) => ({ value: name, label: fieldLabel(name, meta.label) }))}
        <Dialog.Header>
          <Dialog.Title>Configure {reactionCap.name}</Dialog.Title>
          <Dialog.Description>
            This reaction runs only {reactionEditor.lane === 'onSuccess' ? 'after a successful package' : 'after a halted or partial package'}.
          </Dialog.Description>
        </Dialog.Header>
        <div class="space-y-4 py-3">
          {#each Object.keys(reaction.inputBindings).sort((a, b) => {
            const aGroup = inputGroupFor(reactionCap, a);
            const bGroup = inputGroupFor(reactionCap, b);
            return aGroup.order - bGroup.order || aGroup.inputOrder - bGroup.inputOrder;
          }) as inputName (inputName)}
            {@const meta = reactionCap.inputMeta[inputName]}
            {@const binding = reaction.inputBindings[inputName]}
            {#if meta && binding}
              {@const source = sourceOf(binding)}
              {@const reactionSources = allowedSourcesFor(meta, reactionEditor?.lane === 'onFailure').filter(
                (candidate) => candidate !== 'wire' || reactionWireSteps().length > 0,
              )}
              <section class="rounded-lg border bg-card">
                <div class="flex items-start justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="text-sm font-medium">{fieldLabel(inputName, meta.label)}</h3>
                      <span class="rounded-sm border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {inputTypeLabel(meta)}
                      </span>
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
                      aria-label={`Remove ${fieldLabel(inputName, meta.label)}`}
                    >
                      <Trash2 class="size-3.5" />
                    </button>
                  {/if}
                </div>
                <div class="space-y-3 p-4">
                  <SingleSelect
                    options={reactionSources.map((value) => ({ value, label: sourceLabel(value) }))}
                    selected={source}
                    disableSort
                    onchange={(value) => changeReactionSource(inputName, value as Source)}
                  />

                  {#if binding.kind === 'literal'}
                    {#if meta.entityType}
                      <EntityPicker
                        entityType={meta.entityType as EntityType}
                        multiple={meta.typeHint === 'stringArray'}
                        value={binding.value as string | string[] | null}
                        onValueChange={(value) => setReactionBinding(inputName, { kind: 'literal', value })}
                      />
                    {:else if meta.typeHint === 'boolean'}
                      <label class="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={Boolean(binding.value)}
                          onCheckedChange={(checked) => setReactionBinding(inputName, { kind: 'literal', value: Boolean(checked) })}
                        />
                        <span>{binding.value ? 'Yes' : 'No'}</span>
                      </label>
                    {:else if meta.choices && meta.choices.length > 0}
                      <SingleSelect
                        options={meta.choices as { value: string; label: string }[]}
                        selected={typeof binding.value === 'string' ? binding.value : ''}
                        onchange={(value) => setReactionBinding(inputName, { kind: 'literal', value })}
                      />
                    {:else if meta.typeHint === 'stringArray'}
                      <Input
                        placeholder="Comma-separated values"
                        value={Array.isArray(binding.value) ? binding.value.join(', ') : ''}
                        oninput={(event) => setReactionBinding(inputName, {
                          kind: 'literal',
                          value: (event.target as HTMLInputElement).value.split(',').map((value) => value.trim()).filter(Boolean),
                        })}
                      />
                    {:else}
                      <Input
                        type={meta.sensitive ? 'password' : 'text'}
                        value={typeof binding.value === 'string' || typeof binding.value === 'number' ? String(binding.value) : ''}
                        oninput={(event) => setReactionBinding(inputName, { kind: 'literal', value: (event.target as HTMLInputElement).value })}
                      />
                    {/if}
                  {:else if binding.kind === 'runtime'}
                    <div class="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      The operator will answer this before the package starts. Edit its wording and required state in Run experience.
                    </div>
                  {:else if binding.kind === 'siteFact'}
                    <SingleSelect
                      options={factFieldsFor(meta.typeHint).map((field) => ({ value: field.key, label: field.label, subLabel: field.section }))}
                      selected={binding.key}
                      placeholder="Choose a site profile field…"
                      onchange={(key) => setReactionBinding(inputName, { ...binding, key })}
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
                      onchange={(path) => setReactionBinding(inputName, { ...binding, path: path as typeof binding.path })}
                    />
                  {:else if binding.kind === 'generated'}
                    <p class="text-xs text-muted-foreground">{sourceHint('generated', meta)}</p>
                  {:else if binding.kind === 'priorOutput'}
                    {@const wireSteps = reactionWireSteps()}
                    {@const sourceLane = binding.lane ?? 'main'}
                    {@const selectedWireStep = `${sourceLane}:${binding.stepPosition}`}
                    {@const outputOptions = reactionWireOutputs(binding, meta)}
                    {#if wireSteps.length === 0}
                      <div class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                        Add a main step or an earlier reaction before wiring this input.
                      </div>
                    {:else}
                      <div class="grid gap-2 sm:grid-cols-2">
                        <SingleSelect
                          options={wireSteps.map(({ value, label }) => ({ value, label }))}
                          selected={selectedWireStep}
                          placeholder="Source step…"
                          disableSort
                          onchange={(value) => {
                            const source = wireSteps.find((candidate) => candidate.value === value);
                            if (!source) return;
                            setReactionBinding(inputName, {
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
                          onchange={(path) => setReactionBinding(inputName, { ...binding, path })}
                        />
                      </div>
                      {#if outputOptions.length === 0}
                        <p class="text-xs text-amber-700 dark:text-amber-400">
                          The selected step has no compatible outputs for this input.
                        </p>
                      {/if}
                    {/if}
                  {:else}
                    <p class="text-xs text-muted-foreground">This source will be supplied by the run context.</p>
                  {/if}
                </div>
              </section>
            {/if}
          {/each}
          {#if availableOptionalInputs.length > 0}
            <SingleSelect
              options={availableOptionalInputs}
              selected=""
              placeholder="Add an optional input…"
              onchange={(inputName) => inputName && addOptionalReactionInput(inputName)}
            />
          {/if}
        </div>
        <Dialog.Footer>
          <Button onclick={() => (reactionEditor = null)}>Done</Button>
        </Dialog.Footer>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
