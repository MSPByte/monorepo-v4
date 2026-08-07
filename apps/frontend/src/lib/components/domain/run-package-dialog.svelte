<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import EntityPicker from './entity-picker.svelte';

  type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // Optional preselection — skips the package picker step.
    packageId?: string;
    linkId?: string | null;
    siteId?: string | null;
  };

  let { open = $bindable(), onOpenChange, packageId, linkId, siteId }: Props = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const packagesQuery = createQuery(() => ({
    queryKey: ['packages.list'],
    queryFn: () => trpc.packages.list.query(),
    enabled: open,
    staleTime: 30_000,
  }));

  const capabilitiesQuery = createQuery(() => ({
    queryKey: ['packages.metadata.capabilities'],
    queryFn: () => trpc.packages.capabilities.query(),
    enabled: open,
    staleTime: 5 * 60_000,
  }));

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license';

  let selectedPackageId = $state<string>('');
  let values = $state<Record<string, string | boolean | string[]>>({});
  let startStepIndex = $state(0);

  // Reset the picker to the caller-provided preselection whenever the dialog
  // opens; captures the current value of `packageId` at open time.
  $effect(() => {
    if (open) {
      selectedPackageId = packageId ?? '';
      startStepIndex = 0;
      values = {};
    }
  });

  const selectedPackage = $derived(
    (packagesQuery.data ?? []).find((p) => p.id === selectedPackageId),
  );

  type Binding =
    | { kind: 'literal'; value: unknown }
    | { kind: 'runtime'; promptKey: string; required: boolean }
    | { kind: 'entity'; source: string; entityType: string; contextKey?: string }
    | { kind: 'priorOutput'; stepPosition: number; path: string };

  type Step = {
    capabilityId: string;
    label?: string;
    inputBindings: Record<string, Binding>;
  };

  const packageSteps = $derived((selectedPackage?.steps as Step[] | undefined) ?? []);

  // If the user picks a start position mid-package, any priorOutput binding
  // for later steps that references a skipped step is unresolvable — we can't
  // fabricate the prior output. Tell the user rather than silently blocking.
  const startStepBlocker = $derived.by<string | null>(() => {
    if (startStepIndex === 0) return null;
    for (let pos = startStepIndex; pos < packageSteps.length; pos++) {
      const step = packageSteps[pos];
      if (!step) continue;
      for (const [name, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind === 'priorOutput' && binding.stepPosition < startStepIndex) {
          return `Step ${pos + 1} input "${name}" needs step ${
            binding.stepPosition + 1
          }'s output. Start from step ${binding.stepPosition + 1} or earlier, or run the full package.`;
        }
      }
    }
    return null;
  });

  type RuntimeField = {
    promptKey: string;
    required: boolean;
    typeHint: 'text' | 'boolean' | 'stringArray';
    sensitive: boolean;
    entityType?: EntityType;
  };

  // Walks every step's runtime bindings and dedupes by promptKey. Skipped
  // steps (position < startStepIndex) contribute no prompts.
  const runtimeFields = $derived.by<RuntimeField[]>(() => {
    if (!selectedPackage || !capabilitiesQuery.data) return [];
    const capMeta = new Map(capabilitiesQuery.data.map((c) => [c.id, c]));
    const map = new Map<string, RuntimeField>();
    const steps = (selectedPackage.steps as Step[]) ?? [];
    for (let pos = 0; pos < steps.length; pos++) {
      if (pos < startStepIndex) continue;
      const step = steps[pos]!;
      const cap = capMeta.get(step.capabilityId);
      if (!cap) continue;
      for (const [inputName, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind !== 'runtime') continue;
        const meta = (cap.inputMeta as Record<string, {
          sensitive?: boolean;
          typeHint?: RuntimeField['typeHint'];
          entityType?: EntityType;
        }>)[inputName];
        if (!meta) continue;
        const existing = map.get(binding.promptKey);
        map.set(binding.promptKey, {
          promptKey: binding.promptKey,
          required: existing?.required || binding.required,
          typeHint: meta.typeHint ?? existing?.typeHint ?? 'text',
          sensitive: meta.sensitive ?? existing?.sensitive ?? false,
          entityType: meta.entityType ?? existing?.entityType,
        });
      }
    }
    return Array.from(map.values());
  });

  const costPreview = $derived.by(() => {
    if (!selectedPackage || !capabilitiesQuery.data) return null;
    const capMeta = new Map(capabilitiesQuery.data.map((c) => [c.id, c]));
    const steps = (selectedPackage.steps as Step[]) ?? [];
    let total = 0;
    const lines: Array<{ label: string; price: number; skipped: boolean }> = [];
    for (let pos = 0; pos < steps.length; pos++) {
      const step = steps[pos]!;
      const cap = capMeta.get(step.capabilityId);
      if (!cap) continue;
      const skipped = pos < startStepIndex;
      if (!skipped) total += cap.defaultUnitPrice;
      lines.push({ label: cap.name, price: cap.defaultUnitPrice, skipped });
    }
    return { lines, total };
  });

  const start = createMutation(() => ({
    mutationFn: (args: {
      packageId: string;
      runtimeInputs: Record<string, unknown>;
      startStepIndex: number;
    }) =>
      trpc.packageRuns.start.mutate({
        packageId: args.packageId,
        linkId: linkId ?? null,
        siteId: siteId ?? null,
        runtimeInputs: args.runtimeInputs,
        startStepIndex: args.startStepIndex,
      }),
    onSuccess: (result) => {
      onOpenChange(false);
      toast.success('Package run started', {
        action: {
          label: 'View',
          onClick: () => goto(`/automation/runs/${result.packageRunId}`),
        },
      });
    },
    onError: (err) => toast.error(err.message ?? 'Failed to start run'),
  }));

  // Downstream m365_* pickers cascade from whichever runtime input holds an
  // integration_link. Pick the first tenantLinkId-ish value we find.
  const cascadeLinkId = $derived.by<string | undefined>(() => {
    for (const field of runtimeFields) {
      if (field.entityType !== 'integration_link') continue;
      const raw = values[field.promptKey];
      if (typeof raw === 'string' && raw.length > 0) return raw;
    }
    return undefined;
  });

  function coerce(field: RuntimeField, raw: string | boolean | string[] | undefined): unknown {
    if (field.typeHint === 'boolean') return Boolean(raw);
    if (field.typeHint === 'stringArray') {
      if (Array.isArray(raw)) return raw;
      const s = typeof raw === 'string' ? raw : '';
      return s.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return typeof raw === 'string' ? raw : '';
  }

  function canSubmit(): boolean {
    if (!selectedPackage) return false;
    for (const field of runtimeFields) {
      if (!field.required) continue;
      const raw = values[field.promptKey];
      if (field.typeHint === 'boolean') continue; // booleans always have a value
      if (field.typeHint === 'stringArray' || (field.entityType && Array.isArray(raw))) {
        if (!Array.isArray(raw) || raw.length === 0) {
          // Text-mode array (no entityType) can still be a comma string
          if (typeof raw !== 'string' || raw.trim().length === 0) return false;
        }
        continue;
      }
      if (typeof raw !== 'string' || raw.trim().length === 0) return false;
    }
    return true;
  }

  function submit() {
    if (!selectedPackage) return;
    if (startStepBlocker) return;
    const runtimeInputs: Record<string, unknown> = {};
    for (const field of runtimeFields) {
      runtimeInputs[field.promptKey] = coerce(field, values[field.promptKey]);
    }
    start.mutate({ packageId: selectedPackage.id, runtimeInputs, startStepIndex });
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="sm:max-w-[560px] max-h-[85vh] overflow-hidden grid-rows-[auto_1fr_auto]">
    <Dialog.Header>
      <Dialog.Title>Run a package</Dialog.Title>
      <Dialog.Description>
        Fill in the runtime inputs and confirm the cost before this executes.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-6 overflow-y-auto px-4 pb-2 pt-2">
      {#if !packageId}
        <section class="space-y-2">
          <Label class="text-xs uppercase tracking-wide text-muted-foreground">Package</Label>
          <Select.Root type="single" bind:value={selectedPackageId}>
            <Select.Trigger class="w-full">
              {selectedPackage?.name ?? 'Choose a package'}
            </Select.Trigger>
            <Select.Content>
              {#each (packagesQuery.data ?? []).filter((p) => p.status === 'active') as pkg}
                <Select.Item value={pkg.id}>{pkg.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </section>
      {/if}

      {#if selectedPackage}
        {#if packageSteps.length > 1}
          <section class="space-y-2">
            <Label
              for="rp-startstep"
              class="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Start from
            </Label>
            <Select.Root
              type="single"
              value={String(startStepIndex)}
              onValueChange={(v) => (startStepIndex = Number(v))}
            >
              <Select.Trigger id="rp-startstep" class="w-full">
                Step {startStepIndex + 1}: {packageSteps[startStepIndex]?.label ??
                  packageSteps[startStepIndex]?.capabilityId}
              </Select.Trigger>
              <Select.Content>
                {#each packageSteps as step, i}
                  <Select.Item value={String(i)}>
                    Step {i + 1}: {step.label ?? step.capabilityId}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            {#if startStepBlocker}
              <p class="text-xs text-rose-500">{startStepBlocker}</p>
            {/if}
          </section>
        {/if}

        {#if runtimeFields.length > 0}
          <section class="space-y-3">
            <Label class="text-xs uppercase tracking-wide text-muted-foreground">
              Runtime inputs
            </Label>
            <div class="space-y-4">
              {#each runtimeFields as field}
                <div class="space-y-1.5">
                  <Label for={`rp-${field.promptKey}`} class="text-sm">
                    {field.promptKey}
                    {#if field.required}<span class="text-rose-500">*</span>{/if}
                  </Label>
                  {#if field.entityType}
                    <EntityPicker
                      entityType={field.entityType}
                      integrationLinkId={field.entityType !== 'integration_link'
                        ? cascadeLinkId
                        : undefined}
                      integrationId={field.entityType === 'integration_link'
                        ? 'microsoft-365'
                        : undefined}
                      multiple={field.typeHint === 'stringArray'}
                      value={values[field.promptKey] as string | string[] | null | undefined ??
                        (field.typeHint === 'stringArray' ? [] : null)}
                      onValueChange={(v) => (values[field.promptKey] = v as any)}
                      placeholder="Choose…"
                    />
                  {:else if field.typeHint === 'boolean'}
                    <label class="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={`rp-${field.promptKey}`}
                        checked={Boolean(values[field.promptKey])}
                        onCheckedChange={(c) => (values[field.promptKey] = Boolean(c))}
                      />
                      <span class="text-muted-foreground">
                        {Boolean(values[field.promptKey]) ? 'true' : 'false'}
                      </span>
                    </label>
                  {:else if field.typeHint === 'stringArray'}
                    <Input
                      id={`rp-${field.promptKey}`}
                      placeholder="Comma-separated values"
                      value={typeof values[field.promptKey] === 'string'
                        ? (values[field.promptKey] as string)
                        : ''}
                      oninput={(e) =>
                        (values[field.promptKey] = (e.target as HTMLInputElement).value)}
                    />
                  {:else}
                    <Input
                      id={`rp-${field.promptKey}`}
                      type={field.sensitive ? 'password' : 'text'}
                      value={typeof values[field.promptKey] === 'string'
                        ? (values[field.promptKey] as string)
                        : ''}
                      oninput={(e) =>
                        (values[field.promptKey] = (e.target as HTMLInputElement).value)}
                    />
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if costPreview}
          <section class="space-y-2">
            <Label class="text-xs uppercase tracking-wide text-muted-foreground">Cost</Label>
            <div class="rounded-md border bg-muted/30 p-3 text-sm">
              <dl class="space-y-1">
                {#each costPreview.lines as line}
                  <div
                    class={'flex justify-between gap-3 ' +
                      (line.skipped ? 'text-muted-foreground line-through' : '')}
                  >
                    <dt class="truncate">{line.label}</dt>
                    <dd class="shrink-0 tabular-nums">${line.price.toFixed(4)}</dd>
                  </div>
                {/each}
              </dl>
              <div class="mt-2 flex justify-between border-t pt-2 font-medium">
                <span>Total per run</span>
                <span class="tabular-nums">${costPreview.total.toFixed(4)}</span>
              </div>
            </div>
          </section>
        {/if}
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button
        onclick={submit}
        disabled={!canSubmit() || start.isPending || !!startStepBlocker}
      >
        {start.isPending ? 'Starting…' : 'Run'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
