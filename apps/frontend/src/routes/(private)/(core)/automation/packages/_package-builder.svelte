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

  export type CapabilityStep = {
    kind: 'capability';
    capabilityId: string;
    label?: string;
    optional?: boolean;
    inputBindings: Record<string, Binding>;
  };

  export type SubpackageStep = {
    kind: 'subpackage';
    // Reference to a saved active package by id. Its prompts become this
    // step's configurable inputs; its exposedOutputs are wire-source options
    // for downstream steps in the parent package.
    packageId: string;
    // Synthetic display id (`subpackage:<packageId>`) — carried in the UI
    // shape so existing rendering paths that key on `step.capabilityId` keep
    // working. Stripped at save time by the backend Zod schema.
    capabilityId: string;
    label?: string;
    optional?: boolean;
    inputBindings: Record<string, Binding>;
  };

  export type Step = CapabilityStep | SubpackageStep;

  export function subpackageCapabilityId(packageId: string): string {
    return `subpackage:${packageId}`;
  }

  export type PackagePrompt = {
    id: string;
    label: string;
    description?: string;
    required: boolean;
    section?: string;
    order: number;
  };

  export type ExposedOutput = {
    name: string;
    sourceStepPosition: number;
    sourcePath: string;
    outputType?: string;
    description?: string;
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
    exposedOutputs: ExposedOutput[];
    // Empty arrays => global. Non-empty restricts which sites, groups, or
    // tenant links this package can run against.
    allowedSites: string[];
    allowedSiteGroups: string[];
    allowedIntegrationLinks: string[];
  };

  // Helpers usable by nested editor components.
  export function isSubpackageStep(step: Step): step is SubpackageStep {
    return step.kind === 'subpackage';
  }
  export function isCapabilityStep(step: Step): step is CapabilityStep {
    return step.kind !== 'subpackage';
  }
  export function stepDisplayLabel(
    step: Step,
    lookups: {
      capName?: string | undefined;
      subpackageName?: string | undefined;
    },
  ): string {
    if (step.label) return step.label;
    if (step.kind === 'subpackage') return lookups.subpackageName ?? 'Sub-package';
    return lookups.capName ?? step.capabilityId;
  }
</script>

<script lang="ts">
  import './workspace.css';
  import RunPackageDialog from '$lib/components/domain/run-package-dialog.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { getContext, tick } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
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
  import SubpackagePicker from './_subpackage-picker.svelte';
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
  import { STALE } from '$lib/query';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import {
    Play,
    Layers,
    Workflow,
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
    // Present when editing an existing package. Used to exclude self from the
    // sub-package picker (a package cannot reference itself).
    currentPackageId?: string;
    saving: boolean;
    onSave: (draft: PackageDraft) => void;
  };

  let { initial, currentPackageId, saving, onSave }: Props = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const canWrite = $derived(authStore.isAllowed('Packages.Write'));
  const canRun = $derived(authStore.isAllowed('Packages.Run'));
  let runDialogOpen = $state(false);

  const capabilitiesQuery = createQuery(() => ({
    queryKey: ['packages.metadata.capabilities'],
    queryFn: () => trpc.packages.capabilities.query(),
    // Keep output/input contracts fresh after edits in Dev Capabilities.
    staleTime: 0,
    refetchOnMount: 'always',
  }));

  // Available packages that can be referenced as sub-packages. The list mutation
  // and the sub-package step editor both consume this; the query stays live so
  // renames / prompts changes surface without a page reload.
  const subpackagesQuery = createQuery(() => ({
    queryKey: ['packages.list.forSubpackageRef'],
    queryFn: () => trpc.packages.list.query({}),
    staleTime: STALE.LIST,
  }));
  const subpackageIndex = $derived(
    new Map((subpackagesQuery.data ?? []).map((p) => [p.id, p]))
  );

  // `packages.list` returns steps + prompts but not exposedOutputs. Every
  // referenced sub-package gets fetched lazily via `packages.get` so downstream
  // priorOutput pickers know what child outputs exist. Cached in a $state map;
  // an $effect drives fetches for any newly-referenced child.
  let subpackageDetails = $state(new Map<string, { exposedOutputs: ExposedOutput[]; prompts: PackagePrompt[] }>());
  $effect(() => {
    const ids = new Set<string>();
    const collect = (steps: Step[]) => {
      for (const s of steps) if (s.kind === 'subpackage') ids.add(s.packageId);
    };
    collect(draft.steps);
    collect(draft.outcomeSteps.onSuccess);
    collect(draft.outcomeSteps.onFailure);
    for (const id of ids) {
      if (subpackageDetails.has(id)) continue;
      trpc.packages.get
        .query({ id })
        .then((pkg) => {
          const next = new Map(subpackageDetails);
          next.set(id, {
            exposedOutputs: ((pkg as { exposedOutputs?: unknown }).exposedOutputs as ExposedOutput[]) ?? [],
            prompts: (pkg.prompts as PackagePrompt[]) ?? [],
          });
          subpackageDetails = next;
        })
        .catch(() => {
          // Silently ignore — the child may have been archived. The editor
          // will surface the missing-child state; save will fail-safe.
        });
    }
  });
  function subpackageExposedOutputsFor(packageId: string): ExposedOutput[] {
    return subpackageDetails.get(packageId)?.exposedOutputs ?? [];
  }

  const generatorsQuery = createQuery(() => ({
    queryKey: ['packages.metadata.generators'],
    queryFn: () => trpc.packages.generators.query(),
    staleTime: STALE.REF,
  }));

  const siteFactFieldsQuery = createQuery(() => ({
    queryKey: ['packages.metadata.siteFactFields'],
    queryFn: () => trpc.packages.siteFactFields.query(),
    staleTime: STALE.REF,
  }));

  // Match a site fact to the capability's resolved platform type. Resource
  // types are intentionally exact: a generic text list cannot masquerade as
  // a Microsoft 365 license list at package execution time.
  function factFieldsFor(meta: { typeHint?: string; fieldType?: string; entityType?: string }) {
    const all = siteFactFieldsQuery.data ?? [];
    const expectedType = meta.fieldType;
    if (expectedType?.startsWith('m365_') || expectedType === 'sophos_endpoint') {
      return all.filter((field) => field.fieldType === expectedType);
    }
    const typeHint = meta.typeHint;
    if (!typeHint) return all;
    return all.filter((f) => {
      if (typeHint === 'boolean') return f.type === 'boolean' && f.valueMode === 'single';
      if (typeHint === 'number') return f.type === 'number' && f.valueMode === 'single';
      if (typeHint === 'stringArray') return f.type === 'string' && f.valueMode === 'multiple';
      // Semantic types: match by resolved fieldType so only correctly-typed facts appear.
      if (typeHint === 'timezone') return f.fieldType === 'timezone';
      if (typeHint === 'postalCode') return f.fieldType === 'postal_code';
      if (typeHint === 'city') return f.fieldType === 'city';
      if (typeHint === 'countryCode') return f.fieldType === 'country_code';
      if (typeHint === 'state') return f.fieldType === 'region';
      // text / password / generic: any single-value string field.
      return f.type === 'string' && f.valueMode === 'single';
    });
  }

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list.scopePicker'],
    queryFn: () => trpc.sites.list.query(),
    staleTime: STALE.PAGE,
  }));

  const siteGroupsQuery = createQuery(() => ({
    queryKey: ['siteGroups.list.scopePicker'],
    queryFn: () => trpc.siteGroups.list.query(),
    staleTime: STALE.PAGE,
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
    staleTime: STALE.PAGE,
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
    exposedOutputs: structuredClone(initial.exposedOutputs ?? []),
    allowedSites: [...(initial.allowedSites ?? [])],
    allowedSiteGroups: [...(initial.allowedSiteGroups ?? [])],
    allowedIntegrationLinks: [...(initial.allowedIntegrationLinks ?? [])],
  });

  // The inspector selection can target package details, a main step, or a terminal reaction.
  let selected = $state<Selection>(initial.steps.length ? { kind: 'step', index: 0 } : { kind: 'details' });
  let showRunPreview = $state(false);
  let showSetupIssues = $state(false);
  let inspectorElement: HTMLElement;
  let previewAnswers = $state<Record<string, string | boolean | string[]>>({});
  const hasChanges = $derived(JSON.stringify(draft) !== JSON.stringify(initial));
  beforeNavigate(({ cancel }) => {
    if (hasChanges && !saving && !window.confirm('Leave this package? Your unsaved changes will be lost.')) cancel();
  });
  let capabilityPickerOpen = $state(false);
  let capabilityPickerTarget = $state<'main' | 'onSuccess' | 'onFailure'>('main');
  let subpackagePickerOpen = $state(false);
  let activeTemplateRef = $state<HTMLTextAreaElement | null>(null);

  // Real capability registry plus a synthetic entry per referenced sub-package
  // so the existing rendering paths (which look up `capIndex.get(step.capabilityId)`
  // for a `name`, `outputMeta`, etc.) work uniformly for both kinds. Sub-package
  // synthetic entries project child prompts as inputMeta and — where the list
  // endpoint hasn't returned exposedOutputs — leave outputMeta empty (the
  // dedicated sub-package inspector renders the wire choices directly).
  const capIndex = $derived.by(() => {
    // `any` here because the map mixes the tRPC-inferred capability shape with
    // hand-rolled sub-package placeholders; every consumer only reads a subset
    // (name, description, category, inputMeta, outputMeta).
    const map = new Map<string, any>();
    for (const cap of capabilitiesQuery.data ?? []) {
      map.set(cap.id, cap);
    }
    const referencedPackageIds = new Set<string>();
    const collectRefs = (steps: Step[]) => {
      for (const step of steps) {
        if (step.kind === 'subpackage') referencedPackageIds.add(step.packageId);
      }
    };
    collectRefs(draft.steps);
    collectRefs(draft.outcomeSteps.onSuccess);
    collectRefs(draft.outcomeSteps.onFailure);
    for (const pid of referencedPackageIds) {
      const pkg = subpackageIndex.get(pid);
      if (!pkg) continue;
      const inputMeta: Record<string, {
        allowedBindings: readonly string[];
        required?: boolean;
        label?: string;
        description?: string;
      }> = {};
      for (const prompt of (pkg.prompts as PackagePrompt[]) ?? []) {
        inputMeta[prompt.id] = {
          allowedBindings: ['literal', 'runtime', 'priorOutput', 'generated', 'siteFact'],
          required: prompt.required,
          label: prompt.label,
          description: prompt.description,
        };
      }
      map.set(subpackageCapabilityId(pid), {
        id: subpackageCapabilityId(pid),
        vendor: 'sub-package',
        name: pkg.name,
        description: pkg.description ?? undefined,
        category: 'sub-package',
        inputMeta,
        outputMeta: {},
      });
    }
    return map;
  });

  type FanoutContract =
    | { mode: 'per_target'; targetInput: string }
    | { mode: 'inherited' }
    | { mode: 'single_run' };

  function fanoutFor(capability: unknown): FanoutContract | undefined {
    const fanout = (capability as { fanout?: FanoutContract } | undefined)?.fanout;
    return fanout;
  }

  function entityTypeLabel(entityType: string): string {
    return entityType.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  type StepExecutionRole =
    | { kind: 'target'; entityType: string; inferred: boolean }
    | { kind: 'context'; inferred: boolean }
    | { kind: 'single_run' }
    | { kind: 'unknown' };

  function stepExecutionRole(step: Step, capability: any): StepExecutionRole {
    if (step.kind !== 'capability') return { kind: 'single_run' };
    const fanout = fanoutFor(capability);
    if (fanout?.mode === 'single_run') return { kind: 'single_run' };
    if (fanout?.mode === 'inherited') return { kind: 'context', inferred: false };
    const entityInputs = Object.entries(capability?.inputMeta ?? {})
      .map(([inputName, meta]) => ({
        inputName,
        entityType: (meta as { entityType?: string }).entityType,
        binding: step.inputBindings[inputName] as Binding | undefined,
      }))
      .filter((input): input is { inputName: string; entityType: string; binding: Binding | undefined } => Boolean(input.entityType));

    if (fanout?.mode === 'per_target') {
      const target = entityInputs.find((input) => input.inputName === fanout.targetInput);
      if (!target) return { kind: 'unknown' };
      return target.binding?.kind === 'priorOutput'
        ? { kind: 'context', inferred: false }
        : { kind: 'target', entityType: target.entityType, inferred: false };
    }

    // Existing packages were built before execution scope was declared. A
    // single directly selected entity is unambiguous; a prior-output entity
    // follows its upstream target and does not introduce a collection axis.
    const directTargets = entityInputs.filter((input) =>
      input.binding?.kind === 'runtime' || input.binding?.kind === 'entity');
    if (directTargets.length === 1) {
      return { kind: 'target', entityType: directTargets[0]!.entityType, inferred: true };
    }
    if (entityInputs.some((input) => input.binding?.kind === 'priorOutput')) {
      return { kind: 'context', inferred: true };
    }
    return { kind: 'unknown' };
  }

  function targetRoleLabel(step: Step, capability: any): string {
    const role = stepExecutionRole(step, capability);
    return role.kind === 'target'
      ? `${entityTypeLabel(role.entityType)}${role.inferred ? ' · inferred' : ''}`
      : '';
  }

  function contextRoleLabel(step: Step, capability: any): string {
    const role = stepExecutionRole(step, capability);
    return role.kind === 'context' && role.inferred ? ' · wired' : '';
  }

  const packageExecutionScope = $derived.by(() => {
    const targets: string[] = [];
    for (const step of draft.steps) {
      if (step.kind !== 'capability') return {
        batchReady: false,
        title: 'Single run · sub-package included',
        reason: 'Sub-packages do not declare a table target, so this package runs once.',
      };
      const cap = capIndex.get(step.capabilityId);
      const role = stepExecutionRole(step, cap);
      if (role.kind === 'unknown') return {
        batchReady: false,
        title: 'Single run · scope missing',
        reason: `${cap?.name ?? step.capabilityId} has no unambiguous target. Set its execution scope in Capabilities.`,
      };
      if (role.kind === 'single_run') return {
        batchReady: false,
        title: 'Single run · step constraint',
        reason: `${cap.name} is designed to run once and prevents table batch execution.`,
      };
      if (role.kind === 'target') targets.push(role.entityType);
    }
    const entityTypes = [...new Set(targets)];
    if (entityTypes.length !== 1) {
      return entityTypes.length === 0
        ? {
            batchReady: false,
            title: 'Single run · no target',
            reason: 'Add a step that targets a resource before this package can run from a table selection.',
          }
        : {
            batchReady: false,
            title: 'Single run · conflicting targets',
            reason: `This package targets ${entityTypes.map(entityTypeLabel).join(' and ')}. Table selection would create independent target collections.`,
          };
    }
    const entityType = entityTypes[0]!;
    return {
      batchReady: true,
      entityType,
      title: `Batch-ready · ${entityTypeLabel(entityType)}`,
      reason: `One selected ${entityTypeLabel(entityType).toLowerCase()} set is used by every matching target step. Context steps run once per selected record.`,
    };
  });


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
    for (const [name, meta] of Object.entries(cap.inputMeta as Record<string, {
      allowedBindings: readonly string[];
      required?: boolean;
      entityType?: string;
      typeHint?: string;
      label?: string;
      description?: string;
    }>)) {
      if (!isRequiredInput(meta)) continue;
      inputBindings[name] = runtimeBindingForLane(defaultForInput(name, meta), name, meta, lane);
    }
    return { kind: 'capability', capabilityId: cap.id, label: cap.name, optional: false, inputBindings };
  }

  // Builds a sub-package step for a picked child package. Every required
  // prompt on the child becomes a runtime-bound input on this step by default;
  // the author flips sources on individual prompts in the sub-package inspector.
  function buildSubpackageStep(packageId: string, lane: 'main' | 'onSuccess' | 'onFailure' = 'main'): SubpackageStep | null {
    if (!packageId) return null;
    const pkg = subpackageIndex.get(packageId);
    if (!pkg) return null;
    const prompts = (pkg.prompts as PackagePrompt[]) ?? [];
    const inputBindings: Record<string, Binding> = {};
    for (const prompt of prompts) {
      if (!prompt.required) continue;
      const meta = { allowedBindings: ['literal', 'runtime', 'priorOutput'] as const, required: true, label: prompt.label, description: prompt.description };
      inputBindings[prompt.id] = runtimeBindingForLane(defaultForInput(prompt.id, meta), prompt.id, meta, lane);
    }
    return {
      kind: 'subpackage',
      packageId,
      capabilityId: subpackageCapabilityId(packageId),
      label: pkg.name,
      optional: false,
      inputBindings,
    };
  }

  function addSubpackageStep(packageId: string) {
    showRunPreview = false;
    const step = buildSubpackageStep(packageId, 'main');
    if (!step) return;
    const nextIndex = draft.steps.length;
    draft.steps = [...draft.steps, step];
    selected = { kind: 'step', index: nextIndex };
    subpackagePickerOpen = false;
  }

  function addStep(capabilityId: string) {
    showRunPreview = false;
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
    if (!source) return [];
    // Sub-package sources publish their exposedOutputs; capability outputMeta
    // is empty in the synthetic index entry.
    if (source.step.kind === 'subpackage') {
      return subpackageExposedOutputsFor(source.step.packageId).map((eo) => ({
        value: eo.name,
        label: eo.name,
      }));
    }
    const cap = capIndex.get(source.step.capabilityId);
    if (!cap) return [];
    return Object.entries(cap.outputMeta as Record<string, { outputType?: string; label?: string }>)
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

  type SetupIssue = { message: string; target: Selection; blocksSave?: boolean };
  const setupIssues = $derived.by(() => {
    const issues: SetupIssue[] = [];
    const details = (message: string) =>
      issues.push({ message, target: { kind: 'details' } });
    if (!draft.name.trim()) details('Give this package a name your team will recognize.');
    if (!draft.steps.length) details('Add the first action to your workflow.');
    if (draft.prompts.some((p) => !p.id.trim() || !p.label.trim())) details('Give each run question a label.');
    for (const lane of ['main', 'onSuccess', 'onFailure'] as const) {
      const steps = lane === 'main' ? draft.steps : draft.outcomeSteps[lane];
      steps.forEach((step, index) => {
        const cap = capIndex.get(step.capabilityId);
        const target: Selection = lane === 'main' ? { kind: 'step', index } : { kind: 'reaction', lane, index };
        const title = step.label || cap?.name || `Step ${index + 1}`;
        const add = (message: string, blocksSave = true) => issues.push({ message: `${title}: ${message}`, target, blocksSave });
        if (step.kind === 'subpackage' ? !step.packageId : !cap) {
          add('choose an available action or remove this step.');
          return;
        }
        for (const [name, binding] of Object.entries(step.inputBindings)) {
          const meta = cap?.inputMeta[name];
          const label = fieldLabel(name, meta?.label);
          if (binding.kind === 'literal' && meta && isRequiredInput(meta) &&
              (binding.value == null || (typeof binding.value === 'string' && !binding.value.trim()) ||
               (Array.isArray(binding.value) && binding.value.length === 0))) {
            add(`enter a value for ${label} before running, or choose “Ask when run” if available.`, false);
          }
          if (binding.kind === 'runtime' && !binding.promptKey.trim()) add(`set up the question for ${label}.`);
          if (binding.kind === 'priorOutput' && !binding.path.trim()) add(`choose an earlier result for ${label}.`);
          if (binding.kind === 'failureContext' && !binding.path.trim()) add(`choose failure details for ${label}.`);
          if (binding.kind === 'literal' && step.kind !== 'subpackage' && !cap?.inputMeta[name]) add(`remove the unavailable field ${label}.`);
          if (binding.kind === 'generated' && !binding.generator.trim()) add(`choose how to generate ${label}.`);
          if (binding.kind === 'siteFact' && !binding.key.trim()) add(`choose a site profile field for ${label}.`);
          if (binding.kind === 'template' && !binding.template.trim()) add(`write the message for ${label}.`);
        }
      });
    }
    return issues;
  });
  function canSave(): boolean { return !setupIssues.some((issue) => issue.blocksSave !== false); }
  function fixIssue(issue: SetupIssue) {
    selected = issue.target;
  }
  const clientSummary = $derived(
    [...draft.allowedSites.map((id) => siteOptions.find((o) => o.value === id)?.label ?? 'Unavailable site'),
     ...draft.allowedSiteGroups.map((id) => siteGroupOptions.find((o) => o.value === id)?.label ?? 'Unavailable group'),
     ...draft.allowedIntegrationLinks.map((id) => tenantLinkOptions.find((o) => o.value === id)?.label ?? 'Unavailable connection')]
  );

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

  function bindingSummary(binding: Binding, meta: { sensitive?: boolean; entityType?: string } | undefined): string {
    if (binding.kind === 'runtime') return `Ask: ${draft.prompts.find((p) => p.id === binding.promptKey)?.label || 'your team'}`;
    if (binding.kind === 'siteFact') return siteFactFieldsQuery.data?.find((f) => f.key === binding.key)?.label || 'Choose a site field';
    if (binding.kind === 'priorOutput') {
      const sourceSteps = binding.lane && binding.lane !== 'main' ? draft.outcomeSteps[binding.lane] : draft.steps;
      const source = sourceSteps[binding.stepPosition];
      return source ? `From ${source.label || capIndex.get(source.capabilityId)?.name || 'an earlier action'}` : 'Choose an earlier result';
    }
    if (binding.kind === 'literal') {
      if (meta?.sensitive) return binding.value ? 'Hidden value' : 'Not set';
      if (meta?.entityType) return binding.value ? 'Selected item' : 'Not selected';
      if (typeof binding.value === 'boolean') return binding.value ? 'Yes' : 'No';
      if (typeof binding.value === 'number') return String(binding.value);
      if (Array.isArray(binding.value)) return `${binding.value.length} selected`;
      return typeof binding.value === 'string' && binding.value.trim() ? binding.value : 'Not set';
    }
    if (binding.kind === 'generated') return 'Created automatically';
    if (binding.kind === 'template') return 'Personalized message';
    if (binding.kind === 'failureContext') return 'Details of the failure';
    return binding.source === 'picker' ? 'Choose when running' : 'Selected item';
  }
  function selectAction(selection: Selection) {
    selected = selection;
    showRunPreview = false;
    void tick().then(() => {
      if ((inspectorElement?.closest('.pk-builder')?.clientWidth ?? 1000) <= 760) inspectorElement.scrollIntoView({ block: 'start' });
    });
  }
  function previewMeta(promptId: string): { typeHint?: string; sensitive?: boolean; entityType?: string; choices?: { value: string; label: string }[] } {
    for (const step of [...draft.steps, ...draft.outcomeSteps.onSuccess]) {
      const input = Object.entries(step.inputBindings).find(([, binding]) => binding.kind === 'runtime' && binding.promptKey === promptId);
      if (input) return capIndex.get(step.capabilityId)?.inputMeta[input[0]] ?? {};
    }
    return {};
  }
</script>

<div class="pk-workspace pk-builder pk-studio">
  <!-- Header bar -->
  <header class="pk-builder-header">
    <div class="flex flex-wrap items-center gap-3 px-6 py-4">
      <button
        type="button"
        class="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => goto('/automation/packages')}
      >
        <ArrowLeft class="size-3.5" />
        Packages
      </button>

      <div class="mx-2 h-5 w-px bg-border"></div>

      <Input
        aria-label="Package name"
        placeholder="Name your package"
        value={draft.name}
        oninput={(e) => (draft.name = (e.target as HTMLInputElement).value)}
        class="pk-title-input h-9 w-full max-w-sm text-base font-semibold"
      />

      {#if !canWrite}<span class="text-xs text-muted-foreground capitalize">{draft.status}</span>{/if}

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted-foreground" role="status">{saving ? 'Saving changes…' : hasChanges ? 'Unsaved changes' : currentPackageId ? 'All changes saved' : 'New package'}</span>
        {#if currentPackageId && initial.status === 'active' && canRun}<Button variant="outline" class="gap-1.5" disabled={saving} onclick={() => runDialogOpen = true} title="Runs the saved version. Unsaved edits are not included."><Play size={14} /> Run saved version</Button>{/if}
        {#if canWrite}
        <div class="w-36"><SingleSelect allowClear={false} aria-label="Package status" options={[{value:'draft',label:'Draft',subLabel:'Not available to run'},{value:'active',label:'Active',subLabel:'Available to run and schedule'},{value:'archived',label:'Archived',subLabel:'Retained for reference'}]} selected={draft.status} onchange={(value) => { if (value === 'draft' || value === 'active' || value === 'archived') draft.status = value; }} class="h-9" disableSort /></div>
        <Button
          onclick={() => onSave({ ...draft, prompts: publishedPrompts })}
          disabled={!canSave() || saving}
        >
          {saving ? 'Saving…' : currentPackageId ? 'Save changes' : 'Create package'}
        </Button>
        {:else}<span class="text-xs text-muted-foreground">View only</span>{/if}
      </div>
    </div>
    <div class="pk-builder-context">
      <span><Workflow size={15} /> Package builder</span>
      <p>{draft.status === 'active' ? 'Changes apply to future runs after you save.' : 'Build your workflow, then set it to Active when your team can use it.'}</p>
      <button type="button" onclick={() => showSetupIssues = !showSetupIssues} aria-expanded={showSetupIssues}>
        {#if setupIssues.length}<AlertTriangle size={14} /> {setupIssues.length} to finish{:else}<CheckCircle2 size={14} /> Review setup{/if}
      </button>
    </div>
    {#if showSetupIssues}
      <div class="pk-inline-checks">
        {#each setupIssues as issue}<button type="button" onclick={() => { fixIssue(issue); showRunPreview = false; }}><span>{issue.message}{#if issue.blocksSave === false}<small class="ml-2 text-muted-foreground">You can save and finish this later.</small>{/if}</span><ArrowUpRight size={14} /></button>{:else}<p>Connections, permissions, and input values are checked when starting a run.</p>{/each}
      </div>
    {/if}
  </header>

  <!-- Two-pane body -->
  <div class="pk-builder-body">
    <aside class="pk-plan" aria-label="Package workflow">
      <div class="pk-plan-intro">
        <p class="pk-eyebrow">THE WORKFLOW</p>
        <h2>Build the workflow</h2>
        <p>Actions run from top to bottom. Select one to edit its settings.</p>
      </div>
      <div class="pk-plan-setup">
        <button type="button" onclick={() => selectAction({ kind: 'details' })} aria-pressed={selected.kind === 'details' && !showRunPreview}>
          <SlidersHorizontal size={17} /><span><strong>Package settings</strong><small>{clientSummary.length ? clientSummary.join(', ') : 'Available to all clients'}</small></span><ChevronDown size={15} />
        </button>
        <button type="button" onclick={() => showRunPreview = !showRunPreview} aria-pressed={showRunPreview}>
          <Keyboard size={17} /><span><strong>What your team will see</strong><small>{normalPublishedPrompts.length} run {normalPublishedPrompts.length === 1 ? 'question' : 'questions'} · Preview as you build</small></span><ChevronDown size={15} />
        </button>
      </div>
      <ol class="pk-action-plan">
        {#each draft.steps as step, index}
          {@const cap = capIndex.get(step.capabilityId)}
          {@const issues = setupIssues.filter((issue) => issue.target.kind === 'step' && issue.target.index === index)}
          <li>
            <button type="button" class="pk-action-card" aria-pressed={!showRunPreview && selected.kind === 'step' && selected.index === index} onclick={() => selectAction({ kind: 'step', index })}>
              <span class="pk-action-number">{index + 1}</span>
              <span class="pk-action-content">
                <span class="pk-action-provider">{step.kind === 'subpackage' ? 'Saved package' : (cap?.vendor ?? 'Action').replace(/[-_]/g, ' ')}</span>
                <strong>{step.label || cap?.name || 'Unavailable action'}</strong>
                <span class="pk-action-description">{cap?.description || 'Configure this action to continue.'}</span>
                <span class="pk-action-values">
                  {#each Object.entries(step.inputBindings).slice(0, 3) as [name, binding]}
                    <span><span>{fieldLabel(name, cap?.inputMeta[name]?.label)}</span><b>{bindingSummary(binding, cap?.inputMeta[name])}</b></span>
                  {/each}
                  {#if Object.keys(step.inputBindings).length > 3}<small>+{Object.keys(step.inputBindings).length - 3} more fields</small>{/if}
                </span>
                <span class="pk-action-footer">{#if issues.length}<AlertTriangle size={12} /> {issues.length} to finish{:else if step.optional}Your team can skip this action{:else}Included in every run{/if}</span>
              </span>
            </button>
          </li>
        {:else}
          <li class="pk-plan-empty"><Layers size={28} /><h3>What should happen first?</h3><p>Choose a task from your connected tools, or start with a package you already use.</p></li>
        {/each}
      </ol>
      <div class="pk-plan-add"><Button class="w-full gap-2" variant="outline" onclick={() => openCapabilityPicker()}><Plus size={16} /> Add an action</Button><button type="button" onclick={() => subpackagePickerOpen = true}>Reuse an existing package</button></div>
      <div class="pk-plan-outcomes">
        <p class="pk-eyebrow">AFTER THE WORKFLOW</p>
        {#each [{ lane: 'onSuccess' as const, title: 'When everything succeeds', empty: 'Send a confirmation, update a ticket…' }, { lane: 'onFailure' as const, title: 'If something goes wrong', empty: 'Notify your team or create a ticket…' }] as outcome}
          <div class="pk-plan-outcome" class:pk-plan-failure={outcome.lane === 'onFailure'}>
            <h3>{outcome.title}</h3>
            {#each draft.outcomeSteps[outcome.lane] as step, index}
              <button type="button" class="pk-outcome-action" aria-pressed={!showRunPreview && selected.kind === 'reaction' && selected.lane === outcome.lane && selected.index === index} onclick={() => selectAction({ kind: 'reaction', lane: outcome.lane, index })}>{step.label || capIndex.get(step.capabilityId)?.name || 'Unavailable action'}<ArrowUpRight size={14} /></button>
            {:else}<p>{outcome.empty}</p>{/each}
            <button type="button" class="pk-add-followup" onclick={() => openCapabilityPicker(outcome.lane)}><Plus size={13} /> Add follow-up</button>
          </div>
        {/each}
      </div>
    </aside>

    <!-- Inspector -->
    <section bind:this={inspectorElement} class="pk-inspector flex min-h-0 flex-col overflow-y-auto" aria-label="Action editor">
      {#if capabilitiesQuery.isError}<div class="pk-load-error" role="alert"><TriangleAlert size={18} /><div><strong>Capabilities couldn’t be loaded</strong><p>Reload the catalog to inspect and configure your steps.</p></div><Button variant="outline" onclick={() => capabilitiesQuery.refetch()}>Retry</Button></div>{/if}
      {#if showRunPreview}
        <div class="pk-run-preview">
          <p class="pk-eyebrow">TECHNICIAN PREVIEW</p><h2>{draft.name || 'Your package'}</h2><p>{draft.description || 'Your team will see the package description here.'}</p>
          <div class="pk-preview-notice"><Info size={16} /><span>This is a preview. No actions will run.</span></div>
          <div class="pk-preview-client"><strong>Choose a client and target</strong><p>Available clients depend on package restrictions, connections, and your team’s permissions.</p></div>
          {#each normalPublishedPrompts as prompt}
            {@const meta = previewMeta(prompt.id)}
            <div class="pk-preview-question">
              <span>{prompt.section || 'Run details'}</span><strong>{prompt.label}<small>{prompt.required ? 'Required' : 'Optional'}</small></strong>
              {#if prompt.description}<p>{prompt.description}</p>{/if}
              <div class="mt-3">
                {#if meta.entityType}
                  <div class="pk-preview-placeholder">Choose from available {meta.entityType.replace(/_/g, ' ')} items after selecting a client.</div>
                {:else if meta.typeHint === 'boolean'}
                  <label class="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(previewAnswers[prompt.id])} onCheckedChange={(checked) => previewAnswers[prompt.id] = Boolean(checked)} />{prompt.label}</label>
                {:else if meta.choices?.length && meta.typeHint === 'stringArray'}
                  <MultiSelect options={meta.choices} selected={Array.isArray(previewAnswers[prompt.id]) ? previewAnswers[prompt.id] as string[] : []} onchange={(values) => previewAnswers[prompt.id] = values} placeholder="Choose one or more…" />
                {:else if meta.choices?.length}
                  <SingleSelect options={meta.choices} selected={typeof previewAnswers[prompt.id] === 'string' ? previewAnswers[prompt.id] as string : ''} onchange={(value) => previewAnswers[prompt.id] = value} aria-label={prompt.label} placeholder="Choose…" />
                {:else}
                  <Input aria-label={prompt.label} type={meta.sensitive || meta.typeHint === 'password' ? 'password' : meta.typeHint === 'number' ? 'number' : 'text'} value={typeof previewAnswers[prompt.id] === 'string' ? previewAnswers[prompt.id] as string : ''} placeholder={meta.typeHint === 'stringArray' ? 'Enter values separated by commas' : 'Try an answer…'} oninput={(event) => previewAnswers[prompt.id] = (event.target as HTMLInputElement).value} />
                {/if}
              </div>
            </div>
          {:else}<p class="py-5">No questions configured. Set any action field to “Ask when run” to add one.</p>{/each}
          <div class="pk-preview-actions"><h3>Actions included</h3>{#each draft.steps as step, index}<p><span>{index + 1}</span>{step.label || capIndex.get(step.capabilityId)?.name || 'Unavailable action'}{#if step.optional}<small>Can be skipped</small>{/if}</p>{/each}</div>
          {#if failurePublishedPrompts.length}<p class="mt-4 text-sm text-muted-foreground">{failurePublishedPrompts.length} additional questions are configured for failure follow-ups.</p>{/if}
          <Button variant="outline" onclick={() => showRunPreview = false}>Back to editing</Button>
        </div>
      {:else if selected.kind === 'details'}
        {@const subpackageOutputsByPackageId = new Map(
          [...subpackageDetails.entries()].map(([id, detail]) => [
            id,
            (detail.exposedOutputs ?? []).map((eo) => ({ name: eo.name })),
          ]),
        )}
        {@const capabilityOutputsByCapabilityId = new Map(
          (capabilitiesQuery.data ?? []).map((cap) => [
            cap.id,
            Object.entries(cap.outputMeta as Record<string, { label?: string }>).map(([key, m]) => ({
              key,
              label: m.label,
            })),
          ]),
        )}
        <PackageDetails
          bind:draft
          {siteOptions}
          {siteGroupOptions}
          {tenantLinkOptions}
          {normalPublishedPrompts}
          {failurePublishedPrompts}
          {subpackageOutputsByPackageId}
          {capabilityOutputsByCapabilityId}
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
          return aGroup.order - bGroup.order || aGroup.inputOrder - bGroup.inputOrder || Number(!isRequiredInput(cap.inputMeta[a])) - Number(!isRequiredInput(cap.inputMeta[b])) || a.localeCompare(b);
        })}
        {@const availableOptional = Object.entries(cap.inputMeta as Record<string, { required?: boolean; label?: string }>)
          .filter(([name, meta]) => !isRequiredInput(meta) && !(name in step.inputBindings))
          .map(([name, meta]) => ({
            value: name,
            label: fieldLabel(name, meta.label),
          }))}
        {@const readers = workflowReaders(lane, stepIndex)}
        <!-- Step header -->
        <div class="pk-action-editor-heading">
          <p class="pk-eyebrow">{lane === 'main' ? `ACTION ${stepIndex + 1} OF ${draft.steps.length}` : lane === 'onFailure' ? 'FAILURE FOLLOW-UP' : 'SUCCESS FOLLOW-UP'}</p>
          <div class="flex items-start gap-4">
            <div
              class="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background font-mono text-sm font-semibold tabular-nums text-muted-foreground"
            >
              {lane === 'main' ? String(stepIndex + 1).padStart(2, '0') : `${lane === 'onFailure' ? 'F' : 'S'}${String(stepIndex + 1).padStart(2, '0')}`}
            </div>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="truncate text-lg font-semibold">{step.label || cap.name}</h2>
                <span
                  class="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  {lane === 'main' ? cap.category : lane === 'onFailure' ? 'On Failure' : 'On Success'}
                </span>
              </div>
              {#if cap.description}
                <p class="text-sm text-muted-foreground">{cap.description}</p>
              {/if}
              <details class="pk-action-naming"><summary>Rename this action</summary>
              <input
                class="min-w-0 w-full bg-transparent pt-1 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:text-foreground"
                aria-label="Step name"
                placeholder={cap.name}
                value={step.label ?? cap.name}
                oninput={(event) =>
                  setWorkflowStepLabel(lane, stepIndex, (event.currentTarget as HTMLInputElement).value)}
              />
              </details>
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
        <div class="pk-action-form">
          <div class="flex items-baseline justify-between">
            <h3 class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Set up this action
            </h3>
            <span class="text-xs text-muted-foreground">
              {boundInputNames.length} configured
            </span>
          </div>

          {#if boundInputNames.length === 0}
            <p class="text-sm text-muted-foreground">
              This action needs no additional settings. Add another action or save your package.
            </p>
          {/if}

          <div class="space-y-3">
            {#each boundInputNames as inputName, inputIndex (inputName)}
              {@const meta = cap.inputMeta[inputName]}
              {#if meta}
                {@const group = inputGroupFor(cap, inputName)}
                {@const previousGroup = inputIndex > 0 ? inputGroupFor(cap, boundInputNames[inputIndex - 1]!) : null}
                {#if (!previousGroup || previousGroup.id !== group.id) && (group.id !== 'general' || group.description)}
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
                  class="pk-config-field"
                >
                  <div class="pk-field-heading">
                    <div class="min-w-0 space-y-0.5">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-medium">{label}</span>
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

                  <div class="pk-field-source">
                    <span>How should this be filled in?</span>
                    <SingleSelect
                      options={allowed.map((source) => ({ value: source, label: sourceLabel(source), subLabel: sourceHint(source, meta) }))}
                      selected={currentSource}
                      allowClear={false}
                      disableSort
                      aria-label={`Value source for ${label}`}
                      onchange={(value) => changeSource(stepIndex, inputName, value as Source)}
                    />
                  </div>

                  <!-- Editor for current source -->
                  <div class="pk-field-value space-y-2">
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
                        {@const multiSelect = meta.typeHint === 'stringArray'}
                        <EntityPicker
                          entityType={meta.entityType as EntityType}
                          multiple={multiSelect}
                          value={binding.value as string | string[] | null}
                          onValueChange={(v) => setBinding(stepIndex, inputName, { kind: 'literal', value: v })}
                        />
                      {:else if meta.typeHint === 'boolean'}
                        <label class="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={Boolean(binding.value)}
                            onCheckedChange={(c) => setBinding(stepIndex, inputName, { kind: 'literal', value: Boolean(c) })}
                          />
                          <span class="text-muted-foreground">{binding.value ? 'Yes' : 'No'}</span>
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
                      {@const prompt = draft.prompts.find((p) => p.id === binding.promptKey)}
                      {#if prompt}
                        <div class="pk-inline-question">
                          <label for={`question-${selectedKey}-${inputName}`}>Question your team will see</label>
                          <Input id={`question-${selectedKey}-${inputName}`} value={prompt.label} oninput={(event) => updatePrompt(prompt.id, { label: (event.target as HTMLInputElement).value })} />
                          <label for={`question-help-${selectedKey}-${inputName}`}>Help text <span>optional</span></label>
                          <Input id={`question-help-${selectedKey}-${inputName}`} placeholder="Help your team make the right choice" value={prompt.description ?? ''} oninput={(event) => updatePrompt(prompt.id, { description: (event.target as HTMLInputElement).value })} />
                          <label class="pk-question-required"><Checkbox checked={prompt.required} onCheckedChange={(checked) => setPromptRequired(prompt.id, Boolean(checked))} /> Require an answer before running</label>
                        </div>
                      {/if}
                      <details class="pk-field-advanced"><summary>Advanced · Question identifier</summary>
                        <Input aria-label={`Question identifier for ${label}`} value={binding.promptKey} oninput={(e) => setBinding(stepIndex, inputName, { ...binding, promptKey: (e.target as HTMLInputElement).value })} />
                        <p>Actions with the same identifier share one answer.</p>
                      </details>
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
                      {@const factOpts = factFieldsFor(meta).map((f) => ({ value: f.key, label: f.label, subLabel: `${f.fieldTypeLabel ?? f.type} · ${f.section}` }))}
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
                      {@const upstreamStep = upstreamSteps[binding.stepPosition]}
                      {@const upstreamIsSub = upstreamStep?.kind === 'subpackage'}
                      {@const upstreamCap = capIndex.get(upstreamStep?.capabilityId ?? '')}
                      {@const stepOpts = upstreamSteps.map((s, i) => ({ value: String(i), label: `Step ${String(i + 1).padStart(2, '0')}: ${s.label ?? capIndex.get(s.capabilityId)?.name ?? s.capabilityId}` }))}
                      {@const compatTypes = (meta as { priorOutputCompat?: string[] }).priorOutputCompat}
                      {@const outputOpts = upstreamIsSub
                        ? subpackageExposedOutputsFor((upstreamStep as SubpackageStep).packageId).map((eo) => ({ value: eo.name, label: eo.name }))
                        : upstreamCap ? Object.entries(upstreamCap.outputMeta as Record<string, { outputType?: string; label?: string }>).filter(([, m]) => { if (!compatTypes || compatTypes.length === 0) return true; const t = m.outputType; return t ? compatTypes.includes(t) : false; }).map(([k, m]) => ({ value: k, label: fieldLabel(k, m.label) })) : []}
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
                    Let your team decide whether to include this action when starting a run.
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
                  Later actions need results from this action, so it must run. Change those fields before making this action optional.
                </span>
              </div>
            </div>
          {:else if lane === 'main'}
            <div class="rounded-lg border p-4">
              <div class="flex items-center justify-between gap-3">
                <div class="space-y-0.5">
                  <div class="text-sm font-medium">Optional step</div>
                  <p class="text-xs text-muted-foreground">
                    Let your team decide whether to include this action when starting a run.
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
            <details class="pk-result-details">
<summary>Results available to later actions <span>{Object.keys(cap.outputMeta).length}</span></summary>
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
                            <span class="italic">Available for another action</span>
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
            </details>
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
        {@const availableOptionalReaction = Object.entries(reactionCap.inputMeta as Record<string, { required?: boolean; label?: string }>)
          .filter(([name, meta]) => !isRequiredInput(meta) && !(name in reaction.inputBindings))
          .map(([name, meta]) => ({ value: name, label: fieldLabel(name, meta.label) }))}

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
                        <span class="text-muted-foreground">{binding.value ? 'Yes' : 'No'}</span>
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
                      options={factFieldsFor(meta).map((f) => ({ value: f.key, label: f.label, subLabel: `${f.fieldTypeLabel ?? f.type} · ${f.section}` }))}
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
      {:else if selectedWorkflowStep}
        {@const orphanStep = selectedWorkflowStep}
        {@const orphanLane = selected.kind === 'reaction' ? selected.lane : 'main'}
        {@const orphanIndex = selected.index}
        {@const orphanIsMain = orphanLane === 'main'}
        {@const orphanCount = orphanIsMain
          ? draft.steps.length
          : draft.outcomeSteps[orphanLane as 'onSuccess' | 'onFailure'].length}
        <div class="space-y-4 p-6">
          <div class="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
            <div class="flex items-start gap-2">
              <AlertTriangle class="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <div class="min-w-0 flex-1 space-y-1">
                <div class="font-medium text-rose-700 dark:text-rose-300">
                  {capabilitiesQuery.isLoading ? 'Loading capability…' : 'Capability no longer available'}
                </div>
                {#if !capabilitiesQuery.isLoading}
                  <p class="text-xs text-rose-700/80 dark:text-rose-400/80">
                    This step references
                    <code class="rounded bg-rose-500/10 px-1 py-0.5 font-mono">{orphanStep.capabilityId}</code>,
                    which has been renamed or removed. Its inputs can't be edited — remove the step and add a replacement.
                  </p>
                {/if}
              </div>
            </div>
          </div>
          {#if !capabilitiesQuery.isLoading}
            <div class="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={orphanIndex === 0}
                onclick={() =>
                  orphanIsMain
                    ? moveStep(orphanIndex, -1)
                    : moveReactionStep(orphanLane as 'onSuccess' | 'onFailure', orphanIndex, -1)}
              >
                <ArrowUp class="mr-1 size-3.5" /> Move up
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={orphanIndex >= orphanCount - 1}
                onclick={() =>
                  orphanIsMain
                    ? moveStep(orphanIndex, 1)
                    : moveReactionStep(orphanLane as 'onSuccess' | 'onFailure', orphanIndex, 1)}
              >
                <ArrowDown class="mr-1 size-3.5" /> Move down
              </Button>
              <Button
                variant="destructive"
                size="sm"
                class="ml-auto"
                onclick={() =>
                  orphanIsMain
                    ? removeStep(orphanIndex)
                    : removeOutcomeStep(orphanLane as 'onSuccess' | 'onFailure', orphanIndex)}
              >
                <Trash2 class="mr-1 size-3.5" /> Remove step
              </Button>
            </div>
          {/if}
        </div>
      {:else}
        <div class="p-6 text-sm text-muted-foreground">Select a step to inspect.</div>
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

<SubpackagePicker
  bind:open={subpackagePickerOpen}
  packages={subpackagesQuery.data ?? []}
  excludeIds={currentPackageId ? [currentPackageId] : []}
  onAdd={addSubpackageStep}
/>

{#if currentPackageId && canRun}
  <RunPackageDialog bind:open={runDialogOpen} packageId={currentPackageId} onOpenChange={(open) => runDialogOpen = open} />
{/if}
