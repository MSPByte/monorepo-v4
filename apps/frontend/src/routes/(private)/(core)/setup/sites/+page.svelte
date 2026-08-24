<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Search from '@lucide/svelte/icons/search';
  import ToggleLeft from '@lucide/svelte/icons/toggle-left';
  import ToggleRight from '@lucide/svelte/icons/toggle-right';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Layers from '@lucide/svelte/icons/layers';
  import Settings from '@lucide/svelte/icons/settings';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();
  const canWriteSites = $derived(authStore.isAllowed('Sites.Write'));
  const canDeleteSites = $derived(authStore.isAllowed('Sites.Delete'));

  const catalogQuery = createQuery(() => ({
    queryKey: ['siteProfile.catalog'],
    queryFn: () => trpc.siteProfile.catalog.query(),
  }));

  const fields = $derived(catalogQuery.data?.fields ?? []);
  const categories = $derived(catalogQuery.data?.categories ?? []);

  const executiveFields = $derived(
    fields.filter((f) => f.section === 'executive').sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  );
  const contextFields = $derived(
    fields.filter((f) => f.section === 'context').sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  );
  const sortedCategories = $derived(
    [...categories].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  );

  type Tab = 'fields' | 'categories';
  let activeTab = $state<Tab>('fields');

  // -- Unified type system --------------------------------------------------
  type UnifiedType = {
    id: string;
    label: string;
    description: string;
    type: 'string' | 'number' | 'boolean';
    valueMode: 'single' | 'multiple';
    valueType: string | null;
  };

  const UNIFIED_TYPES: UnifiedType[] = [
    { id: 'text', label: 'Text', description: 'Free-form text', type: 'string', valueMode: 'single', valueType: null },
    { id: 'number', label: 'Number', description: 'Numeric value', type: 'number', valueMode: 'single', valueType: null },
    { id: 'boolean', label: 'Yes / No', description: 'True or false toggle', type: 'boolean', valueMode: 'single', valueType: null },
    { id: 'text_list', label: 'List', description: 'One or more text values', type: 'string', valueMode: 'multiple', valueType: null },
    { id: 'timezone', label: 'Time Zone', description: 'IANA timezone picker with UTC offsets', type: 'string', valueMode: 'single', valueType: 'timezone' },
    { id: 'uuid', label: 'UUID', description: 'Unique identifier (e.g. M365 Tenant ID)', type: 'string', valueMode: 'single', valueType: 'uuid' },
    { id: 'upn', label: 'User Principal Name', description: 'Microsoft identity (user@domain.com)', type: 'string', valueMode: 'single', valueType: 'upn' },
    { id: 'postal_code', label: 'Postal Code', description: 'ZIP or postal code', type: 'string', valueMode: 'single', valueType: 'postal_code' },
    { id: 'city', label: 'City', description: 'City name', type: 'string', valueMode: 'single', valueType: 'city' },
    { id: 'country_code', label: 'Country', description: 'ISO 3166-1 alpha-2 country code', type: 'string', valueMode: 'single', valueType: 'country_code' },
    { id: 'region', label: 'State / Region', description: 'State, province, or region', type: 'string', valueMode: 'single', valueType: 'region' },
  ];

  const MANAGED_VALUE_TYPES = new Set(['timezone', 'uuid', 'upn', 'postal_code', 'city', 'country_code', 'region']);

  const unifiedTypeOptions = UNIFIED_TYPES.map((t) => ({ value: t.id, label: t.label, subLabel: t.description }));

  function deriveUnifiedTypeId(type: string, valueMode: string, valueType: string): string {
    if (valueType && MANAGED_VALUE_TYPES.has(valueType)) {
      return UNIFIED_TYPES.find((t) => t.valueType === valueType)?.id ?? 'text';
    }
    if (valueMode === 'multiple') return 'text_list';
    if (type === 'number') return 'number';
    if (type === 'boolean') return 'boolean';
    return 'text';
  }

  function getTypeLabel(f: { type: string; valueMode?: string | null; valueType?: string | null }): string {
    const id = deriveUnifiedTypeId(f.type, f.valueMode ?? 'single', f.valueType ?? '');
    return UNIFIED_TYPES.find((t) => t.id === id)?.label ?? 'Text';
  }

  function labelToKey(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  // -- Field editor state ---------------------------------------------------
  type FieldDraft = {
    id?: string;
    key: string;
    label: string;
    section: 'executive' | 'context';
    type: 'string' | 'number' | 'boolean';
    valueMode: 'single' | 'multiple';
    valueType: string;
    displayOrder: number;
    values: string[];
    active: boolean;
  };

  const emptyField: FieldDraft = {
    key: '',
    label: '',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    valueType: '',
    displayOrder: 0,
    values: [],
    active: true,
  };

  let fieldOpen = $state(false);
  let fieldDraft = $state<FieldDraft>({ ...emptyField });
  let optionSearch = $state('');
  let newOptionValue = $state('');

  const selectedUnifiedTypeId = $derived(
    deriveUnifiedTypeId(fieldDraft.type, fieldDraft.valueMode, fieldDraft.valueType)
  );
  const showOptionsBuilder = $derived(
    !MANAGED_VALUE_TYPES.has(fieldDraft.valueType) && fieldDraft.type !== 'boolean'
  );

  function applyUnifiedType(id: string) {
    const t = UNIFIED_TYPES.find((u) => u.id === id);
    if (!t) return;
    fieldDraft.type = t.type;
    fieldDraft.valueMode = t.valueMode;
    fieldDraft.valueType = t.valueType ?? '';
    if (MANAGED_VALUE_TYPES.has(t.valueType ?? '')) fieldDraft.values = [];
  }

  function openNewField(section: 'executive' | 'context' = 'context') {
    fieldDraft = { ...emptyField, section };
    optionSearch = '';
    newOptionValue = '';
    fieldOpen = true;
  }

  function openEditField(row: (typeof fields)[number]) {
    fieldDraft = {
      id: row.id ?? undefined,
      key: row.key,
      label: row.label,
      section: row.section,
      type: row.type,
      valueMode: row.valueMode ?? 'single',
      valueType: row.valueType ?? '',
      displayOrder: row.displayOrder ?? 0,
      values: [...(row.values ?? [])],
      active: row.active,
    };
    optionSearch = '';
    newOptionValue = '';
    fieldOpen = true;
  }

  function labelForOption(value: string) {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const visibleOptions = $derived.by(() => {
    const search = optionSearch.trim().toLowerCase();
    if (!search) return fieldDraft.values;
    return fieldDraft.values.filter(
      (v) => v.toLowerCase().includes(search) || labelForOption(v).toLowerCase().includes(search)
    );
  });

  function addOption() {
    const value = newOptionValue.trim();
    if (!value || fieldDraft.values.includes(value)) return;
    fieldDraft.values = [...fieldDraft.values, value];
    newOptionValue = '';
    optionSearch = '';
  }

  function removeOption(value: string) {
    fieldDraft.values = fieldDraft.values.filter((o) => o !== value);
  }

  function getNextFieldOrder(section: 'executive' | 'context'): number {
    const list = section === 'executive' ? executiveFields : contextFields;
    return Math.max(...list.map((f) => f.displayOrder ?? 0), 0) + 10;
  }

  const saveField = createMutation(() => ({
    mutationFn: (input: FieldDraft) =>
      trpc.siteProfile.upsertField.mutate({
        id: input.id,
        key: input.key,
        label: input.label,
        section: input.section,
        type: input.type,
        valueMode: input.valueMode,
        valueType: input.valueType || null,
        displayOrder: input.id ? input.displayOrder : getNextFieldOrder(input.section),
        values: input.values.length ? input.values : null,
        active: input.active,
      }),
    onSuccess: () => {
      fieldOpen = false;
      toast.success('Field saved');
      qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const fieldSaveDisabled = $derived(
    saveField.isPending || !fieldDraft.label.trim() || !fieldDraft.key || !canWriteSites
  );

  const toggleField = createMutation(() => ({
    mutationFn: (row: (typeof fields)[number]) =>
      trpc.siteProfile.upsertField.mutate({
        id: row.id ?? undefined,
        key: row.key,
        label: row.label,
        section: row.section,
        type: row.type,
        valueMode: row.valueMode ?? 'single',
        valueType: row.valueType ?? null,
        displayOrder: row.displayOrder ?? 0,
        values: row.values ?? null,
        active: !row.active,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Toggle failed'),
  }));

  const deleteField = createMutation(() => ({
    mutationFn: (id: string) => trpc.siteProfile.deleteField.mutate({ id }),
    onSuccess: () => {
      toast.success('Field deleted');
      qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  const reorderFieldsMut = createMutation(() => ({
    mutationFn: (items: { id: string; displayOrder: number }[]) =>
      trpc.siteProfile.reorderFields.mutate(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Reorder failed'),
  }));

  // -- Field drag-to-reorder ------------------------------------------------
  let fieldDragFrom = $state<{ section: 'executive' | 'context'; index: number } | null>(null);
  let fieldDragOver = $state<{ section: 'executive' | 'context'; index: number } | null>(null);

  function handleFieldDragStart(e: DragEvent, section: 'executive' | 'context', index: number) {
    fieldDragFrom = { section, index };
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function handleFieldDragOver(e: DragEvent, section: 'executive' | 'context', index: number) {
    e.preventDefault();
    if (fieldDragFrom?.section === section) fieldDragOver = { section, index };
  }

  function handleFieldDrop(e: DragEvent, section: 'executive' | 'context', targetIndex: number) {
    e.preventDefault();
    if (!fieldDragFrom || fieldDragFrom.section !== section) { fieldDragFrom = null; fieldDragOver = null; return; }
    const fromIndex = fieldDragFrom.index;
    fieldDragFrom = null; fieldDragOver = null;
    if (fromIndex === targetIndex) return;
    const list = section === 'executive' ? [...executiveFields] : [...contextFields];
    const [removed] = list.splice(fromIndex, 1);
    list.splice(targetIndex, 0, removed);
    const updates = list.filter((f) => f.id).map((f, i) => ({ id: f.id!, displayOrder: (i + 1) * 10 }));
    reorderFieldsMut.mutate(updates);
  }

  // -- Category editor state ------------------------------------------------
  type CategoryDraft = {
    id?: string;
    key: string;
    label: string;
    description: string;
    required: boolean;
    displayOrder: number;
    metadataFields: StackMetadataFieldDraft[];
  };

  type StackMetadataFieldDraft = {
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'url' | 'ip' | 'secret_ref';
    required: boolean;
    helpText: string;
  };

  const DETAIL_FIELD_TYPES: { value: StackMetadataFieldDraft['type']; label: string }[] = [
    { value: 'string', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Yes / No' },
    { value: 'url', label: 'URL' },
    { value: 'ip', label: 'IP Address' },
    { value: 'secret_ref', label: 'Secret' },
  ];

  const emptyCategory: CategoryDraft = {
    key: '', label: '', description: '', required: false, displayOrder: 0, metadataFields: [],
  };

  let catOpen = $state(false);
  let catDraft = $state<CategoryDraft>({ ...emptyCategory });

  function openNewCategory() {
    catDraft = { ...emptyCategory };
    catOpen = true;
  }

  function openEditCategory(row: (typeof categories)[number]) {
    catDraft = {
      id: row.id ?? undefined,
      key: row.key,
      label: row.label,
      description: row.description,
      required: row.required,
      displayOrder: row.displayOrder ?? 0,
      metadataFields: (row.metadataFields ?? []).map((f) => ({
        key: f.key, label: f.label, type: f.type, required: f.required ?? false, helpText: f.helpText ?? '',
      })),
    };
    catOpen = true;
  }

  function addCategoryMetadataField() {
    catDraft.metadataFields = [
      ...catDraft.metadataFields,
      { key: '', label: '', type: 'string', required: false, helpText: '' },
    ];
  }

  function removeCategoryMetadataField(index: number) {
    catDraft.metadataFields = catDraft.metadataFields.filter((_, i) => i !== index);
  }

  function getNextCategoryOrder(): number {
    return Math.max(...categories.map((c) => c.displayOrder ?? 0), 0) + 10;
  }

  const saveCategory = createMutation(() => ({
    mutationFn: (input: CategoryDraft) =>
      trpc.siteProfile.upsertCategory.mutate({
        id: input.id,
        key: input.key,
        label: input.label,
        description: input.description,
        required: input.required,
        displayOrder: input.id ? input.displayOrder : getNextCategoryOrder(),
        metadataFields: input.metadataFields
          .filter((f) => f.key && f.label)
          .map((f) => ({ ...f, helpText: f.helpText || null })),
      }),
    onSuccess: () => {
      catOpen = false;
      toast.success('Category saved');
      qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const catSaveDisabled = $derived(
    saveCategory.isPending || !catDraft.label.trim() || !catDraft.key || !canWriteSites
  );

  const deleteCategory = createMutation(() => ({
    mutationFn: (id: string) => trpc.siteProfile.deleteCategory.mutate({ id }),
    onSuccess: () => {
      toast.success('Category deleted');
      qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  const reorderCategoriesMut = createMutation(() => ({
    mutationFn: (items: { id: string; displayOrder: number }[]) =>
      trpc.siteProfile.reorderCategories.mutate(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Reorder failed'),
  }));

  // -- Category drag-to-reorder ---------------------------------------------
  let catDragFrom = $state<number | null>(null);
  let catDragOver = $state<number | null>(null);

  function handleCatDragStart(e: DragEvent, index: number) {
    catDragFrom = index;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function handleCatDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    catDragOver = index;
  }

  function handleCatDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    const from = catDragFrom;
    catDragFrom = null; catDragOver = null;
    if (from === null || from === targetIndex) return;
    const list = [...sortedCategories];
    const [removed] = list.splice(from, 1);
    list.splice(targetIndex, 0, removed);
    const updates = list.filter((c) => c.id).map((c, i) => ({ id: c.id!, displayOrder: (i + 1) * 10 }));
    reorderCategoriesMut.mutate(updates);
  }
</script>

<div class="flex flex-col size-full overflow-auto">
  <!-- Page header -->
  <div class="border-b border-border px-4 py-4 lg:px-6">
    <h1 class="text-lg font-semibold">Site Profile Setup</h1>
    <p class="mt-0.5 text-sm text-muted-foreground">
      Define the profile fields and stack categories used to document every site. Changes apply across all sites immediately.
    </p>
    <div class="mt-4 flex gap-0">
      <button
        type="button"
        class="flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm font-medium transition-colors {activeTab === 'fields'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = 'fields')}
      >
        <Layers class="size-3.5" />
        Profile Fields
        <span class="rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10px]">{fields.length}</span>
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm font-medium transition-colors {activeTab === 'categories'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = 'categories')}
      >
        <Settings class="size-3.5" />
        Stack Categories
        <span class="rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10px]">{categories.length}</span>
      </button>
    </div>
  </div>

  <!-- Profile Fields tab -->
  {#if activeTab === 'fields'}
    <div class="flex flex-col gap-0 p-4 lg:p-6">
      <!-- Executive Identity section -->
      <div class="mb-8">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Executive Identity</div>
            <p class="text-xs text-muted-foreground">High-level client attributes visible at a glance on every site profile.</p>
          </div>
          {#if canWriteSites}
            <Button size="sm" variant="outline" onclick={() => openNewField('executive')}>
              <Plus class="size-3.5" />
              Add Field
            </Button>
          {/if}
        </div>

        <div class="border border-border">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-border bg-muted/30 text-left">
                {#if canWriteSites}<th class="w-6 px-2 py-2"></th>{/if}
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Label</th>
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Type</th>
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Options</th>
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Status</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {#each executiveFields as f, i (f.key)}
                <tr
                  class="group border-b border-border/40 last:border-b-0 transition-colors {!f.active ? 'opacity-50' : ''} {fieldDragOver?.section === 'executive' && fieldDragOver.index === i ? 'border-t-2 border-primary bg-muted/20' : ''}"
                  draggable={canWriteSites}
                  ondragstart={(e) => handleFieldDragStart(e, 'executive', i)}
                  ondragover={(e) => handleFieldDragOver(e, 'executive', i)}
                  ondrop={(e) => handleFieldDrop(e, 'executive', i)}
                  ondragend={() => { fieldDragFrom = null; fieldDragOver = null; }}
                >
                  {#if canWriteSites}
                    <td class="w-6 cursor-grab px-2 py-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      <GripVertical class="size-3.5" />
                    </td>
                  {/if}
                  <td class="px-3 py-2 font-medium">{f.label}</td>
                  <td class="px-3 py-2">
                    <span class="rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10px] uppercase tracking-wide">
                      {getTypeLabel(f)}
                    </span>
                  </td>
                  <td class="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {#if f.values && f.values.length > 10}
                      {f.values.length} options
                    {:else if f.values && f.values.length}
                      {f.values.slice(0, 3).join(', ')}{f.values.length > 3 ? ` +${f.values.length - 3}` : ''}
                    {:else}
                      —
                    {/if}
                  </td>
                  <td class="px-3 py-2">
                    {#if canWriteSites}
                      <button
                        type="button"
                        class="flex items-center gap-1 text-[11px] {f.active ? 'text-foreground' : 'text-muted-foreground'} hover:text-primary"
                        onclick={() => toggleField.mutate(f)}
                        title={f.active ? 'Deactivate' : 'Activate'}
                      >
                        {#if f.active}
                          <ToggleRight class="size-4 text-primary" />
                          <span class="font-mono text-[10px] uppercase tracking-wide">Active</span>
                        {:else}
                          <ToggleLeft class="size-4" />
                          <span class="font-mono text-[10px] uppercase tracking-wide">Inactive</span>
                        {/if}
                      </button>
                    {:else}
                      <span class="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{f.active ? 'Active' : 'Inactive'}</span>
                    {/if}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <div class="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {#if canWriteSites}
                        <Button variant="ghost" size="icon" class="size-7" onclick={() => openEditField(f)}>
                          <Pencil class="size-3.5" />
                        </Button>
                      {/if}
                      {#if canDeleteSites && f.id}
                        <Button variant="ghost" size="icon" class="size-7 text-destructive" onclick={() => deleteField.mutate(f.id!)}>
                          <Trash class="size-3.5" />
                        </Button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
              {#if executiveFields.length === 0}
                <tr>
                  <td colspan="6" class="px-3 py-8 text-center text-xs text-muted-foreground">
                    No executive identity fields defined. Add one to get started.
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Business Context section -->
      <div>
        <div class="mb-3 flex items-center justify-between">
          <div>
            <div class="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Business Context</div>
            <p class="text-xs text-muted-foreground">Operational details that inform support decisions and automation behaviour.</p>
          </div>
          {#if canWriteSites}
            <Button size="sm" variant="outline" onclick={() => openNewField('context')}>
              <Plus class="size-3.5" />
              Add Field
            </Button>
          {/if}
        </div>

        <div class="border border-border">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-border bg-muted/30 text-left">
                {#if canWriteSites}<th class="w-6 px-2 py-2"></th>{/if}
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Label</th>
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Type</th>
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Options</th>
                <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Status</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {#each contextFields as f, i (f.key)}
                <tr
                  class="group border-b border-border/40 last:border-b-0 transition-colors {!f.active ? 'opacity-50' : ''} {fieldDragOver?.section === 'context' && fieldDragOver.index === i ? 'border-t-2 border-primary bg-muted/20' : ''}"
                  draggable={canWriteSites}
                  ondragstart={(e) => handleFieldDragStart(e, 'context', i)}
                  ondragover={(e) => handleFieldDragOver(e, 'context', i)}
                  ondrop={(e) => handleFieldDrop(e, 'context', i)}
                  ondragend={() => { fieldDragFrom = null; fieldDragOver = null; }}
                >
                  {#if canWriteSites}
                    <td class="w-6 cursor-grab px-2 py-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      <GripVertical class="size-3.5" />
                    </td>
                  {/if}
                  <td class="px-3 py-2 font-medium">{f.label}</td>
                  <td class="px-3 py-2">
                    <span class="rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10px] uppercase tracking-wide">
                      {getTypeLabel(f)}
                    </span>
                  </td>
                  <td class="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {#if f.values && f.values.length > 10}
                      {f.values.length} options
                    {:else if f.values && f.values.length}
                      {f.values.slice(0, 3).join(', ')}{f.values.length > 3 ? ` +${f.values.length - 3}` : ''}
                    {:else}
                      —
                    {/if}
                  </td>
                  <td class="px-3 py-2">
                    {#if canWriteSites}
                      <button
                        type="button"
                        class="flex items-center gap-1 text-[11px] {f.active ? 'text-foreground' : 'text-muted-foreground'} hover:text-primary"
                        onclick={() => toggleField.mutate(f)}
                        title={f.active ? 'Deactivate' : 'Activate'}
                      >
                        {#if f.active}
                          <ToggleRight class="size-4 text-primary" />
                          <span class="font-mono text-[10px] uppercase tracking-wide">Active</span>
                        {:else}
                          <ToggleLeft class="size-4" />
                          <span class="font-mono text-[10px] uppercase tracking-wide">Inactive</span>
                        {/if}
                      </button>
                    {:else}
                      <span class="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{f.active ? 'Active' : 'Inactive'}</span>
                    {/if}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <div class="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {#if canWriteSites}
                        <Button variant="ghost" size="icon" class="size-7" onclick={() => openEditField(f)}>
                          <Pencil class="size-3.5" />
                        </Button>
                      {/if}
                      {#if canDeleteSites && f.id}
                        <Button variant="ghost" size="icon" class="size-7 text-destructive" onclick={() => deleteField.mutate(f.id!)}>
                          <Trash class="size-3.5" />
                        </Button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
              {#if contextFields.length === 0}
                <tr>
                  <td colspan="6" class="px-3 py-8 text-center text-xs text-muted-foreground">
                    No business context fields defined. Add one to get started.
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {/if}

  <!-- Stack Categories tab -->
  {#if activeTab === 'categories'}
    <div class="p-4 lg:p-6">
      <div class="mb-3 flex items-center justify-between">
        <div>
          <div class="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Stack Categories</div>
          <p class="text-xs text-muted-foreground">
            Required categories must be answered for every site. Optional ones appear on demand.
          </p>
        </div>
        {#if canWriteSites}
          <Button size="sm" variant="outline" onclick={openNewCategory}>
            <Plus class="size-3.5" />
            New Category
          </Button>
        {/if}
      </div>

      <div class="border border-border">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/30 text-left">
              {#if canWriteSites}<th class="w-6 px-2 py-2"></th>{/if}
              <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Label</th>
              <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Description</th>
              <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Details</th>
              <th class="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Required</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each sortedCategories as c, i (c.key)}
              <tr
                class="group border-b border-border/40 last:border-b-0 transition-colors {catDragOver === i ? 'border-t-2 border-primary bg-muted/20' : ''}"
                draggable={canWriteSites}
                ondragstart={(e) => handleCatDragStart(e, i)}
                ondragover={(e) => handleCatDragOver(e, i)}
                ondrop={(e) => handleCatDrop(e, i)}
                ondragend={() => { catDragFrom = null; catDragOver = null; }}
              >
                {#if canWriteSites}
                  <td class="w-6 cursor-grab px-2 py-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    <GripVertical class="size-3.5" />
                  </td>
                {/if}
                <td class="px-3 py-2 font-medium">{c.label}</td>
                <td class="px-3 py-2 text-sm text-muted-foreground">{c.description || '—'}</td>
                <td class="px-3 py-2">
                  {#if c.metadataFields?.length}
                    <span class="rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10px]">
                      {c.metadataFields.length} field{c.metadataFields.length !== 1 ? 's' : ''}
                    </span>
                  {:else}
                    <span class="text-[11px] text-muted-foreground">—</span>
                  {/if}
                </td>
                <td class="px-3 py-2">
                  <span class="font-mono text-[10px] uppercase tracking-wide {c.required ? 'text-foreground' : 'text-muted-foreground'}">
                    {c.required ? 'Required' : 'Optional'}
                  </span>
                </td>
                <td class="px-3 py-2 text-right">
                  <div class="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {#if canWriteSites}
                      <Button variant="ghost" size="icon" class="size-7" onclick={() => openEditCategory(c)}>
                        <Pencil class="size-3.5" />
                      </Button>
                    {/if}
                    {#if canDeleteSites && c.id}
                      <Button variant="ghost" size="icon" class="size-7 text-destructive" onclick={() => deleteCategory.mutate(c.id!)}>
                        <Trash class="size-3.5" />
                      </Button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
            {#if categories.length === 0}
              <tr>
                <td colspan="6" class="px-3 py-8 text-center text-xs text-muted-foreground">
                  No stack categories defined. Add one to get started.
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<!-- Field editor dialog -->
<Dialog.Root bind:open={fieldOpen}>
  <Dialog.Content class="sm:max-w-[520px]">
    <Dialog.Header>
      <Dialog.Title>{fieldDraft.id ? 'Edit field' : 'New profile field'}</Dialog.Title>
      <Dialog.Description>
        Fields appear on every site profile under the section you choose.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-5 p-4">
      <!-- Label -->
      <div class="grid gap-1.5">
        <Label for="field-label">Label</Label>
        <Input
          id="field-label"
          bind:value={fieldDraft.label}
          placeholder="e.g. Primary contact"
          oninput={() => { if (!fieldDraft.id) fieldDraft.key = labelToKey(fieldDraft.label); }}
        />
        {#if fieldDraft.id}
          <p class="font-mono text-[11px] text-muted-foreground">Key: {fieldDraft.key}</p>
        {/if}
      </div>

      <!-- Section -->
      <div class="grid gap-1.5">
        <Label>Section</Label>
        <div class="flex gap-1.5">
          <button
            type="button"
            class="flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors {fieldDraft.section === 'executive'
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'}"
            onclick={() => (fieldDraft.section = 'executive')}
          >
            Executive Identity
          </button>
          <button
            type="button"
            class="flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors {fieldDraft.section === 'context'
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'}"
            onclick={() => (fieldDraft.section = 'context')}
          >
            Business Context
          </button>
        </div>
      </div>

      <!-- Field type -->
      <div class="grid gap-1.5">
        <Label>Field type</Label>
        <SingleSelect
          options={unifiedTypeOptions}
          selected={selectedUnifiedTypeId}
          placeholder="Choose a type..."
          searchPlaceholder="Search types..."
          onchange={applyUnifiedType}
        />
      </div>

      <!-- Options builder (hidden for managed types and boolean) -->
      {#if showOptionsBuilder}
        <div class="grid gap-1.5">
          <Label>Allowed options</Label>
          <p class="text-[11px] text-muted-foreground -mt-1">Leave empty to accept any value, or restrict to a defined list.</p>
          <div class="rounded-md border border-border bg-muted/20">
            <div class="grid gap-2 border-b border-border p-2 md:grid-cols-[1fr_auto]">
              <div class="relative">
                <Search class="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  bind:value={optionSearch}
                  class="pl-7"
                  placeholder={`Search ${fieldDraft.values.length} option${fieldDraft.values.length !== 1 ? 's' : ''}`}
                />
              </div>
              <div class="flex gap-2">
                <Input
                  bind:value={newOptionValue}
                  placeholder="Add option"
                  onkeydown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); addOption(); }
                  }}
                />
                <Button type="button" variant="outline" size="icon" onclick={addOption}>
                  <Plus class="size-4" />
                </Button>
              </div>
            </div>
            {#if fieldDraft.values.length}
              <div class="max-h-48 overflow-auto p-1">
                {#each visibleOptions as option (option)}
                  <div class="grid grid-cols-[minmax(0,1fr)_minmax(90px,0.5fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-background">
                    <div class="min-w-0 truncate font-medium">{labelForOption(option)}</div>
                    <div class="min-w-0 truncate font-mono text-xs text-muted-foreground">{option}</div>
                    <Button
                      type="button" variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-destructive"
                      onclick={() => removeOption(option)}
                    >
                      <Trash class="size-3.5" />
                    </Button>
                  </div>
                {:else}
                  <div class="px-2 py-5 text-center text-xs text-muted-foreground">No options match your search.</div>
                {/each}
              </div>
            {:else}
              <div class="px-3 py-5 text-center text-xs text-muted-foreground">
                No options defined — this field accepts any value.
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (fieldOpen = false)}>Cancel</Button>
      <Button disabled={fieldSaveDisabled} onclick={() => saveField.mutate(fieldDraft)}>Save field</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Category editor dialog -->
<Dialog.Root bind:open={catOpen}>
  <Dialog.Content class="sm:max-w-[680px]">
    <Dialog.Header>
      <Dialog.Title>{catDraft.id ? 'Edit category' : 'New stack category'}</Dialog.Title>
      <Dialog.Description>
        Stack categories define what platforms every site is expected to document.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid max-h-[72vh] gap-5 overflow-y-auto p-4">
      <!-- Label -->
      <div class="grid gap-1.5">
        <Label for="cat-label">Label</Label>
        <Input
          id="cat-label"
          bind:value={catDraft.label}
          placeholder="e.g. Backup Solution"
          oninput={() => { if (!catDraft.id) catDraft.key = labelToKey(catDraft.label); }}
        />
        {#if catDraft.id}
          <p class="font-mono text-[11px] text-muted-foreground">Key: {catDraft.key}</p>
        {/if}
      </div>

      <!-- Description -->
      <div class="grid gap-1.5">
        <Label for="cat-desc">Description</Label>
        <Input id="cat-desc" bind:value={catDraft.description} placeholder="What is this for?" />
      </div>

      <!-- Required toggle -->
      <div class="grid gap-1.5">
        <Label>Completion requirement</Label>
        <div class="flex gap-1.5">
          <button
            type="button"
            class="flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors {!catDraft.required
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'}"
            onclick={() => (catDraft.required = false)}
          >
            Optional
          </button>
          <button
            type="button"
            class="flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors {catDraft.required
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'}"
            onclick={() => (catDraft.required = true)}
          >
            Required
          </button>
        </div>
        <p class="text-[11px] text-muted-foreground">Required categories prompt for completion on every site.</p>
      </div>

      <!-- Metadata fields -->
      <div class="grid gap-2">
        <div class="flex items-center justify-between gap-2">
          <div>
            <Label>Expected details</Label>
            <p class="text-xs text-muted-foreground">Fields that appear when documenting this category on a site.</p>
          </div>
          {#if canWriteSites}
            <Button type="button" variant="outline" size="sm" onclick={addCategoryMetadataField}>
              <Plus class="size-3.5" />
              Add detail
            </Button>
          {/if}
        </div>
        {#if catDraft.metadataFields.length}
          <div class="grid gap-2">
            {#each catDraft.metadataFields as field, i (`${field.key}-${i}`)}
              <div class="grid gap-2 rounded-md border border-border p-3">
                <div class="grid gap-2 md:grid-cols-[1fr_140px_auto]">
                  <Input
                    bind:value={field.label}
                    placeholder="Detail label"
                    oninput={() => { field.key = labelToKey(field.label); }}
                  />
                  <select
                    class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={field.type}
                    onchange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      field.type = v as StackMetadataFieldDraft['type'];
                    }}
                  >
                    {#each DETAIL_FIELD_TYPES as dt}
                      <option value={dt.value}>{dt.label}</option>
                    {/each}
                  </select>
                  {#if canWriteSites}
                    <Button type="button" variant="ghost" size="icon" class="size-9 text-muted-foreground hover:text-destructive" onclick={() => removeCategoryMetadataField(i)}>
                      <Trash class="size-3.5" />
                    </Button>
                  {/if}
                </div>
                <div class="flex items-center gap-3">
                  <Input bind:value={field.helpText} placeholder="Help text shown below the input (optional)" />
                  <label class="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                    <input
                      type="checkbox"
                      bind:checked={field.required}
                      class="h-3.5 w-3.5 rounded border-border"
                    />
                    Required
                  </label>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            No structured detail fields defined — sites will free-form document this category.
          </div>
        {/if}
      </div>
    </div>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (catOpen = false)}>Cancel</Button>
      <Button disabled={catSaveDisabled} onclick={() => saveCategory.mutate(catDraft)}>Save category</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
