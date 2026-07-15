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
  import Loader from '$lib/components/transition/loader.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Save from '@lucide/svelte/icons/save';

  type PsaField = 'itemName' | 'externalId';
  type PsaOperator = 'contains' | 'eq';
  type VendorColumn = 'type' | 'hasMdr' | 'online' | 'deletedAt';
  type VendorOperator = 'eq' | 'neq' | 'is_null' | 'is_not_null';

  type VendorFilterUI = {
    id: string;
    column: VendorColumn;
    operator: VendorOperator;
    value?: string;
  };

  type RuleInput = {
    id?: string;
    name: string;
    enabled: boolean;
    siteId?: string | null;
    psaItemMatch: {
      field: PsaField;
      operator: PsaOperator;
      value: string;
    };
    vendorProvider: 'sophos-partner';
    vendorFacet: 'sophos_endpoints';
    vendorFilters: Array<{
      column: VendorColumn;
      operator: VendorOperator;
      value?: string | boolean;
    }>;
    countMode: 'count_rows';
  };

  type SiteOption = { id: string; name: string };

  let {
    open = $bindable(),
    editingRule,
    sites: siteList,
  }: {
    open: boolean;
    editingRule: RuleInput | null;
    sites: SiteOption[];
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  let name = $state('');
  let enabled = $state(true);
  let siteId = $state<string>('');
  let psaField = $state<PsaField>('itemName');
  let psaOperator = $state<PsaOperator>('contains');
  let psaValue = $state('');
  let vendorFilters = $state<VendorFilterUI[]>([]);
  let editingId = $state<string | undefined>(undefined);

  const VENDOR_COLUMNS: Array<{
    value: VendorColumn;
    label: string;
    kind: 'string' | 'boolean' | 'null';
  }> = [
    { value: 'type', label: 'Endpoint type', kind: 'string' },
    { value: 'hasMdr', label: 'Has MDR', kind: 'boolean' },
    { value: 'online', label: 'Online', kind: 'boolean' },
    { value: 'deletedAt', label: 'Deleted at', kind: 'null' },
  ];

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
  const vendorColumnOptions = VENDOR_COLUMNS.map((c) => ({ value: c.value, label: c.label }));
  const vendorOperatorOptions = VENDOR_OPERATORS.map((o) => ({ value: o.value, label: o.label }));
  const endpointTypeOptions = [
    { value: 'computer', label: 'computer' },
    { value: 'server', label: 'server' },
  ];
  const booleanOptions = [
    { value: 'true', label: 'true' },
    { value: 'false', label: 'false' },
  ];
  const siteScopeOptions = $derived([
    { value: '', label: 'Any site matched by PSA row' },
    ...siteList.map((site) => ({ value: site.id, label: site.name })),
  ]);

  function makeFilterId() {
    return Math.random().toString(36).slice(2);
  }

  function seedFromRule(rule: RuleInput | null) {
    if (rule) {
      editingId = rule.id;
      name = rule.name;
      enabled = rule.enabled;
      siteId = rule.siteId ?? '';
      psaField = rule.psaItemMatch.field;
      psaOperator = rule.psaItemMatch.operator;
      psaValue = rule.psaItemMatch.value;
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
      siteId = '';
      psaField = 'itemName';
      psaOperator = 'contains';
      psaValue = '';
      vendorFilters = [{ id: makeFilterId(), column: 'deletedAt', operator: 'is_null' }];
    }
  }

  let openTrack = $state(false);
  $effect(() => {
    if (open && !openTrack) {
      seedFromRule(editingRule);
    }
    openTrack = open;
  });

  const ruleDraft = $derived<RuleInput>({
    ...(editingId ? { id: editingId } : {}),
    name: name.trim() || 'Untitled rule',
    enabled,
    siteId: siteId || null,
    psaItemMatch: {
      field: psaField,
      operator: psaOperator,
      value: psaValue,
    },
    vendorProvider: 'sophos-partner',
    vendorFacet: 'sophos_endpoints',
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
    enabled: psaValue.trim().length > 0,
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
    vendorFilters = [
      ...vendorFilters,
      { id: makeFilterId(), column: 'type', operator: 'eq', value: 'computer' },
    ];
  }

  function removeFilter(id: string) {
    vendorFilters = vendorFilters.filter((filter) => filter.id !== id);
  }

  function onColumnChange(filterId: string, newColumn: string) {
    if (!newColumn) return;
    const col = newColumn as VendorColumn;
    const meta = VENDOR_COLUMNS.find((c) => c.value === col);
    vendorFilters = vendorFilters.map((f) => {
      if (f.id !== filterId) return f;
      if (meta?.kind === 'null') {
        return { ...f, column: col, operator: 'is_null', value: undefined };
      }
      if (meta?.kind === 'boolean') {
        return { ...f, column: col, operator: 'eq', value: 'true' };
      }
      return { ...f, column: col, operator: 'eq', value: '' };
    });
  }

  function onOperatorChange(filterId: string, newOperator: string) {
    if (!newOperator) return;
    const op = newOperator as VendorOperator;
    vendorFilters = vendorFilters.map((f) => {
      if (f.id !== filterId) return f;
      const meta = VENDOR_COLUMNS.find((c) => c.value === f.column);
      if (op === 'is_null' || op === 'is_not_null') {
        return { ...f, operator: op, value: undefined };
      }
      const defaultValue = f.value ?? (meta?.kind === 'boolean' ? 'true' : '');
      return { ...f, operator: op, value: defaultValue };
    });
  }

  function onValueChange(filterId: string, newValue: string) {
    vendorFilters = vendorFilters.map((f) => (f.id === filterId ? { ...f, value: newValue } : f));
  }

  const canSave = $derived(name.trim().length > 0 && psaValue.trim().length > 0);

  function money(value: number | undefined) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value ?? 0);
  }
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

            <div class="space-y-1.5">
              <Label>Site scope</Label>
              <SingleSelect
                options={siteScopeOptions}
                bind:selected={siteId}
                placeholder="Any site matched by PSA row"
                searchPlaceholder="Search sites…"
              />
              <p class="text-xs text-muted-foreground">
                Leave "Any" to let the PSA row's site drive scope.
              </p>
            </div>
          </section>

          <Separator />

          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-semibold">Vendor filters</h3>
                <p class="text-xs text-muted-foreground">
                  Applied to Sophos endpoints when counting the actual quantity.
                </p>
              </div>
              <Button size="sm" variant="outline" class="gap-1" onclick={addFilter}>
                <Plus class="size-3.5" />
                Add
              </Button>
            </div>

            {#if vendorFilters.length === 0}
              <div
                class="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
              >
                No filters — every endpoint counts. Add one to narrow the vendor scope.
              </div>
            {:else}
              <div class="space-y-2">
                {#each vendorFilters as filter (filter.id)}
                  {@const columnMeta = VENDOR_COLUMNS.find((c) => c.value === filter.column)}
                  {@const operatorMeta = VENDOR_OPERATORS.find((o) => o.value === filter.operator)}
                  <div
                    class="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-md border bg-muted/30 p-2.5"
                  >
                    <SingleSelect
                      options={vendorColumnOptions}
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
                      {:else if filter.column === 'type'}
                        <SingleSelect
                          options={endpointTypeOptions}
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
                      {money(p.monthlyDelta)}
                    </div>
                  </div>
                </div>
                <div class="mt-3 border-t pt-2 text-xs text-muted-foreground">
                  {#if p.matchedItem}
                    Matched PSA row: <span class="font-medium text-foreground"
                      >{p.matchedItem.itemName}</span
                    >
                    {#if p.matchedItem.customerName}
                      · {p.matchedItem.customerName}
                    {/if}
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
