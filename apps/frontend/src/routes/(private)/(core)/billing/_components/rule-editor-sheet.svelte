<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { Separator } from '$lib/components/ui/separator';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Save from '@lucide/svelte/icons/save';
  import { formatMoney } from '$lib/utils/format';

  type PsaField = 'itemName' | 'externalId';
  type PsaOperator = 'contains' | 'eq';
  type VendorOperator = 'eq' | 'neq' | 'is_null' | 'is_not_null';

  type FacetColumn = {
    column: string;
    label: string;
    kind: 'string' | 'boolean' | 'null' | 'enum';
    options?: Array<{ value: string; label: string }>;
  };

  type FacetConfig = {
    facet: string;
    providerId: string;
    label: string;
    filterColumns: FacetColumn[];
    defaultFilters: Array<{ column: string; operator: VendorOperator; value?: string | boolean }>;
  };

  type VendorFilterUI = {
    id: string;
    column: string;
    operator: VendorOperator;
    value?: string;
  };

  type ScopeMode = 'include' | 'exclude';
  type ScopeTarget = 'site' | 'site_group' | 'all';
  type ScopeInput = {
    mode: ScopeMode;
    targetType: ScopeTarget;
    siteId?: string | null;
    siteGroupId?: string | null;
  };

  type RuleInput = {
    id?: string;
    name: string;
    enabled: boolean;
    scopes: ScopeInput[];
    psaItemMatch: {
      field: PsaField;
      operator: PsaOperator;
      value: string;
    };
    vendorProvider: string;
    vendorFacet: string;
    vendorFilters: Array<{
      column: string;
      operator: VendorOperator;
      value?: string | boolean;
    }>;
    countMode: 'count_rows';
  };

  type SiteOption = { id: string; name: string };
  type SiteGroupOption = { id: string; name: string; siteIds?: string[] };
  type EditingRule = Omit<RuleInput, 'scopes'> & { scopes?: ScopeInput[] };

  let {
    open = $bindable(),
    editingRule,
    sites: siteList,
    siteGroups: siteGroupList,
  }: {
    open: boolean;
    editingRule: EditingRule | null;
    sites: SiteOption[];
    siteGroups: SiteGroupOption[];
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const facetsQuery = createQuery(() => ({
    queryKey: ['billing.facets'],
    queryFn: () => trpc.billing.facets.query(),
    staleTime: 60_000
  }));

  const allFacets = $derived<FacetConfig[]>(
    (facetsQuery.data ?? []) as FacetConfig[]
  );

  let name = $state('');
  let enabled = $state(true);
  let includeAll = $state(true);
  let includeSiteIds = $state<string[]>([]);
  let includeGroupIds = $state<string[]>([]);
  let excludeSiteIds = $state<string[]>([]);
  let excludeGroupIds = $state<string[]>([]);
  let psaField = $state<PsaField>('itemName');
  let psaOperator = $state<PsaOperator>('contains');
  let psaValue = $state('');
  let vendorProvider = $state<string>('');
  let vendorFacet = $state<string>('');
  let vendorFilters = $state<VendorFilterUI[]>([]);
  let editingId = $state<string | undefined>(undefined);

  const providerOptions = $derived(
    Array.from(new Set(allFacets.map((f) => f.providerId))).map((id) => ({
      value: id,
      label: id,
    }))
  );

  const facetsForProvider = $derived(
    allFacets.filter((f) => !vendorProvider || f.providerId === vendorProvider)
  );

  const facetOptions = $derived(
    facetsForProvider.map((f) => ({ value: f.facet, label: f.label }))
  );

  const selectedFacet = $derived<FacetConfig | null>(
    allFacets.find((f) => f.facet === vendorFacet) ?? null
  );

  const columnOptions = $derived(
    (selectedFacet?.filterColumns ?? []).map((c) => ({ value: c.column, label: c.label }))
  );

  const VENDOR_OPERATORS: Array<{ value: VendorOperator; label: string; needsValue: boolean }> = [
    { value: 'eq', label: 'equals', needsValue: true },
    { value: 'neq', label: 'not equals', needsValue: true },
    { value: 'is_null', label: 'is not set', needsValue: false },
    { value: 'is_not_null', label: 'is set', needsValue: false },
  ];

  const psaFieldOptions = [
    { value: 'itemName', label: 'Item name' },
    { value: 'externalId', label: 'External ID' },
  ];
  const psaOperatorOptions = [
    { value: 'contains', label: 'contains' },
    { value: 'eq', label: 'equals' },
  ];
  const vendorOperatorOptions = VENDOR_OPERATORS.map((o) => ({ value: o.value, label: o.label }));
  const booleanOptions = [
    { value: 'true', label: 'true' },
    { value: 'false', label: 'false' },
  ];
  const siteOptions = $derived(
    siteList.map((site) => ({ value: site.id, label: site.name })),
  );
  const groupOptions = $derived(
    siteGroupList.map((group) => ({
      value: group.id,
      label: `${group.name}${group.siteIds ? ` (${group.siteIds.length})` : ''}`,
    })),
  );

  function makeFilterId() {
    return Math.random().toString(36).slice(2);
  }

  function findColumn(facet: FacetConfig | null, column: string): FacetColumn | undefined {
    return facet?.filterColumns.find((c) => c.column === column);
  }

  function defaultValueForColumn(col: FacetColumn | undefined): string | undefined {
    if (!col) return '';
    if (col.kind === 'boolean') return 'true';
    if (col.kind === 'enum') return col.options?.[0]?.value ?? '';
    if (col.kind === 'null') return undefined;
    return '';
  }

  function defaultOperatorForColumn(col: FacetColumn | undefined): VendorOperator {
    if (!col) return 'eq';
    if (col.kind === 'null') return 'is_null';
    return 'eq';
  }

  function seedFiltersFromFacet(facet: FacetConfig | null): VendorFilterUI[] {
    if (!facet) return [];
    return (facet.defaultFilters ?? []).map((filter) => ({
      id: makeFilterId(),
      column: filter.column,
      operator: filter.operator,
      value:
        filter.value === undefined || filter.value === null
          ? undefined
          : String(filter.value),
    }));
  }

  function applyScopes(scopes: ScopeInput[] | undefined) {
    includeAll = false;
    includeSiteIds = [];
    includeGroupIds = [];
    excludeSiteIds = [];
    excludeGroupIds = [];
    for (const scope of scopes ?? []) {
      if (scope.mode === 'include') {
        if (scope.targetType === 'all') includeAll = true;
        else if (scope.targetType === 'site' && scope.siteId)
          includeSiteIds = [...includeSiteIds, scope.siteId];
        else if (scope.targetType === 'site_group' && scope.siteGroupId)
          includeGroupIds = [...includeGroupIds, scope.siteGroupId];
      } else {
        if (scope.targetType === 'site' && scope.siteId)
          excludeSiteIds = [...excludeSiteIds, scope.siteId];
        else if (scope.targetType === 'site_group' && scope.siteGroupId)
          excludeGroupIds = [...excludeGroupIds, scope.siteGroupId];
      }
    }
  }

  function seedFromRule(rule: EditingRule | null, facets: FacetConfig[]) {
    if (rule) {
      editingId = rule.id;
      name = rule.name;
      enabled = rule.enabled;
      applyScopes(rule.scopes);
      psaField = rule.psaItemMatch.field;
      psaOperator = rule.psaItemMatch.operator;
      psaValue = rule.psaItemMatch.value;
      vendorProvider = rule.vendorProvider;
      vendorFacet = rule.vendorFacet;
      vendorFilters = (rule.vendorFilters ?? []).map((filter) => ({
        id: makeFilterId(),
        column: filter.column,
        operator: filter.operator,
        value: filter.value == null ? undefined : String(filter.value),
      }));
    } else {
      editingId = undefined;
      name = '';
      enabled = true;
      includeAll = true;
      includeSiteIds = [];
      includeGroupIds = [];
      excludeSiteIds = [];
      excludeGroupIds = [];
      psaField = 'itemName';
      psaOperator = 'contains';
      psaValue = '';
      const first = facets[0] ?? null;
      vendorProvider = first?.providerId ?? '';
      vendorFacet = first?.facet ?? '';
      vendorFilters = seedFiltersFromFacet(first);
    }
  }

  let openTrack = $state(false);
  $effect(() => {
    if (open && !openTrack && allFacets.length > 0) {
      seedFromRule(editingRule, allFacets);
    }
    openTrack = open;
  });

  const scopeDraft = $derived<ScopeInput[]>([
    ...(includeAll ? ([{ mode: 'include', targetType: 'all' }] as ScopeInput[]) : []),
    ...includeSiteIds.map<ScopeInput>((id) => ({
      mode: 'include',
      targetType: 'site',
      siteId: id,
    })),
    ...includeGroupIds.map<ScopeInput>((id) => ({
      mode: 'include',
      targetType: 'site_group',
      siteGroupId: id,
    })),
    ...excludeSiteIds.map<ScopeInput>((id) => ({
      mode: 'exclude',
      targetType: 'site',
      siteId: id,
    })),
    ...excludeGroupIds.map<ScopeInput>((id) => ({
      mode: 'exclude',
      targetType: 'site_group',
      siteGroupId: id,
    })),
  ]);

  const hasInclude = $derived(
    includeAll || includeSiteIds.length > 0 || includeGroupIds.length > 0,
  );

  const ruleDraft = $derived<RuleInput>({
    ...(editingId ? { id: editingId } : {}),
    name: name.trim() || 'Untitled rule',
    enabled,
    scopes: scopeDraft,
    psaItemMatch: {
      field: psaField,
      operator: psaOperator,
      value: psaValue,
    },
    vendorProvider,
    vendorFacet,
    vendorFilters: vendorFilters.map(({ id: _id, column, operator, value }) => ({
      column,
      operator,
      ...(operator === 'is_null' || operator === 'is_not_null' ? {} : { value: value ?? '' }),
    })),
    countMode: 'count_rows',
  });

  const previewQuery = createQuery(() => ({
    queryKey: ['billing.previewRule', ruleDraft],
    queryFn: () => trpc.billing.previewRule.query(ruleDraft),
    enabled: psaValue.trim().length > 0 && vendorFacet.length > 0 && hasInclude,
    staleTime: 3_000,
  }));

  const saveMutation = createMutation(() => ({
    mutationFn: () => trpc.billing.upsertRule.mutate(ruleDraft),
    onSuccess: () => {
      toast.success(editingId ? 'Rule updated' : 'Rule created');
      qc.invalidateQueries({ queryKey: ['billing.rules'] });
      qc.invalidateQueries({ queryKey: ['billing.report'] });
      open = false;
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  function addFilter() {
    const first = selectedFacet?.filterColumns[0];
    if (!first) return;
    vendorFilters = [
      ...vendorFilters,
      {
        id: makeFilterId(),
        column: first.column,
        operator: defaultOperatorForColumn(first),
        value: defaultValueForColumn(first),
      },
    ];
  }

  function removeFilter(id: string) {
    vendorFilters = vendorFilters.filter((filter) => filter.id !== id);
  }

  function onProviderChange(newProvider: string) {
    if (!newProvider || newProvider === vendorProvider) return;
    vendorProvider = newProvider;
    const first = allFacets.find((f) => f.providerId === newProvider);
    if (first) {
      vendorFacet = first.facet;
      vendorFilters = seedFiltersFromFacet(first);
    }
  }

  function onFacetChange(newFacet: string) {
    if (!newFacet || newFacet === vendorFacet) return;
    vendorFacet = newFacet;
    const facet = allFacets.find((f) => f.facet === newFacet) ?? null;
    if (facet) {
      vendorProvider = facet.providerId;
      vendorFilters = seedFiltersFromFacet(facet);
    }
  }

  function onColumnChange(filterId: string, newColumn: string) {
    if (!newColumn) return;
    const meta = findColumn(selectedFacet, newColumn);
    vendorFilters = vendorFilters.map((f) => {
      if (f.id !== filterId) return f;
      return {
        ...f,
        column: newColumn,
        operator: defaultOperatorForColumn(meta),
        value: defaultValueForColumn(meta),
      };
    });
  }

  function onOperatorChange(filterId: string, newOperator: string) {
    if (!newOperator) return;
    const op = newOperator as VendorOperator;
    vendorFilters = vendorFilters.map((f) => {
      if (f.id !== filterId) return f;
      const meta = findColumn(selectedFacet, f.column);
      if (op === 'is_null' || op === 'is_not_null') {
        return { ...f, operator: op, value: undefined };
      }
      const value = f.value ?? defaultValueForColumn(meta);
      return { ...f, operator: op, value };
    });
  }

  function onValueChange(filterId: string, newValue: string) {
    vendorFilters = vendorFilters.map((f) => (f.id === filterId ? { ...f, value: newValue } : f));
  }

  const canSave = $derived(
    name.trim().length > 0 &&
      psaValue.trim().length > 0 &&
      vendorFacet.length > 0 &&
      hasInclude,
  );
</script>

<Sheet.Root bind:open>
  <Sheet.Portal>
    <Sheet.Overlay />
    <Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-3xl! md:max-w-4xl!">
      <Sheet.Header class="border-b p-5">
        <Sheet.Title>{editingId ? 'Edit rule' : 'New reconciliation rule'}</Sheet.Title>
        <Sheet.Description>
          Match a PSA billing line to vendor inventory, then reconcile counts and revenue.
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto">
        <div class="space-y-6 p-6">
          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <Label for="rule-name">Rule name</Label>
                <p class="text-xs text-muted-foreground">
                  Shown in the rules list and on report rows.
                </p>
              </div>
              <label class="flex items-center gap-2 text-sm">
                <Switch bind:checked={enabled} />
                <span>Enabled</span>
              </label>
            </div>
            <Input id="rule-name" bind:value={name} placeholder="Sophos Endpoint Protection" />
          </section>

          <Separator />

          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold">PSA line item match</h3>
              <p class="text-xs text-muted-foreground">
                Identifies the PSA billing row this rule applies to.
              </p>
            </div>

            <div class="grid grid-cols-[1fr_1fr_2fr] gap-3">
              <div class="space-y-1.5">
                <Label>Field</Label>
                <SingleSelect
                  options={psaFieldOptions}
                  selected={psaField}
                  onchange={(v) => {
                    if (v) psaField = v as PsaField;
                  }}
                  placeholder="Field"
                />
              </div>
              <div class="space-y-1.5">
                <Label>Operator</Label>
                <SingleSelect
                  options={psaOperatorOptions}
                  selected={psaOperator}
                  onchange={(v) => {
                    if (v) psaOperator = v as PsaOperator;
                  }}
                  placeholder="Operator"
                />
              </div>
              <div class="space-y-1.5">
                <Label for="psa-value">Value</Label>
                <Input id="psa-value" bind:value={psaValue} placeholder="Sophos Endpoint" />
              </div>
            </div>

          </section>

          <Separator />

          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold">Site scope</h3>
              <p class="text-xs text-muted-foreground">
                Effective sites = union of includes, minus union of excludes.
              </p>
            </div>

            <div class="space-y-2 rounded-md border p-3">
              <div class="flex items-center justify-between">
                <Label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Include
                </Label>
                <label class="flex items-center gap-2 text-xs">
                  <Switch bind:checked={includeAll} />
                  <span>All sites</span>
                </label>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <MultiSelect
                  options={siteOptions}
                  bind:selected={includeSiteIds}
                  placeholder="Sites…"
                  searchPlaceholder="Search sites…"
                  disabled={includeAll}
                />
                <MultiSelect
                  options={groupOptions}
                  bind:selected={includeGroupIds}
                  placeholder="Site groups…"
                  searchPlaceholder="Search groups…"
                  disabled={includeAll}
                />
              </div>
            </div>

            <div class="space-y-2 rounded-md border p-3">
              <Label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Exclude
              </Label>
              <div class="grid grid-cols-2 gap-2">
                <MultiSelect
                  options={siteOptions}
                  bind:selected={excludeSiteIds}
                  placeholder="Sites to exclude…"
                  searchPlaceholder="Search sites…"
                />
                <MultiSelect
                  options={groupOptions}
                  bind:selected={excludeGroupIds}
                  placeholder="Groups to exclude…"
                  searchPlaceholder="Search groups…"
                />
              </div>
            </div>

            {#if !hasInclude}
              <p class="text-xs text-amber-600 dark:text-amber-400">
                Add at least one include target — this rule matches no sites yet.
              </p>
            {/if}
          </section>

          <Separator />

          <section class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold">Vendor source</h3>
              <p class="text-xs text-muted-foreground">
                Choose which vendor facet supplies the actual quantity.
              </p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <Label>Provider</Label>
                <SingleSelect
                  options={providerOptions}
                  selected={vendorProvider}
                  onchange={onProviderChange}
                  placeholder="Provider"
                />
              </div>
              <div class="space-y-1.5">
                <Label>Facet</Label>
                <SingleSelect
                  options={facetOptions}
                  selected={vendorFacet}
                  onchange={onFacetChange}
                  placeholder="Facet"
                />
              </div>
            </div>
          </section>

          <Separator />

          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-semibold">Vendor filters</h3>
                <p class="text-xs text-muted-foreground">
                  Applied when counting rows in {selectedFacet?.label ?? 'the vendor facet'}.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                class="gap-1"
                onclick={addFilter}
                disabled={!selectedFacet}
              >
                <Plus class="size-3.5" />
                Add
              </Button>
            </div>

            {#if vendorFilters.length === 0}
              <div
                class="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
              >
                No filters — every row counts. Add one to narrow the vendor scope.
              </div>
            {:else}
              <div class="space-y-2">
                {#each vendorFilters as filter (filter.id)}
                  {@const columnMeta = findColumn(selectedFacet, filter.column)}
                  {@const operatorMeta = VENDOR_OPERATORS.find(
                    (o) => o.value === filter.operator
                  )}
                  <div
                    class="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-md border bg-muted/30 p-2.5"
                  >
                    <SingleSelect
                      options={columnOptions}
                      selected={filter.column}
                      onchange={(v) => onColumnChange(filter.id, v)}
                      placeholder="Column"
                    />

                    <SingleSelect
                      options={vendorOperatorOptions}
                      selected={filter.operator}
                      onchange={(v) => onOperatorChange(filter.id, v)}
                      placeholder="Operator"
                    />

                    {#if operatorMeta?.needsValue}
                      {#if columnMeta?.kind === 'boolean'}
                        <SingleSelect
                          options={booleanOptions}
                          selected={filter.value ?? ''}
                          onchange={(v) => onValueChange(filter.id, v)}
                          placeholder="Value"
                        />
                      {:else if columnMeta?.kind === 'enum' && columnMeta.options}
                        <SingleSelect
                          options={columnMeta.options}
                          selected={filter.value ?? ''}
                          onchange={(v) => onValueChange(filter.id, v)}
                          placeholder="Value"
                        />
                      {:else}
                        <Input
                          value={filter.value ?? ''}
                          oninput={(e) =>
                            onValueChange(filter.id, (e.target as HTMLInputElement).value)}
                          placeholder="value"
                        />
                      {/if}
                    {:else}
                      <div
                        class="rounded-md bg-background/40 px-2 py-2 text-center text-xs text-muted-foreground"
                      >
                        —
                      </div>
                    {/if}

                    <Button
                      variant="ghost"
                      size="icon"
                      onclick={() => removeFilter(filter.id)}
                      aria-label="Remove filter"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                {/each}
              </div>
            {/if}
          </section>

          <Separator />

          <section class="space-y-2">
            <h3 class="text-sm font-semibold">Live preview</h3>
            <div class="rounded-lg border bg-muted/30 p-4">
              {#if psaValue.trim().length === 0}
                <p class="text-center text-xs text-muted-foreground">
                  Enter a match value to see the preview.
                </p>
              {:else if previewQuery.isLoading}
                <div class="flex justify-center py-4">
                  <Loader />
                </div>
              {:else if previewQuery.data}
                {@const p = previewQuery.data}
                {@const delta = p.actualQuantity - p.billedQuantity}
                {@const deltaColor =
                  delta > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : delta < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-muted-foreground'}
                <div class="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <div
                      class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Billed
                    </div>
                    <div class="text-xl font-semibold tabular-nums">{p.billedQuantity}</div>
                  </div>
                  <div>
                    <div
                      class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Actual
                    </div>
                    <div class="text-xl font-semibold tabular-nums">{p.actualQuantity}</div>
                  </div>
                  <div>
                    <div
                      class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Δ Qty
                    </div>
                    <div class="text-xl font-semibold tabular-nums {deltaColor}">
                      {delta > 0 ? '+' : ''}{delta}
                    </div>
                  </div>
                  <div>
                    <div
                      class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Δ MRR
                    </div>
                    <div class="text-xl font-semibold tabular-nums {deltaColor}">
                      {formatMoney(p.monthlyDelta)}
                    </div>
                  </div>
                </div>
                <div class="mt-3 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                  <div>
                    Scope:
                    <span class="font-medium text-foreground">
                      {p.effectiveSiteCount == null
                        ? 'all sites (unscoped)'
                        : `${p.effectiveSiteCount} site${p.effectiveSiteCount === 1 ? '' : 's'}`}
                    </span>
                    · <span class="font-medium text-foreground">{p.matchedItemCount}</span>
                    matching PSA row{p.matchedItemCount === 1 ? '' : 's'}
                  </div>
                  {#if p.matchedItem}
                    <div>
                      Preview row: <span class="font-medium text-foreground"
                        >{p.matchedItem.itemName}</span
                      >
                      {#if p.matchedItem.customerName}
                        · {p.matchedItem.customerName}
                      {/if}
                      {#if p.facetLabel}
                        · counted against <span class="font-medium text-foreground"
                          >{p.facetLabel}</span
                        >
                      {/if}
                    </div>
                  {:else}
                    <span class="text-amber-600 dark:text-amber-400"
                      >No PSA row currently matches this rule.</span
                    >
                  {/if}
                </div>
              {/if}
            </div>
          </section>
        </div>
      </div>

      <Sheet.Footer class="flex flex-row items-center justify-end gap-2 border-t p-4">
        <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button
          class="gap-2"
          disabled={!canSave || saveMutation.isPending}
          onclick={() => saveMutation.mutate()}
        >
          <Save class="size-4" />
          {saveMutation.isPending ? 'Saving…' : editingId ? 'Update rule' : 'Create rule'}
        </Button>
      </Sheet.Footer>
    </Sheet.Content>
  </Sheet.Portal>
</Sheet.Root>
