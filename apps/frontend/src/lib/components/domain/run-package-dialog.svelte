<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, createQuery } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { STALE } from '$lib/query';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import EntityPicker from './entity-picker.svelte';
  import { fieldLabel } from '$lib/utils/label';
  import Loader from '$lib/components/transition/loader.svelte';

  const GENERATE_PASSWORD_SENTINEL = '__generate__';

  type EntityType =
    | 'integration_link'
    | 'm365_identity'
    | 'm365_group'
    | 'm365_license'
    | 'm365_role'
    | 'sophos_endpoint'
    | 'site';
  type PickerEntityType = Exclude<EntityType, 'site'>;

  type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    packageId?: string;
    linkId?: string | null;
    siteId?: string | null;
    /** Use the normal run-input surface to prepare a future one-time run. */
    scheduleMode?: boolean;
    scheduleId?: string;
    scheduleSnapshot?: {
      id: string;
      name: string;
      version?: number;
      steps: unknown;
      prompts?: unknown;
      outcomeSteps?: unknown;
    };
    initialRuntimeInputs?: Record<string, unknown>;
    initialRunInputState?: {
      siteModes?: Record<string, 'select' | 'create'>;
      skippedStepIndexes?: number[];
    };
    initialSchedule?: {
      siteId?: string | null;
      linkId?: string | null;
      scheduledLocalTime: string;
      timeZone: string;
    };
    onScheduled?: () => void;
    onRequestDeleteSchedule?: () => void;
  };

  let {
    open = $bindable(),
    onOpenChange,
    packageId,
    linkId,
    siteId,
    scheduleMode = false,
    scheduleId,
    scheduleSnapshot,
    initialRuntimeInputs,
    initialRunInputState,
    initialSchedule,
    onScheduled,
    onRequestDeleteSchedule,
  }: Props = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const packagesQuery = createQuery(() => ({
    queryKey: ['packages.list', siteId ?? null, linkId ?? null],
    queryFn: () =>
      trpc.packages.list.query({
        siteId: siteId ?? undefined,
        linkId: linkId ?? undefined,
      }),
    enabled: open,
    staleTime: STALE.LIST,
  }));

  const capabilitiesQuery = createQuery(() => ({
    queryKey: ['packages.metadata.capabilities'],
    queryFn: () => trpc.packages.capabilities.query(),
    enabled: open,
    staleTime: STALE.REF,
  }));

  const isDialogLoading = $derived(
    capabilitiesQuery.isLoading || (!scheduleSnapshot && packagesQuery.isLoading),
  );

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    enabled: open,
    staleTime: STALE.PAGE,
  }));

  const siteOptions = $derived(
    (sitesQuery.data ?? []).map((s: { id: string; name: string }) => ({ value: s.id, label: s.name }))
  );

  let selectedPackageId = $state<string>('');
  let values = $state<Record<string, string | boolean | string[]>>({});
  let passwordModes = $state<Record<string, 'preserve' | 'generate' | 'custom'>>({});
  let siteModes = $state<Record<string, 'select' | 'create'>>({});
  let postalLookupStatus = $state<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  let postalLookupTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedTargetSiteId = $state('');
  let scheduledLocalTime = $state('');
  let scheduleTimeZone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  let startStepIndex = $state(0);
  let skippedSteps = $state<Set<number>>(new Set());

  function defaultLocalTime() {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
  }

  $effect(() => {
    if (open) {
      selectedPackageId = packageId ?? '';
      startStepIndex = 0;
      values = { ...(initialRuntimeInputs ?? {}) } as Record<string, string | boolean | string[]>;
      passwordModes = {};
      siteModes = { ...(initialRunInputState?.siteModes ?? {}) };
      postalLookupStatus = {};
      selectedTargetSiteId = initialSchedule?.siteId ?? '';
      scheduledLocalTime = initialSchedule?.scheduledLocalTime ?? defaultLocalTime();
      scheduleTimeZone = initialSchedule?.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      skippedSteps = new Set(initialRunInputState?.skippedStepIndexes ?? []);
    }
  });

  async function lookupPostalCode(promptKey: string, postalCode: string) {
    const code = postalCode.trim();
    if (code.length < 3) { postalLookupStatus[promptKey] = 'idle'; return; }
    postalLookupStatus[promptKey] = 'loading';
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(code)}&format=json&addressdetails=1&limit=1`,
        { headers: { 'Accept-Language': 'en' } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = (await res.json()) as Array<{ address?: Record<string, string> }>;
      const addr = results[0]?.address;
      if (!addr) { postalLookupStatus[promptKey] = 'idle'; return; }

      const city = addr.city ?? addr.town ?? addr.municipality ?? addr.village ?? addr.hamlet;
      const countryCode = addr.country_code?.toUpperCase();
      const state = addr.state;

      const empty = (key: string) => !String(values[key] ?? '').trim();

      const cityField = runtimeFields.find((f) => f.typeHint === 'city');
      if (cityField && city && empty(cityField.promptKey)) values[cityField.promptKey] = city;

      const countryField = runtimeFields.find((f) => f.typeHint === 'countryCode');
      if (countryField && countryCode && empty(countryField.promptKey)) values[countryField.promptKey] = countryCode;

      const stateField = runtimeFields.find((f) => f.typeHint === 'state');
      if (stateField && state && empty(stateField.promptKey)) values[stateField.promptKey] = state;

      postalLookupStatus[promptKey] = 'done';
    } catch {
      postalLookupStatus[promptKey] = 'error';
    }
  }

  function onPostalCodeInput(promptKey: string, value: string) {
    values[promptKey] = value;
    postalLookupStatus[promptKey] = 'idle';
    if (postalLookupTimer) clearTimeout(postalLookupTimer);
    if (value.trim().length >= 3) {
      postalLookupTimer = setTimeout(() => lookupPostalCode(promptKey, value), 600);
    }
  }

  const selectedPackage = $derived(
    scheduleSnapshot ?? (packagesQuery.data ?? []).find((p) => p.id === selectedPackageId),
  );

  type Binding =
    | { kind: 'literal'; value: unknown }
    | { kind: 'runtime'; promptKey: string; required: boolean }
    | { kind: 'entity'; source: string; entityType: string; contextKey?: string }
    | { kind: 'priorOutput'; stepPosition: number; path: string; lane?: 'main' | 'onSuccess' | 'onFailure' }
    | { kind: 'failureContext'; path: string };

  type Step = {
    capabilityId: string;
    label?: string;
    inputBindings: Record<string, Binding>;
  };

  type PackagePrompt = {
    id: string;
    label: string;
    description?: string;
    required: boolean;
    section?: string;
    order: number;
  };

  type RuntimeField = {
    promptKey: string;
    inputName: string;
    required: boolean;
    typeHint: 'text' | 'boolean' | 'stringArray' | 'password' | 'upn' | 'postalCode' | 'city' | 'countryCode' | 'state';
    sensitive: boolean;
    entityType?: EntityType;
    label?: string;
    description?: string;
    choices?: ReadonlyArray<{ value: string; label: string }>;
    dynamicSource?: string;
    section?: string;
    order?: number;
    visibleWhen?: { input: string; equals: unknown };
  };

  type StepGroup = {
    id: string;
    lane: 'main' | 'onSuccess' | 'onFailure';
    position: number;
    capabilityId: string;
    capabilityName: string;
    category: string;
    fields: RuntimeField[];
    optional: boolean;
    hasWiredOutputs: boolean;
  };

  // Walks steps in order and groups runtime fields by the step they first
  // appear in. inputMeta key order is preserved within each step so the
  // form renders fields in the same order the capability declares them.
  const stepGroups = $derived.by<StepGroup[]>(() => {
    if (!selectedPackage || !capabilitiesQuery.data) return [];
    const capMeta = new Map(capabilitiesQuery.data.map((c) => [c.id, c]));
    const promptMap = new Map(
      ((selectedPackage.prompts as PackagePrompt[] | null) ?? []).map((prompt) => [prompt.id, prompt]),
    );
    const seenKeys = new Set<string>();
    const groups: StepGroup[] = [];
    const mainSteps = (selectedPackage.steps as Step[]) ?? [];
    const outcomeSteps = (selectedPackage.outcomeSteps as {
      onSuccess?: Step[];
      onFailure?: Step[];
    } | null) ?? {};
    const lanes: Array<{ lane: StepGroup['lane']; steps: Step[] }> = [
      { lane: 'main', steps: mainSteps },
      { lane: 'onSuccess', steps: outcomeSteps.onSuccess ?? [] },
      { lane: 'onFailure', steps: outcomeSteps.onFailure ?? [] },
    ];

    // Determine which step positions have downstream priorOutput dependencies.
    const positionsWithWiredOutputs = new Set<number>();
    for (const step of [...mainSteps, ...(outcomeSteps.onSuccess ?? [])]) {
      for (const binding of Object.values(step.inputBindings as Record<string, Binding>)) {
        if (binding.kind === 'priorOutput' && (binding.lane ?? 'main') === 'main') {
          positionsWithWiredOutputs.add(binding.stepPosition);
        }
      }
    }

    for (const { lane, steps } of lanes) {
      for (let pos = 0; pos < steps.length; pos++) {
        const step = steps[pos]!;
        const cap = capMeta.get(step.capabilityId);
        if (!cap) continue;

        const fields: RuntimeField[] = [];
        // Iterate inputMeta keys in declaration order to preserve field sequence.
        for (const [inputName, meta] of Object.entries(
          cap.inputMeta as Record<string, {
            sensitive?: boolean;
            typeHint?: RuntimeField['typeHint'];
            entityType?: EntityType;
            label?: string;
            description?: string;
            required?: boolean;
            choices?: ReadonlyArray<{ value: string; label: string }>;
            dynamicSource?: string;
            visibleWhen?: { input: string; equals: unknown };
          }>
        )) {
          const binding = (step.inputBindings as Record<string, Binding>)[inputName];
          if (!binding || binding.kind !== 'runtime') continue;
          if (seenKeys.has(binding.promptKey)) continue;
          const prompt = promptMap.get(binding.promptKey);
          seenKeys.add(binding.promptKey);
          fields.push({
            promptKey: binding.promptKey,
            inputName,
            required: prompt?.required ?? binding.required,
            typeHint: meta.typeHint ?? 'text',
            sensitive: meta.sensitive ?? false,
            entityType: meta.entityType,
            label: prompt?.label ?? meta.label,
            description: prompt?.description ?? meta.description,
            choices: meta.choices,
            dynamicSource: meta.dynamicSource,
            section: prompt?.section,
            order: prompt?.order,
            visibleWhen: meta.visibleWhen,
          });
        }

        groups.push({
          id: `${lane}:${pos}`,
          lane,
          position: pos,
          capabilityId: step.capabilityId,
          capabilityName: step.label ?? cap.name,
          category: cap.category,
          fields,
          optional: lane === 'main' && !!(step as any).optional,
          hasWiredOutputs: lane === 'main' && positionsWithWiredOutputs.has(pos),
        });
      }
    }
    return groups;
  });

  // Flat list of runtime fields for non-skipped steps (drives canSubmit / cascadeLinkId / postal autofill).
  const runtimeFields = $derived(
    stepGroups
      .filter((g) => g.lane !== 'main' || !skippedSteps.has(g.position))
      .flatMap((g) => g.fields)
      .filter((field) => isFieldVisible(field))
  );

  // Device operations need a concrete site before their endpoint picker can
  // be useful. Page-level launches already provide one; the automation page
  // asks once here and persists it as the run target.
  const needsSiteTarget = $derived(
    runtimeFields.some((field) => field.entityType === 'sophos_endpoint'),
  );
  const effectiveSiteId = $derived(siteId ?? (selectedTargetSiteId || undefined));
  const effectiveLinkId = $derived(linkId ?? undefined);

  function controllingValue(inputName: string): unknown {
    if (!selectedPackage) return undefined;
    const outcomeSteps = (selectedPackage.outcomeSteps as { onSuccess?: Step[]; onFailure?: Step[] } | null) ?? {};
    const steps = [
      ...((selectedPackage.steps as Step[]) ?? []),
      ...(outcomeSteps.onSuccess ?? []),
      ...(outcomeSteps.onFailure ?? []),
    ];
    for (const step of steps) {
      const binding = step.inputBindings[inputName];
      if (!binding) continue;
      if (binding.kind === 'literal') return binding.value;
      if (binding.kind === 'runtime') return values[binding.promptKey];
    }
    return undefined;
  }

  function isFieldVisible(field: RuntimeField): boolean {
    if (!field.visibleWhen) return true;
    return controllingValue(field.visibleWhen.input) === field.visibleWhen.equals;
  }

  const TENANT_SCOPED_ENTITY_TYPES = new Set([
    'm365_identity',
    'm365_group',
    'm365_license',
    'm365_role',
  ]);

  // When tenant-scoped entity fields exist but no explicit integration_link runtime
  // field is declared and no linkId prop was passed, show a synthetic tenant picker.
  const needsSyntheticTenantPicker = $derived(
    !effectiveLinkId &&
    !runtimeFields.some((f) => f.entityType === 'integration_link') &&
    runtimeFields.some((f) => f.entityType && TENANT_SCOPED_ENTITY_TYPES.has(f.entityType)),
  );

  const SYNTHETIC_LINK_KEY = '__syntheticTenantLinkId';

  const cascadeLinkId = $derived.by<string | undefined>(() => {
    for (const field of runtimeFields) {
      if (field.entityType !== 'integration_link') continue;
      const raw = values[field.promptKey];
      if (typeof raw === 'string' && raw.length > 0) return raw;
    }
    if (needsSyntheticTenantPicker) {
      const raw = values[SYNTHETIC_LINK_KEY];
      if (typeof raw === 'string' && raw.length > 0) return raw;
    }
    return effectiveLinkId;
  });

  const hasCovePartnerField = $derived(
    runtimeFields.some((f) => f.dynamicSource === 'coveChildPartners')
  );

  const covePartnersQuery = createQuery(() => ({
    queryKey: ['vendor.coveChildPartners'],
    queryFn: () => trpc.vendor.coveChildPartners.query(),
    enabled: open && hasCovePartnerField,
    staleTime: STALE.REF,
  }));

  const covePartnerOptions = $derived([
    { value: '', label: 'None (root account)' },
    ...(covePartnersQuery.data ?? []).map((p) => ({ value: p.name, label: p.name })),
  ]);
  const domainsQuery = createQuery(() => ({
    queryKey: ['vendor.m365DomainOptions', cascadeLinkId],
    queryFn: () =>
      trpc.vendor.m365DomainOptions.query({ linkId: cascadeLinkId! }),
    enabled: !!cascadeLinkId,
    staleTime: STALE.PAGE,
  }));

  const domainOptions = $derived(
    (domainsQuery.data ?? []).map((d) => ({
      value: d.domain,
      label: d.isDefault ? `${d.domain} (default)` : d.domain,
    })),
  );

  // Halo enum dropdowns — priorities, ticket types, categories. All three
  // refresh on every dialog open (staleTime: 0) and on window focus so the
  // author sees the current Halo config without a manual refresh.
  const hasHaloPriorityField = $derived(
    runtimeFields.some((f) => f.dynamicSource === 'halopsaTicketPriorities')
  );
  const hasHaloTicketTypeField = $derived(
    runtimeFields.some((f) => f.dynamicSource === 'halopsaTicketTypes')
  );
  const hasHaloCategoryField = $derived(
    runtimeFields.some((f) => f.dynamicSource === 'halopsaTicketCategories')
  );

  const haloPrioritiesQuery = createQuery(() => ({
    queryKey: ['vendor.halopsaTicketPriorities'],
    queryFn: () => trpc.vendor.halopsaTicketPriorities.query(),
    enabled: open && hasHaloPriorityField,
    staleTime: 0,
    refetchOnWindowFocus: true,
  }));
  const haloPriorityOptions = $derived(
    (haloPrioritiesQuery.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
  );

  const haloTicketTypesQuery = createQuery(() => ({
    queryKey: ['vendor.halopsaTicketTypes'],
    queryFn: () => trpc.vendor.halopsaTicketTypes.query(),
    enabled: open && hasHaloTicketTypeField,
    staleTime: 0,
    refetchOnWindowFocus: true,
  }));
  const haloTicketTypeOptions = $derived(
    (haloTicketTypesQuery.data ?? []).map((t) => ({ value: String(t.id), label: t.name })),
  );

  const haloCategoriesQuery = createQuery(() => ({
    queryKey: ['vendor.halopsaTicketCategories'],
    queryFn: () => trpc.vendor.halopsaTicketCategories.query(),
    enabled: open && hasHaloCategoryField,
    staleTime: 0,
    refetchOnWindowFocus: true,
  }));
  // Halo persists category_1 by name, not id — the value stored on the run
  // input matches what create-ticket expects.
  const haloCategoryOptions = $derived(
    (haloCategoriesQuery.data ?? []).map((c) => ({ value: c.name, label: c.name })),
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

  const start = createMutation(() => ({
    mutationFn: (args: {
      packageId: string;
      runtimeInputs: Record<string, unknown>;
      siteId?: string;
      startStepIndex: number;
      skippedStepIndexes: number[];
    }) =>
      trpc.packageRuns.start.mutate({
        packageId: args.packageId,
        linkId: cascadeLinkId ?? effectiveLinkId ?? null,
        siteId: args.siteId ?? null,
        runtimeInputs: args.runtimeInputs,
        startStepIndex: args.startStepIndex,
        skippedStepIndexes: args.skippedStepIndexes,
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

  const saveSchedule = createMutation(() => ({
    mutationFn: (args: {
      packageId: string;
      runtimeInputs: Record<string, unknown>;
      siteId?: string;
      linkId?: string;
    }) => {
      const payload = {
        siteId: args.siteId ?? null,
        linkId: args.linkId ?? null,
        runtimeInputs: args.runtimeInputs,
        runInputState: {
          siteModes,
          skippedStepIndexes: [...skippedSteps],
        },
        scheduledLocalTime,
        timeZone: scheduleTimeZone,
      };
      return scheduleId
        ? trpc.packageRuns.updateSchedule.mutate({ id: scheduleId, ...payload })
        : trpc.packageRuns.schedule.mutate({ packageId: args.packageId, ...payload });
    },
    onSuccess: () => {
      onOpenChange(false);
      toast.success(scheduleId ? 'Schedule updated' : 'Package scheduled');
      onScheduled?.();
    },
    onError: (err) => toast.error(err.message ?? 'Unable to save schedule'),
  }));

  function passwordMode(field: RuntimeField): 'preserve' | 'generate' | 'custom' {
    if (passwordModes[field.promptKey]) return passwordModes[field.promptKey];
    // Do not quietly replace a previously approved password when a tech opens
    // a scheduled run just to check its other inputs.
    if (scheduleMode && !!scheduleId && values[field.promptKey] !== undefined) return 'preserve';
    return 'generate';
  }

  function siteMode(field: RuntimeField): 'select' | 'create' {
    return siteModes[field.promptKey] ?? 'select';
  }

  function isBlockedByTenant(field: RuntimeField): boolean {
    if (field.typeHint === 'upn') return !cascadeLinkId;
    if (!field.entityType || field.entityType === 'integration_link') return false;
    if (!TENANT_SCOPED_ENTITY_TYPES.has(field.entityType)) return false;
    return !cascadeLinkId;
  }

  function isPickerEntityType(entityType: EntityType | undefined): entityType is PickerEntityType {
    return (
      entityType === 'integration_link' ||
      entityType === 'm365_identity' ||
      entityType === 'm365_group' ||
      entityType === 'm365_license' ||
      entityType === 'm365_role' ||
      entityType === 'sophos_endpoint'
    );
  }

  function coerce(field: RuntimeField, raw: string | boolean | string[] | undefined): unknown {
    if (field.typeHint === 'boolean') return Boolean(raw);
    if (field.typeHint === 'password') {
      if (passwordMode(field) === 'preserve') return raw;
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
    if (scheduleMode && (!scheduledLocalTime || !scheduleTimeZone)) return false;
    if (needsSiteTarget && !effectiveSiteId) return false;
    if (needsSyntheticTenantPicker && !cascadeLinkId) return false;
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
        if (passwordMode(field) === 'preserve') continue;
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
    const runtimeInputs: Record<string, unknown> = {};
    for (const field of runtimeFields) {
      runtimeInputs[field.promptKey] = coerce(field, values[field.promptKey]);
    }
    if (scheduleMode) {
      saveSchedule.mutate({
        packageId: selectedPackage.id,
        runtimeInputs,
        siteId: effectiveSiteId,
        // Integration-link runtime inputs are already part of the package
        // form. Use that selected value as the run context when present.
        linkId: cascadeLinkId,
      });
    } else {
      start.mutate({
        packageId: selectedPackage.id,
        runtimeInputs,
        siteId: effectiveSiteId,
        startStepIndex,
        skippedStepIndexes: [...skippedSteps],
      });
    }
  }

  const packageOptions = $derived(
    (packagesQuery.data ?? [])
      .filter((p) => p.status === 'active')
      .map((p) => ({ value: p.id, label: p.name })),
  );

  const TIME_ZONE_SHORTCUTS = [
    { value: 'America/New_York', label: 'Eastern — New York (EST/EDT)' },
    { value: 'America/Chicago', label: 'Central — Chicago (CST/CDT)' },
    { value: 'America/Denver', label: 'Mountain — Denver (MST/MDT)' },
    { value: 'America/Phoenix', label: 'Arizona — Phoenix (MST, no DST)' },
    { value: 'America/Los_Angeles', label: 'Pacific — Los Angeles (PST/PDT)' },
    { value: 'America/Anchorage', label: 'Alaska — Anchorage (AKST/AKDT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii — Honolulu (HST)' },
  ];
  const scheduleTimeZoneOptions = $derived([
    ...TIME_ZONE_SHORTCUTS,
    ...Intl.supportedValuesOf('timeZone')
      .filter((timeZone) => !TIME_ZONE_SHORTCUTS.some((shortcut) => shortcut.value === timeZone))
      .map((timeZone) => ({ value: timeZone, label: timeZone })),
  ]);

</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content
    class="sm:max-w-[600px] max-h-[85vh] overflow-hidden grid-rows-[auto_1fr_auto]"
  >
    <Dialog.Header>
      <Dialog.Title>{scheduleMode ? (scheduleId ? 'Review scheduled run' : 'Schedule package') : 'Run a package'}</Dialog.Title>
      <Dialog.Description>
        {#if scheduleMode}
          Set the exact answers this run will use. You can reopen it to review or change those answers until it dispatches.
        {:else}
          Fill in the runtime inputs before this executes.
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body class="p-0">

    <div class="space-y-4 overflow-y-auto px-1 pb-2 pt-1">
      {#if isDialogLoading}
        <div class="flex min-h-64 items-center justify-center px-3 py-8">
          <Loader size={32}>Loading package inputs…</Loader>
        </div>
      {:else}
      {#if !packageId}
        <section class="space-y-2 px-3">
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
        {#if scheduleMode}
          <section class="mx-3 rounded-lg border border-sky-500/25 bg-sky-500/[0.04] p-3 space-y-4">
            <div>
              <div class="text-sm font-medium">When</div>
              <p class="mt-0.5 text-xs text-muted-foreground">
                This snapshot runs once using the package inputs below. Edit it here any time before dispatch.
              </p>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid gap-1.5">
                <Label for="scheduled-local-time">Run date and time</Label>
                <Input id="scheduled-local-time" type="datetime-local" bind:value={scheduledLocalTime} />
              </div>
              <div class="grid gap-1.5">
                <Label>Time zone</Label>
                <SingleSelect
                  options={scheduleTimeZoneOptions}
                  selected={scheduleTimeZone}
                  placeholder="Choose a time zone"
                  disableSort
                  onchange={(value) => (scheduleTimeZone = value)}
                />
              </div>
            </div>
            <p class="text-[11px] text-muted-foreground">
              Search EST, CST, MST, or PST. The saved IANA zone keeps daylight-saving time correct.
            </p>
          </section>
        {/if}
        {#if needsSiteTarget && !siteId}
          <section class="rounded-lg border border-sky-500/25 bg-sky-500/[0.04] px-3 py-3 space-y-2">
            <Label class="text-sm font-medium">Target site<span class="text-rose-500 ml-0.5">*</span></Label>
            <p class="text-xs text-muted-foreground">
              Endpoint choices are limited to this site and the run is recorded against it.
            </p>
            <SingleSelect
              options={siteOptions}
              selected={selectedTargetSiteId}
              placeholder={sitesQuery.isLoading ? 'Loading sites…' : 'Choose a site…'}
              onchange={(v) => (selectedTargetSiteId = v)}
            />
          </section>
        {/if}
        {#if needsSyntheticTenantPicker}
          <section class="rounded-lg border border-sky-500/25 bg-sky-500/[0.04] px-3 py-3 space-y-2">
            <Label class="text-sm font-medium">Microsoft 365 tenant<span class="text-rose-500 ml-0.5">*</span></Label>
            <p class="text-xs text-muted-foreground">
              Choose the tenant whose identities this package will act on.
            </p>
            <EntityPicker
              entityType="integration_link"
              integrationId="microsoft-365"
              multiple={false}
              value={typeof values[SYNTHETIC_LINK_KEY] === 'string' ? values[SYNTHETIC_LINK_KEY] as string : null}
              onValueChange={(v) => { if (typeof v === 'string' || v === null) values[SYNTHETIC_LINK_KEY] = v ?? ''; }}
              placeholder="Choose a tenant…"
            />
          </section>
        {/if}
        {#if stepGroups.length > 0}
          {#each stepGroups as group (group.id)}
            {#if group.lane === 'onFailure' && !stepGroups.some((candidate) => candidate.lane === 'onFailure' && candidate.position < group.position)}
              <section class="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-3">
                <h3 class="text-sm font-medium text-foreground">On failure inputs</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Only failure reactions use these answers. They are kept out of the normal package inputs.
                </p>
              </section>
            {/if}
            {@const isSkipped = group.lane === 'main' && skippedSteps.has(group.position)}
            {@const canSkip = group.optional && !group.hasWiredOutputs}
            {@const visibleFields = group.fields.filter((field) => isFieldVisible(field))}
            <div class="rounded-lg border overflow-hidden {isSkipped ? 'opacity-50' : ''}">
              <!-- Step header -->
              <div class="flex items-center gap-2.5 px-3 py-2 bg-muted/40 border-b">
                <span class="text-[10px] font-mono tabular-nums text-muted-foreground/60 select-none">
                  {String(group.position + 1).padStart(2, '0')}
                </span>
                <span class="text-sm font-medium truncate {isSkipped ? 'line-through text-muted-foreground' : ''}">
                  {group.capabilityName}
                </span>
                {#if group.optional}
                  <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-sky-500/10 text-sky-700 dark:text-sky-400">
                    optional
                  </span>
                {/if}
                <span class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-muted text-muted-foreground">
                  {group.lane === 'onFailure' ? 'On failure' : group.category}
                </span>
                {#if canSkip}
                  <label class="flex items-center gap-1.5 cursor-pointer shrink-0">
                    <Checkbox
                      checked={isSkipped}
                      onCheckedChange={(c) => {
                        const next = new Set(skippedSteps);
                        if (c) next.add(group.position); else next.delete(group.position);
                        skippedSteps = next;
                      }}
                    />
                    <span class="text-xs text-muted-foreground select-none">Skip</span>
                  </label>
                {/if}
              </div>

              {#if !isSkipped}
                {#if visibleFields.length > 0}
                  <!-- Fields -->
                  <div class="space-y-4 p-3">
                    {#each visibleFields as field (field.promptKey)}
                      {@const label = fieldLabel(field.promptKey, field.label)}
                      {@const blocked = isBlockedByTenant(field)}
                      <div class="space-y-1.5">
                        <Label for={`rp-${field.promptKey}`} class="text-sm">
                          {label}
                          {#if field.required}<span class="text-rose-500 ml-0.5">*</span>{/if}
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
                                  writeUpn(field.promptKey, (e.target as HTMLInputElement).value, parsed.domain)}
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
                        {:else if isPickerEntityType(field.entityType)}
                          {#if field.entityType === 'sophos_endpoint' && !effectiveSiteId}
                            <div class="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                              Choose the target site first.
                            </div>
                          {:else if blocked}
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
                              siteId={field.entityType === 'sophos_endpoint' ? effectiveSiteId : undefined}
                              multiple={field.typeHint === 'stringArray'}
                              value={values[field.promptKey] as string | string[] | null | undefined ??
                                (field.typeHint === 'stringArray' ? [] : null)}
                              onValueChange={(v) => (values[field.promptKey] = v as any)}
                              placeholder="Choose…"
                            />
                          {/if}
                        {:else if field.entityType === 'site'}
                          <RadioGroup.Root
                            value={siteMode(field)}
                            onValueChange={(v) => {
                              siteModes[field.promptKey] = v as 'select' | 'create';
                              values[field.promptKey] = '';
                            }}
                            class="flex gap-4"
                          >
                            <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                              <RadioGroup.Item value="select" />
                              <span>Select existing</span>
                            </label>
                            <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                              <RadioGroup.Item value="create" />
                              <span>Create new</span>
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
                        {:else if field.typeHint === 'password'}
                          <RadioGroup.Root
                            value={passwordMode(field)}
                            onValueChange={(v) =>
                              (passwordModes[field.promptKey] = v as 'preserve' | 'generate' | 'custom')}
                            class="gap-2"
                          >
                            {#if scheduleMode && scheduleId && values[field.promptKey] !== undefined}
                              <label class="flex items-start gap-2 text-sm cursor-pointer">
                                <RadioGroup.Item value="preserve" class="mt-0.5" />
                                <div class="flex flex-col gap-0.5">
                                  <span>Keep the saved value</span>
                                  <span class="text-xs text-muted-foreground">Leave this selected when reviewing other schedule details.</span>
                                </div>
                              </label>
                            {/if}
                            <label class="flex items-start gap-2 text-sm cursor-pointer">
                              <RadioGroup.Item value="generate" class="mt-0.5" />
                              <div class="flex flex-col gap-0.5">
                                <span>Generate a strong random password</span>
                                <span class="text-xs text-muted-foreground">
                                  Shown once after the run — copy it from the run detail.
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
                        {:else if field.typeHint === 'postalCode'}
                          <div class="relative">
                            <Input
                              id={`rp-${field.promptKey}`}
                              value={typeof values[field.promptKey] === 'string' ? (values[field.promptKey] as string) : ''}
                              placeholder="e.g. 10115 or 90210"
                              oninput={(e) => onPostalCodeInput(field.promptKey, (e.target as HTMLInputElement).value)}
                            />
                            {#if postalLookupStatus[field.promptKey] === 'loading'}
                              <span class="absolute right-3 top-2.5 text-xs text-muted-foreground animate-pulse">
                                Looking up…
                              </span>
                            {:else if postalLookupStatus[field.promptKey] === 'done'}
                              <span class="absolute right-3 top-2.5 text-xs text-emerald-600 dark:text-emerald-400">
                                ✓ Auto-filled
                              </span>
                            {/if}
                          </div>
                        {:else if field.dynamicSource === 'coveChildPartners'}
                          <SingleSelect
                            options={covePartnerOptions}
                            selected={typeof values[field.promptKey] === 'string' ? values[field.promptKey] as string : ''}
                            placeholder={covePartnersQuery.isLoading ? 'Loading partners…' : 'Choose a Cove partner…'}
                            onchange={(v) => (values[field.promptKey] = v)}
                          />
                        {:else if field.dynamicSource === 'm365DomainOptions'}
                          <SingleSelect
                            options={domainOptions}
                            selected={typeof values[field.promptKey] === 'string' ? values[field.promptKey] as string : ''}
                            placeholder={!cascadeLinkId
                              ? 'Choose a tenant first…'
                              : domainsQuery.isLoading
                                ? 'Loading verified domains…'
                                : 'Choose a verified domain…'}
                            disabled={!cascadeLinkId}
                            onchange={(v) => (values[field.promptKey] = v)}
                          />
                        {:else if field.dynamicSource === 'halopsaTicketPriorities'}
                          <SingleSelect
                            options={haloPriorityOptions}
                            selected={values[field.promptKey] != null ? String(values[field.promptKey]) : ''}
                            placeholder={haloPrioritiesQuery.isLoading ? 'Loading priorities…' : 'Choose a priority…'}
                            onchange={(v) => (values[field.promptKey] = v)}
                          />
                        {:else if field.dynamicSource === 'halopsaTicketTypes'}
                          <SingleSelect
                            options={haloTicketTypeOptions}
                            selected={values[field.promptKey] != null ? String(values[field.promptKey]) : ''}
                            placeholder={haloTicketTypesQuery.isLoading ? 'Loading ticket types…' : 'Choose a ticket type…'}
                            onchange={(v) => (values[field.promptKey] = v)}
                          />
                        {:else if field.dynamicSource === 'halopsaTicketCategories'}
                          <SingleSelect
                            options={haloCategoryOptions}
                            selected={typeof values[field.promptKey] === 'string' ? values[field.promptKey] as string : ''}
                            placeholder={haloCategoriesQuery.isLoading ? 'Loading categories…' : 'Choose a category…'}
                            onchange={(v) => (values[field.promptKey] = v)}
                          />
                        {:else if field.typeHint === 'stringArray' && field.choices && field.choices.length > 0}
                          <MultiSelect
                            options={field.choices as { value: string; label: string }[]}
                            selected={Array.isArray(values[field.promptKey]) ? values[field.promptKey] as string[] : []}
                            placeholder="Choose one or more…"
                            onchange={(v) => (values[field.promptKey] = v)}
                          />
                        {:else if field.choices && field.choices.length > 0}
                          {#if field.choices.length <= 4}
                            <RadioGroup.Root
                              value={typeof values[field.promptKey] === 'string' ? values[field.promptKey] as string : ''}
                              onValueChange={(v) => (values[field.promptKey] = v)}
                              class="flex flex-wrap gap-x-5 gap-y-2"
                            >
                              {#each field.choices as choice (choice.value)}
                                <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                                  <RadioGroup.Item value={choice.value} />
                                  <span>{choice.label}</span>
                                </label>
                              {/each}
                            </RadioGroup.Root>
                          {:else}
                            <SingleSelect
                              options={field.choices as { value: string; label: string }[]}
                              selected={typeof values[field.promptKey] === 'string' ? values[field.promptKey] as string : ''}
                              placeholder="Choose…"
                              onchange={(v) => (values[field.promptKey] = v)}
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
                  </div>
                {:else}
                  <!-- No runtime inputs needed -->
                  <div class="px-3 py-2.5 text-xs text-muted-foreground italic">
                    No input required — runs automatically.
                  </div>
                {/if}
              {:else}
                <!-- Skipped state -->
                <div class="px-3 py-2.5 text-xs text-muted-foreground italic">
                  This step will be skipped.
                </div>
              {/if}
            </div>
          {/each}
        {/if}

      {/if}
      {/if}
    </div>


    </Dialog.Body><Dialog.Footer>
      {#if scheduleMode && scheduleId && onRequestDeleteSchedule}
        <Button variant="destructive" onclick={onRequestDeleteSchedule}>Delete schedule</Button>
      {/if}
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button
        onclick={submit}
        disabled={isDialogLoading || !canSubmit() || start.isPending || saveSchedule.isPending}
      >
        {#if scheduleMode}
          {saveSchedule.isPending ? 'Saving…' : scheduleId ? 'Save changes' : 'Schedule run'}
        {:else}
          {start.isPending ? 'Starting…' : 'Run'}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
