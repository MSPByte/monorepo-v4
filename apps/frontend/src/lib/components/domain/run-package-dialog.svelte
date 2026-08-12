<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import SingleSelect from '$lib/components/single-select.svelte';
  import EntityPicker from './entity-picker.svelte';
  import { fieldLabel } from '$lib/utils/label';

  // Magic value that means "the capability handler generates a strong password
  // at run time". Kept in sync with @mspbyte/capabilities/m365/create-identity.
  const GENERATE_PASSWORD_SENTINEL = '__generate__';

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license';

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
    queryKey: ['packages.list', siteId ?? null, linkId ?? null],
    queryFn: () =>
      trpc.packages.list.query({
        siteId: siteId ?? undefined,
        linkId: linkId ?? undefined,
      }),
    enabled: open,
    staleTime: 30_000,
  }));

  const capabilitiesQuery = createQuery(() => ({
    queryKey: ['packages.metadata.capabilities'],
    queryFn: () => trpc.packages.capabilities.query(),
    enabled: open,
    staleTime: 5 * 60_000,
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    enabled: open,
    staleTime: 60_000,
  }));

  const siteOptions = $derived(
    (sitesQuery.data ?? []).map((s: { id: string; name: string }) => ({ value: s.id, label: s.name }))
  );

  let selectedPackageId = $state<string>('');
  let values = $state<Record<string, string | boolean | string[]>>({});
  // Password fields have a two-mode UX: generate (server-side) or custom.
  // Default to 'generate' the first time we encounter a password field.
  let passwordModes = $state<Record<string, 'generate' | 'custom'>>({});
  // Site fields have a two-mode UX: select existing (returns UUID) or create new (returns name).
  let siteModes = $state<Record<string, 'select' | 'create'>>({});
  let startStepIndex = $state(0);

  $effect(() => {
    if (open) {
      selectedPackageId = packageId ?? '';
      startStepIndex = 0;
      values = {};
      passwordModes = {};
      siteModes = {};
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

  type RuntimeField = {
    promptKey: string;
    inputName: string;
    required: boolean;
    typeHint: 'text' | 'boolean' | 'stringArray' | 'password' | 'upn';
    sensitive: boolean;
    entityType?: EntityType;
    label?: string;
    description?: string;
  };

  const packageSteps = $derived((selectedPackage?.steps as Step[] | undefined) ?? []);

  const startStepBlocker = $derived.by<string | null>(() => {
    if (startStepIndex === 0) return null;
    for (let pos = startStepIndex; pos < packageSteps.length; pos++) {
      const step = packageSteps[pos];
      if (!step) continue;
      for (const [name, binding] of Object.entries(step.inputBindings)) {
        if (binding.kind === 'priorOutput' && binding.stepPosition < startStepIndex) {
          return `Step ${pos + 1} needs output from step ${binding.stepPosition + 1}. Start earlier or run the full package.`;
        }
      }
    }
    return null;
  });

  // Walks every step's runtime bindings and dedupes by promptKey. Skipped
  // steps (position < startStepIndex) contribute no prompts. Fields inherit
  // the strictest requirement across usages.
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
          label?: string;
          description?: string;
          required?: boolean;
        }>)[inputName];
        if (!meta) continue;
        const existing = map.get(binding.promptKey);
        map.set(binding.promptKey, {
          promptKey: binding.promptKey,
          inputName,
          required: existing?.required || binding.required,
          typeHint: meta.typeHint ?? existing?.typeHint ?? 'text',
          sensitive: meta.sensitive ?? existing?.sensitive ?? false,
          entityType: meta.entityType ?? existing?.entityType,
          label: meta.label ?? existing?.label,
          description: meta.description ?? existing?.description,
        });
      }
    }
    return sortFields(Array.from(map.values()));
  });

  // Entity types that require a live lookup scoped to a tenant integration link.
  // Internal MSPByte entities (e.g. 'site') are NOT in this set and render as
  // plain text inputs at run time — they don't need a tenant selected first.
  const TENANT_SCOPED_ENTITY_TYPES = new Set(['m365_identity', 'm365_group', 'm365_license']);

  // Sort so tenant picker comes first, then any other integration_link, then
  // non-cascading fields, then dependent m365_* pickers. This is the order a
  // user actually needs to fill things in.
  type FieldGroup = 'tenant' | 'in-tenant' | 'input';
  function groupOf(f: RuntimeField): FieldGroup {
    if (f.entityType === 'integration_link') return 'tenant';
    if ((f.entityType && TENANT_SCOPED_ENTITY_TYPES.has(f.entityType)) || f.typeHint === 'upn') return 'in-tenant';
    return 'input';
  }
  function sortFields(fields: RuntimeField[]): RuntimeField[] {
    const rank = (f: RuntimeField): number => {
      const g = groupOf(f);
      return g === 'tenant' ? 0 : g === 'input' ? 1 : 2;
    };
    return [...fields].sort((a, b) => {
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      return a.promptKey.localeCompare(b.promptKey);
    });
  }

  type Section = { key: FieldGroup; title: string; hint: string; fields: RuntimeField[] };
  const sections = $derived.by<Section[]>(() => {
    const groups = new Map<FieldGroup, RuntimeField[]>();
    for (const f of runtimeFields) {
      const g = groupOf(f);
      const arr = groups.get(g) ?? [];
      arr.push(f);
      groups.set(g, arr);
    }
    const out: Section[] = [];
    if (groups.has('tenant')) {
      out.push({
        key: 'tenant',
        title: 'Choose tenant',
        hint: 'Which environment this runs against.',
        fields: groups.get('tenant')!,
      });
    }
    if (groups.has('input')) {
      out.push({
        key: 'input',
        title: 'Details',
        hint: 'Fill in the values for this run.',
        fields: groups.get('input')!,
      });
    }
    if (groups.has('in-tenant')) {
      out.push({
        key: 'in-tenant',
        title: 'Pick in tenant',
        hint: 'Live lookups against the tenant you chose above.',
        fields: groups.get('in-tenant')!,
      });
    }
    return out;
  });

  // Downstream m365_* pickers cascade from whichever runtime input holds an
  // integration_link. If more than one tenant field exists, use the first
  // filled-in one.
  const cascadeLinkId = $derived.by<string | undefined>(() => {
    for (const field of runtimeFields) {
      if (field.entityType !== 'integration_link') continue;
      const raw = values[field.promptKey];
      if (typeof raw === 'string' && raw.length > 0) return raw;
    }
    return undefined;
  });

  // Live domain list for the picked tenant — fed to any UPN composite input.
  // Only fires once we have a tenant so we don't hammer Graph on every open.
  const domainsQuery = createQuery(() => ({
    queryKey: ['vendor.m365DomainOptions', cascadeLinkId],
    queryFn: () =>
      trpc.vendor.m365DomainOptions.query({ linkId: cascadeLinkId! }),
    enabled: !!cascadeLinkId,
    staleTime: 60_000,
  }));

  const domainOptions = $derived(
    (domainsQuery.data ?? []).map((d) => ({
      value: d.domain,
      label: d.isDefault ? `${d.domain} (default)` : d.domain,
    })),
  );

  function parseUpn(value: unknown): { local: string; domain: string } {
    const s = typeof value === 'string' ? value : '';
    const at = s.indexOf('@');
    if (at < 0) return { local: s, domain: '' };
    return { local: s.slice(0, at), domain: s.slice(at + 1) };
  }

  function writeUpn(promptKey: string, local: string, domain: string): void {
    values[promptKey] = domain ? `${local}@${domain}` : local;
  }

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

  function passwordMode(field: RuntimeField): 'generate' | 'custom' {
    return passwordModes[field.promptKey] ?? 'generate';
  }

  function siteMode(field: RuntimeField): 'select' | 'create' {
    return siteModes[field.promptKey] ?? 'select';
  }

  function isBlockedByTenant(field: RuntimeField): boolean {
    // UPN composite needs domain list from the tenant.
    if (field.typeHint === 'upn') return !cascadeLinkId;
    if (!field.entityType || field.entityType === 'integration_link') return false;
    // Internal entity types (e.g. 'site') don't need a tenant link.
    if (!TENANT_SCOPED_ENTITY_TYPES.has(field.entityType)) return false;
    // Tenant-scoped picker with no tenant selected yet.
    return !cascadeLinkId;
  }

  function coerce(field: RuntimeField, raw: string | boolean | string[] | undefined): unknown {
    if (field.typeHint === 'boolean') return Boolean(raw);
    if (field.typeHint === 'password') {
      if (passwordMode(field) === 'generate') return GENERATE_PASSWORD_SENTINEL;
      return typeof raw === 'string' ? raw : '';
    }
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
      if (isBlockedByTenant(field) && field.required) return false;
      if (!field.required) continue;
      const raw = values[field.promptKey];
      if (field.typeHint === 'boolean') continue;
      if (field.entityType === 'site') {
        if (typeof raw !== 'string' || raw.trim().length === 0) return false;
        continue;
      }
      if (field.typeHint === 'password') {
        if (passwordMode(field) === 'generate') continue;
        if (typeof raw !== 'string' || raw.length < 8) return false;
        continue;
      }
      if (field.typeHint === 'upn') {
        const { local, domain } = parseUpn(raw);
        if (!local.trim() || !domain) return false;
        continue;
      }
      if (field.typeHint === 'stringArray' || (field.entityType && Array.isArray(raw))) {
        if (Array.isArray(raw)) {
          if (raw.length === 0) return false;
          continue;
        }
        if (typeof raw !== 'string' || raw.trim().length === 0) return false;
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

  const packageOptions = $derived(
    (packagesQuery.data ?? [])
      .filter((p) => p.status === 'active')
      .map((p) => ({ value: p.id, label: p.name })),
  );

  const startStepOptions = $derived(
    packageSteps.map((step, i) => ({
      value: String(i),
      label: `Step ${i + 1}: ${step.label ?? step.capabilityId}`,
    })),
  );
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content
    class="sm:max-w-[560px] max-h-[85vh] overflow-hidden grid-rows-[auto_1fr_auto]"
  >
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
          <SingleSelect
            options={packageOptions}
            selected={selectedPackageId}
            placeholder="Choose a package"
            onchange={(v) => (selectedPackageId = v)}
          />
        </section>
      {/if}

      {#if selectedPackage}
        {#if packageSteps.length > 1}
          <section class="space-y-2">
            <Label class="text-xs uppercase tracking-wide text-muted-foreground">
              Start from
            </Label>
            <SingleSelect
              options={startStepOptions}
              selected={String(startStepIndex)}
              onchange={(v) => (startStepIndex = Number(v))}
              disableSort
            />
            {#if startStepBlocker}
              <p class="text-xs text-rose-500">{startStepBlocker}</p>
            {/if}
          </section>
        {/if}

        {#if runtimeFields.length > 0}
          {#each sections as section, sIdx (section.key)}
            <section class="space-y-3">
              <div class="flex items-baseline gap-2 border-b pb-1.5">
                <span class="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                  {String(sIdx + 1).padStart(2, '0')}
                </span>
                <h3 class="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                  {section.title}
                </h3>
                <span class="ml-auto text-[11px] text-muted-foreground">{section.hint}</span>
              </div>
              {#each section.fields as field (field.promptKey)}
              {@const label = fieldLabel(field.promptKey, field.label)}
              {@const blocked = isBlockedByTenant(field)}
              <div class="space-y-1.5">
                <Label for={`rp-${field.promptKey}`} class="text-sm">
                  {label}
                  {#if field.required}<span class="text-rose-500">*</span>{/if}
                </Label>
                {#if field.description}
                  <p class="text-xs text-muted-foreground">{field.description}</p>
                {/if}
                {#if field.typeHint === 'upn'}
                  {#if blocked}
                    <div class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                      Choose a tenant first.
                    </div>
                  {:else}
                    {@const parsed = parseUpn(values[field.promptKey])}
                    <div class="grid gap-2 sm:grid-cols-[1fr_auto_1.2fr] sm:items-center">
                      <Input
                        id={`rp-${field.promptKey}`}
                        placeholder="alias"
                        value={parsed.local}
                        oninput={(e) =>
                          writeUpn(
                            field.promptKey,
                            (e.target as HTMLInputElement).value,
                            parsed.domain,
                          )}
                      />
                      <span class="hidden text-muted-foreground sm:inline">@</span>
                      <SingleSelect
                        options={domainOptions}
                        selected={parsed.domain}
                        placeholder={domainsQuery.isLoading ? 'Loading domains…' : 'Choose a domain'}
                        onchange={(v) => writeUpn(field.promptKey, parsed.local, v)}
                      />
                    </div>
                  {/if}
                {:else if field.entityType && (field.entityType === 'integration_link' || TENANT_SCOPED_ENTITY_TYPES.has(field.entityType))}
                  {#if blocked}
                    <div class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                      Choose a tenant first.
                    </div>
                  {:else}
                    <EntityPicker
                      entityType={field.entityType}
                      packageId={selectedPackage.id}
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
                  {/if}
                {:else if field.typeHint === 'password'}
                  <RadioGroup.Root
                    value={passwordMode(field)}
                    onValueChange={(v) =>
                      (passwordModes[field.promptKey] = v as 'generate' | 'custom')}
                    class="gap-2"
                  >
                    <label class="flex items-start gap-2 text-sm cursor-pointer">
                      <RadioGroup.Item value="generate" class="mt-0.5" />
                      <div class="flex flex-col gap-0.5">
                        <span>Generate a strong random password</span>
                        <span class="text-xs text-muted-foreground">
                          Shown once after the run — copy it from the run detail before it
                          expires.
                        </span>
                      </div>
                    </label>
                    <label class="flex items-start gap-2 text-sm cursor-pointer">
                      <RadioGroup.Item value="custom" class="mt-0.5" />
                      <div class="flex flex-col gap-0.5">
                        <span>Set a specific password</span>
                        {#if passwordMode(field) === 'custom'}
                          <Input
                            id={`rp-${field.promptKey}`}
                            type="text"
                            autocomplete="new-password"
                            placeholder="Min 8 chars, 3 of upper/lower/digit/symbol"
                            value={typeof values[field.promptKey] === 'string'
                              ? (values[field.promptKey] as string)
                              : ''}
                            oninput={(e) =>
                              (values[field.promptKey] = (e.target as HTMLInputElement).value)}
                            class="mt-1.5"
                          />
                        {/if}
                      </div>
                    </label>
                  </RadioGroup.Root>
                {:else if field.typeHint === 'boolean'}
                  <label class="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`rp-${field.promptKey}`}
                      checked={Boolean(values[field.promptKey])}
                      onCheckedChange={(c) => (values[field.promptKey] = Boolean(c))}
                    />
                    <span class="text-muted-foreground">
                      {Boolean(values[field.promptKey]) ? 'Yes' : 'No'}
                    </span>
                  </label>
                {:else if field.entityType === 'site'}
                  <RadioGroup.Root
                    value={siteMode(field)}
                    onValueChange={(v) => {
                      siteModes[field.promptKey] = v as 'select' | 'create';
                      values[field.promptKey] = '';
                    }}
                    class="gap-2"
                  >
                    <label class="flex items-start gap-2 text-sm cursor-pointer">
                      <RadioGroup.Item value="select" class="mt-0.5" />
                      <span>Select an existing site</span>
                    </label>
                    <label class="flex items-start gap-2 text-sm cursor-pointer">
                      <RadioGroup.Item value="create" class="mt-0.5" />
                      <span>Create a new site</span>
                    </label>
                  </RadioGroup.Root>
                  {#if siteMode(field) === 'select'}
                    <SingleSelect
                      options={siteOptions}
                      selected={typeof values[field.promptKey] === 'string' ? values[field.promptKey] as string : ''}
                      placeholder={sitesQuery.isLoading ? 'Loading sites…' : 'Choose a site…'}
                      onchange={(v) => (values[field.promptKey] = v)}
                    />
                  {:else}
                    <Input
                      id={`rp-${field.promptKey}`}
                      placeholder="New site name"
                      value={typeof values[field.promptKey] === 'string' ? values[field.promptKey] as string : ''}
                      oninput={(e) => (values[field.promptKey] = (e.target as HTMLInputElement).value)}
                    />
                  {/if}
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
            </section>
          {/each}
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
