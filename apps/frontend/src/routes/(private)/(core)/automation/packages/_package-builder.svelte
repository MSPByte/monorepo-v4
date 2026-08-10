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
    | { kind: 'priorOutput'; stepPosition: number; path: string }
    | { kind: 'generated'; generator: string; params: Record<string, unknown> };

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
    // Empty arrays => global. Non-empty restricts which sites this package
    // can run against (site direct-match OR any of the site's groups).
    allowedSites: string[];
    allowedSiteGroups: string[];
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

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license';
  type Source = 'fixed' | 'runtime' | 'row' | 'wire' | 'generated';

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

  // Sites + site groups feed the scope pickers in the package details panel.
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
    allowedSites: [...(initial.allowedSites ?? [])],
    allowedSiteGroups: [...(initial.allowedSiteGroups ?? [])],
  });

  const isGlobalScope = $derived(
    draft.allowedSites.length === 0 && draft.allowedSiteGroups.length === 0
  );

  // Selection defaults to the first step when the package loads; -1 = meta (details).
  let selectedIndex = $state<number>(initial.steps.length > 0 ? 0 : -1);
  let capabilityPickerOpen = $state(false);
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
    if (binding.kind === 'generated') return 'generated';
    // entity kind:
    return binding.source === 'row-context' ? 'row' : 'runtime';
  }

  function allowedSourcesFor(meta: {
    allowedBindings: readonly string[];
    typeHint?: string;
  }): Source[] {
    const set = new Set(meta.allowedBindings);
    const out: Source[] = [];
    if (set.has('literal')) out.push('fixed');
    if (set.has('runtime') || set.has('entity')) out.push('runtime');
    if (set.has('entity')) out.push('row');
    if (set.has('priorOutput')) out.push('wire');
    // Only show `generated` if a registered generator applies to this typeHint,
    // otherwise it's dead UI.
    if (set.has('generated') && generatorFor(meta.typeHint)) out.push('generated');
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
    }
  ): Binding {
    if (source === 'fixed') {
      const initialValue =
        meta.typeHint === 'boolean' ? false : meta.typeHint === 'stringArray' ? [] : '';
      return { kind: 'literal', value: initialValue };
    }
    if (source === 'runtime') {
      // If the underlying schema only allows entity+picker (no true runtime),
      // fall back to that shape so the mutation validates server-side.
      if (!meta.allowedBindings.includes('runtime') && meta.allowedBindings.includes('entity')) {
        return { kind: 'entity', source: 'picker', entityType: meta.entityType ?? '' };
      }
      return { kind: 'runtime', promptKey: inputName, required: true };
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
    return { kind: 'priorOutput', stepPosition: 0, path: '' };
  }

  function defaultForInput(
    inputName: string,
    meta: {
      allowedBindings: readonly string[];
      entityType?: string;
      typeHint?: string;
    }
  ): Binding {
    const allowed = allowedSourcesFor(meta);
    const preferred: Source = allowed.includes('runtime') ? 'runtime' : (allowed[0] ?? 'fixed');
    return defaultBindingFor(preferred, inputName, meta);
  }

  function addStep(capabilityId: string) {
    if (!capabilityId) return;
    const cap = capIndex.get(capabilityId);
    if (!cap) return;
    const inputBindings: Record<string, Binding> = {};
    for (const [name, meta] of Object.entries(cap.inputMeta)) {
      if (!isRequiredInput(meta)) continue;
      inputBindings[name] = defaultForInput(name, meta);
    }
    const nextIndex = draft.steps.length;
    draft.steps = [...draft.steps, { capabilityId: cap.id, label: cap.name, inputBindings }];
    selectedIndex = nextIndex;
    capabilityPickerOpen = false;
    capabilitySearch = '';
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
    draft.steps = [...draft.steps];
  }

  function removeOptionalInput(stepIndex: number, inputName: string) {
    const step = draft.steps[stepIndex]!;
    delete step.inputBindings[inputName];
    draft.steps = [...draft.steps];
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
    draft.steps = [...draft.steps];
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
  };
  function summarize(step: Step): StepSummary {
    const s: StepSummary = { prompts: 0, wires: [], row: 0, literals: 0, generated: 0 };
    for (const binding of Object.values(step.inputBindings)) {
      if (binding.kind === 'runtime') s.prompts += 1;
      else if (binding.kind === 'priorOutput')
        s.wires.push({ from: binding.stepPosition, path: binding.path });
      else if (binding.kind === 'entity') {
        if (binding.source === 'row-context') s.row += 1;
        else s.prompts += 1;
      } else if (binding.kind === 'generated') s.generated += 1;
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
    return 'Reads a specific output from an earlier step in this package.';
  }

  function sourceIconColor(source: Source): string {
    if (source === 'fixed') return 'text-stone-500 dark:text-stone-400';
    if (source === 'runtime') return 'text-amber-600 dark:text-amber-400';
    if (source === 'row') return 'text-violet-600 dark:text-violet-400';
    if (source === 'generated') return 'text-emerald-600 dark:text-emerald-400';
    return 'text-cyan-600 dark:text-cyan-400';
  }

  function sourceBorderClass(source: Source): string {
    if (source === 'fixed') return 'border-l-stone-400/60 dark:border-l-stone-500/60';
    if (source === 'runtime') return 'border-l-amber-500/70';
    if (source === 'row') return 'border-l-violet-500/70';
    if (source === 'generated') return 'border-l-emerald-500/70';
    return 'border-l-cyan-500/70';
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
        if (binding.kind === 'generated') {
          if (!binding.generator.trim()) return false;
        }
      }
    }
    return true;
  }

  const selectedStep = $derived(selectedIndex >= 0 ? (draft.steps[selectedIndex] ?? null) : null);
  const selectedCap = $derived(selectedStep ? capIndex.get(selectedStep.capabilityId) : undefined);

  // Inspector: prompt-key hint. When the promptKey differs from the input
  // name the user is doing something intentional (dedup across steps) — we
  // surface it. Otherwise we keep it collapsed.
  let showPromptKeyEditor = $state<Record<string, boolean>>({});
</script>

<div class="flex size-full flex-col overflow-hidden bg-background">
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
        <Button onclick={() => onSave(draft)} disabled={!canSave() || saving}>
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
      <div class="border-b bg-background/60 px-4 py-3">
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
                      {#if summary.literals > 0}
                        <span
                          class="inline-flex items-center gap-1 rounded-sm bg-stone-500/10 px-1.5 py-0.5 font-mono text-stone-600 dark:text-stone-400"
                          title="Fixed values"
                        >
                          {summary.literals}
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
            onclick={() => (capabilityPickerOpen = true)}
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
                  : `${draft.allowedSites.length} sites · ${draft.allowedSiteGroups.length} groups`}
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
        {@const boundInputNames = Object.keys(step.inputBindings)}
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
            {#each boundInputNames as inputName (inputName)}
              {@const meta = cap.inputMeta[inputName]}
              {#if meta}
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
                      {#if meta.entityType}
                        <p class="pt-0.5 font-mono text-[10px] text-muted-foreground/70">
                          entity: {meta.entityType}
                        </p>
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
                  <div class="grid grid-cols-2 gap-1 border-b bg-muted/30 p-1 sm:grid-cols-5">
                    {#each ['fixed', 'runtime', 'generated', 'row', 'wire'] as src (src)}
                      {@const isAllowed = allowed.includes(src as Source)}
                      {@const isActive = currentSource === src}
                      <button
                        type="button"
                        disabled={!isAllowed}
                        onclick={() => changeSource(selectedIndex, inputName, src as Source)}
                        class="group relative flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-all {isActive
                          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                          : isAllowed
                            ? 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                            : 'cursor-not-allowed text-muted-foreground/40'}"
                        title={isAllowed
                          ? sourceHint(src as Source, meta)
                          : 'Not available for this input'}
                      >
                        {#if src === 'fixed'}
                          <Circle class="size-3 {isActive ? sourceIconColor('fixed') : ''}" />
                        {:else if src === 'runtime'}
                          <Keyboard class="size-3 {isActive ? sourceIconColor('runtime') : ''}" />
                        {:else if src === 'generated'}
                          <Sparkles class="size-3 {isActive ? sourceIconColor('generated') : ''}" />
                        {:else if src === 'row'}
                          <Pin class="size-3 {isActive ? sourceIconColor('row') : ''}" />
                        {:else}
                          <Link2 class="size-3 {isActive ? sourceIconColor('wire') : ''}" />
                        {/if}
                        {sourceLabel(src as Source)}
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
                    {:else if binding?.kind === 'priorOutput'}
                      {@const upstreamSteps = draft.steps.slice(0, selectedIndex)}
                      {@const upstreamCap = capIndex.get(
                        upstreamSteps[binding.stepPosition]?.capabilityId ?? ''
                      )}
                      {@const stepOpts = upstreamSteps.map((s, i) => ({
                        value: String(i),
                        label: `Step ${String(i + 1).padStart(2, '0')}: ${s.label ?? capIndex.get(s.capabilityId)?.name ?? s.capabilityId}`,
                      }))}
                      {@const outputOpts = upstreamCap
                        ? Object.entries(upstreamCap.outputMeta).map(([k, m]) => ({
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

          <div class="flex items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
            <div class="inline-flex items-center gap-1.5">
              <Database class="size-3.5" />
              Est. cost per run:
              <span class="font-mono tabular-nums text-foreground">
                ${cap.defaultUnitPrice.toFixed(4)}
              </span>
            </div>
          </div>
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
      <Dialog.Title class="text-xl font-semibold tracking-tight">Add capability</Dialog.Title>
      <Dialog.Description>
        Search the catalog, narrow the list, then insert the next step.
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
