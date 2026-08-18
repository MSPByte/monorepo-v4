<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import Button from '$lib/components/ui/button/button.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { Info, Sparkles, Plus, Trash2 } from '@lucide/svelte';
  import type { ExposedOutput, PackageDraft, PackagePrompt, Step } from './_package-builder.svelte';

  type Option = { value: string; label: string; subLabel?: string };
  type Props = {
    draft: PackageDraft;
    siteOptions: Option[];
    siteGroupOptions: Option[];
    tenantLinkOptions: Option[];
    normalPublishedPrompts: PackagePrompt[];
    failurePublishedPrompts: PackagePrompt[];
    onUpdatePrompt: (id: string, patch: Partial<PackagePrompt>) => void;
    onSetPromptRequired: (id: string, required: boolean) => void;
    // Sub-package output previews: keyed by referenced child packageId.
    subpackageOutputsByPackageId?: Map<string, Array<{ name: string }>>;
    // Real-capability outputMeta so exposed-output source pickers can list
    // available output keys for capability steps.
    capabilityOutputsByCapabilityId?: Map<string, Array<{ key: string; label?: string }>>;
  };

  let {
    draft = $bindable(),
    siteOptions,
    siteGroupOptions,
    tenantLinkOptions,
    normalPublishedPrompts,
    failurePublishedPrompts,
    onUpdatePrompt,
    onSetPromptRequired,
    subpackageOutputsByPackageId = new Map(),
    capabilityOutputsByCapabilityId = new Map(),
  }: Props = $props();

  const isGlobalScope = $derived(
    draft.allowedSites.length === 0 &&
      draft.allowedSiteGroups.length === 0 &&
      draft.allowedIntegrationLinks.length === 0
  );

  // Options for the "source step" dropdown in the exposed-outputs editor.
  // Only main-lane steps are exposable — terminal-lane outputs are lane-local.
  const stepOptions = $derived(
    (draft.steps as Step[]).map((step, i) => ({
      value: String(i),
      label: `Step ${String(i + 1).padStart(2, '0')}: ${step.label ?? (step.kind === 'subpackage' ? 'Sub-package' : step.capabilityId)}`,
    })),
  );

  function sourcePathOptionsFor(pos: number): Array<{ value: string; label: string }> {
    const step = (draft.steps as Step[])[pos];
    if (!step) return [];
    if (step.kind === 'subpackage') {
      return (subpackageOutputsByPackageId.get(step.packageId) ?? []).map((o) => ({
        value: o.name,
        label: o.name,
      }));
    }
    return (capabilityOutputsByCapabilityId.get(step.capabilityId) ?? []).map((o) => ({
      value: o.key,
      label: o.label ?? o.key,
    }));
  }

  function addExposedOutput() {
    const next: ExposedOutput = {
      name: '',
      sourceStepPosition: 0,
      sourcePath: '',
    };
    draft.exposedOutputs = [...(draft.exposedOutputs ?? []), next];
  }

  function updateExposedOutput(index: number, patch: Partial<ExposedOutput>) {
    draft.exposedOutputs = (draft.exposedOutputs ?? []).map((eo: ExposedOutput, i: number) =>
      i === index ? { ...eo, ...patch } : eo,
    );
  }

  function removeExposedOutput(index: number) {
    draft.exposedOutputs = (draft.exposedOutputs ?? []).filter((_: ExposedOutput, i: number) => i !== index);
  }
</script>

<div class="mx-auto w-full max-w-2xl space-y-6 p-6">
  <div>
    <h2 class="text-lg font-semibold">Package details</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Give the package a name your team will recognize and describe what it does. This copy shows up
      in the runner and in audit logs.
    </p>
  </div>
  <div class="space-y-2">
    <label class="text-sm font-medium" for="pkg-name-inspector">Name</label><Input
      id="pkg-name-inspector"
      placeholder="e.g. Onboard new M365 user"
      value={draft.name}
      oninput={(event) => (draft.name = (event.target as HTMLInputElement).value)}
    />
  </div>
  <div class="space-y-2">
    <label class="text-sm font-medium" for="pkg-desc-inspector">Description</label><Textarea
      id="pkg-desc-inspector"
      placeholder="Describe when and why this package should be run."
      value={draft.description}
      oninput={(event) => (draft.description = (event.target as HTMLTextAreaElement).value)}
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
        >{isGlobalScope
          ? 'Global'
          : `${draft.allowedSites.length} sites · ${draft.allowedSiteGroups.length} groups · ${draft.allowedIntegrationLinks.length} tenants`}</span
      >
    </div>
    <div class="space-y-2">
      <div class="text-xs text-muted-foreground">Allowed sites</div>
      <MultiSelect
        options={siteOptions}
        selected={draft.allowedSites}
        placeholder="Any site (global)"
        onchange={(value) => (draft.allowedSites = value)}
      />
    </div>
    <div class="space-y-2">
      <div class="text-xs text-muted-foreground">Allowed site groups</div>
      <MultiSelect
        options={siteGroupOptions}
        selected={draft.allowedSiteGroups}
        placeholder="No group restriction"
        onchange={(value) => (draft.allowedSiteGroups = value)}
      />
    </div>
    <div class="space-y-2">
      <div class="text-xs text-muted-foreground">Allowed tenant links</div>
      <MultiSelect
        options={tenantLinkOptions}
        selected={draft.allowedIntegrationLinks}
        placeholder="No tenant restriction"
        onchange={(value) => (draft.allowedIntegrationLinks = value)}
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
      <span class="font-mono text-[11px] text-muted-foreground"
        >{normalPublishedPrompts.length}
        {normalPublishedPrompts.length === 1 ? 'prompt' : 'prompts'}</span
      >
    </div>
    {#if normalPublishedPrompts.length === 0}
      <p class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        This package runs with its preset values. Add a capability input as “Ask when run” to
        publish a question.
      </p>
    {:else}
      <div class="space-y-2">
        {#each normalPublishedPrompts as prompt (prompt.id)}<div
            class="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-start"
          >
            <div class="min-w-0 space-y-1">
              <Input
                value={prompt.label}
                aria-label={`Prompt label for ${prompt.id}`}
                oninput={(event) =>
                  onUpdatePrompt(prompt.id, { label: (event.target as HTMLInputElement).value })}
                class="h-8 text-sm font-medium"
              /><Input
                value={prompt.description ?? ''}
                placeholder="Help the operator understand this choice"
                aria-label={`Prompt help for ${prompt.id}`}
                oninput={(event) =>
                  onUpdatePrompt(prompt.id, {
                    description: (event.target as HTMLInputElement).value,
                  })}
                class="h-8 text-xs"
              />
            </div>
            <label
              class="flex items-center gap-2 whitespace-nowrap pt-1 text-xs text-muted-foreground"
              ><Checkbox
                checked={prompt.required}
                onCheckedChange={(checked) => onSetPromptRequired(prompt.id, Boolean(checked))}
              />Required</label
            >
          </div>{/each}
      </div>
    {/if}
  </div>

  {#if draft.outcomeSteps.onFailure.length > 0}
    <div class="space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
      <div class="flex items-baseline justify-between gap-3">
        <div>
          <h3 class="text-sm font-medium">On failure run experience</h3>
          <p class="mt-0.5 text-xs text-muted-foreground">
            These questions are only used if this package reaches its failure lane. They stay
            separate from normal-run inputs.
          </p>
        </div>
        <span class="font-mono text-[11px] text-muted-foreground"
          >{failurePublishedPrompts.length}
          {failurePublishedPrompts.length === 1 ? 'prompt' : 'prompts'}</span
        >
      </div>
      {#if failurePublishedPrompts.length === 0}
        <p
          class="rounded-md border border-dashed border-rose-500/30 px-3 py-2 text-xs text-muted-foreground"
        >
          This failure lane uses preset values and site facts only.
        </p>
      {:else}
        <div class="space-y-2">
          {#each failurePublishedPrompts as prompt (prompt.id)}<div
              class="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-start"
            >
              <div class="min-w-0 space-y-1">
                <Input
                  value={prompt.label}
                  aria-label={`Failure prompt label for ${prompt.id}`}
                  oninput={(event) =>
                    onUpdatePrompt(prompt.id, { label: (event.target as HTMLInputElement).value })}
                  class="h-8 text-sm font-medium"
                /><Input
                  value={prompt.description ?? ''}
                  placeholder="Help the operator understand this failure input"
                  aria-label={`Failure prompt help for ${prompt.id}`}
                  oninput={(event) =>
                    onUpdatePrompt(prompt.id, {
                      description: (event.target as HTMLInputElement).value,
                    })}
                  class="h-8 text-xs"
                />
              </div>
              <label
                class="flex items-center gap-2 whitespace-nowrap pt-1 text-xs text-muted-foreground"
                ><Checkbox
                  checked={prompt.required}
                  onCheckedChange={(checked) => onSetPromptRequired(prompt.id, Boolean(checked))}
                />Required</label
              >
            </div>{/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="space-y-3 rounded-lg border bg-muted/10 p-4">
    <div class="flex items-baseline justify-between gap-3">
      <div>
        <h3 class="text-sm font-medium">Exposed outputs</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Only relevant when another package embeds this one as a sub-package step. Each entry
          publishes a step output under a stable name that the parent package can wire to.
        </p>
      </div>
      <span class="font-mono text-[11px] text-muted-foreground">
        {(draft.exposedOutputs ?? []).length}
      </span>
    </div>
    {#if (draft.exposedOutputs ?? []).length === 0}
      <p class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        No outputs exposed. This package can still be embedded, but parent packages won't be able to
        wire from its step outputs.
      </p>
    {:else}
      <div class="space-y-2">
        {#each draft.exposedOutputs ?? [] as eo, i (i)}
          {@const pathOptions = sourcePathOptionsFor(eo.sourceStepPosition)}
          <div class="space-y-2 rounded-md border bg-background p-3">
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1 space-y-2">
                <Input
                  value={eo.name}
                  placeholder="Exposed name (e.g. breakglass_user_id)"
                  aria-label={`Exposed output name ${i + 1}`}
                  oninput={(event) =>
                    updateExposedOutput(i, { name: (event.target as HTMLInputElement).value })}
                  class="h-8 text-sm font-medium"
                />
                <div class="grid gap-2 sm:grid-cols-2">
                  <SingleSelect
                    options={stepOptions}
                    selected={String(eo.sourceStepPosition)}
                    placeholder="Source step…"
                    disableSort
                    onchange={(v) =>
                      updateExposedOutput(i, { sourceStepPosition: Number(v), sourcePath: '' })}
                  />
                  {#if pathOptions.length > 0}
                    <SingleSelect
                      options={pathOptions}
                      selected={eo.sourcePath}
                      placeholder="Output field…"
                      onchange={(v) => updateExposedOutput(i, { sourcePath: v })}
                    />
                  {:else}
                    <Input
                      value={eo.sourcePath}
                      placeholder="output path (e.g. userId or user.id)"
                      aria-label={`Exposed output path ${i + 1}`}
                      oninput={(event) =>
                        updateExposedOutput(i, {
                          sourcePath: (event.target as HTMLInputElement).value,
                        })}
                      class="h-8 text-xs font-mono"
                    />
                  {/if}
                </div>
                <Input
                  value={eo.description ?? ''}
                  placeholder="Optional description for the parent-package author"
                  aria-label={`Exposed output description ${i + 1}`}
                  oninput={(event) =>
                    updateExposedOutput(i, {
                      description: (event.target as HTMLInputElement).value || undefined,
                    })}
                  class="h-8 text-xs"
                />
              </div>
              <button
                type="button"
                class="text-muted-foreground transition-colors hover:text-rose-500"
                onclick={() => removeExposedOutput(i)}
                aria-label={`Remove exposed output ${i + 1}`}
              >
                <Trash2 class="size-3.5" />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    <Button variant="outline" size="sm" onclick={addExposedOutput}>
      <Plus class="mr-1 size-3.5" /> Add exposed output
    </Button>
  </div>

  <div class="rounded-lg border bg-muted/10 p-4">
    <div class="flex items-start gap-3">
      <Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="space-y-1">
        <p class="text-sm font-medium">Reactions live in the sidebar</p>
        <p class="text-xs text-muted-foreground">
          Use the <strong>On Failure</strong> and <strong>On Success</strong> sections in the left panel
          to add capabilities that run after the main package finishes. Click any reaction to configure
          it here.
        </p>
      </div>
    </div>
  </div>
  {#if draft.steps.length === 0}<div class="rounded-lg border border-dashed p-8 text-center">
      <div class="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
        <Sparkles class="size-4 text-muted-foreground" />
      </div>
      <p class="mt-3 text-sm font-medium">Add your first step</p>
      <p class="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Pick a capability from the left panel to start composing.
      </p>
    </div>{/if}
</div>
