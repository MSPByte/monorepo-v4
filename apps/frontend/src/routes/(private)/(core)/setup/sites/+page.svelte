<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Search from '@lucide/svelte/icons/search';
  import Trash from '@lucide/svelte/icons/trash-2';

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

  // -- Field editor state ----------------------------------------------------
  type FieldDraft = {
    id?: string;
    key: string;
    label: string;
    section: 'executive' | 'context';
    type: 'string' | 'number' | 'boolean';
    valueMode: 'single' | 'multiple';
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
    displayOrder: 100,
    values: [],
    active: true,
  };

  let fieldOpen = $state(false);
  let fieldDraft = $state<FieldDraft>({ ...emptyField });
  let optionSearch = $state('');
  let newOptionValue = $state('');

  function openNewField() {
    fieldDraft = { ...emptyField };
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
      displayOrder: row.displayOrder,
      values: [...(row.values ?? [])],
      active: row.active,
    };
    optionSearch = '';
    newOptionValue = '';
    fieldOpen = true;
  }

  function labelForOption(value: string) {
    const special: Record<string, string> = {
      critical: 'Critical',
      mission_critical: 'Critical',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      active: 'Active',
      prospect: 'Prospect',
      former: 'Former',
      internal: 'Internal',
      standard: 'Standard',
      premium: 'Premium',
      enterprise: 'Enterprise',
      yes: 'Yes',
      no: 'No',
      unknown: 'Unknown',
      on_call: 'On call',
      cab_only: 'CAB only',
      business_hours: 'Business hours',
      extended_hours: 'Extended hours',
      '24x7': '24/7',
    };
    return (
      special[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    );
  }

  const visibleOptions = $derived.by(() => {
    const search = optionSearch.trim().toLowerCase();
    if (!search) return fieldDraft.values;
    return fieldDraft.values.filter((value) => {
      const label = labelForOption(value);
      return value.toLowerCase().includes(search) || label.toLowerCase().includes(search);
    });
  });

  function addOption() {
    const value = newOptionValue.trim();
    if (!value || fieldDraft.values.includes(value)) return;
    fieldDraft.values = [...fieldDraft.values, value];
    newOptionValue = '';
    optionSearch = '';
  }

  function removeOption(value: string) {
    fieldDraft.values = fieldDraft.values.filter((option) => option !== value);
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
        displayOrder: input.displayOrder,
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

  const deleteField = createMutation(() => ({
    mutationFn: (id: string) => trpc.siteProfile.deleteField.mutate({ id }),
    onSuccess: () => {
      toast.success('Field deleted');
      qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  // -- Category editor state -------------------------------------------------
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

  const emptyCategory: CategoryDraft = {
    key: '',
    label: '',
    description: '',
    required: false,
    displayOrder: 100,
    metadataFields: [],
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
      displayOrder: row.displayOrder,
      metadataFields: (row.metadataFields ?? []).map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required ?? false,
        helpText: field.helpText ?? '',
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

  const saveCategory = createMutation(() => ({
    mutationFn: (input: CategoryDraft) =>
      trpc.siteProfile.upsertCategory.mutate({
        id: input.id,
        key: input.key,
        label: input.label,
        description: input.description,
        required: input.required,
        displayOrder: input.displayOrder,
        metadataFields: input.metadataFields
          .filter((field) => field.key && field.label)
          .map((field) => ({
            ...field,
            helpText: field.helpText || null,
          })),
      }),
    onSuccess: () => {
      catOpen = false;
      toast.success('Category saved');
      qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const deleteCategory = createMutation(() => ({
    mutationFn: (id: string) => trpc.siteProfile.deleteCategory.mutate({ id }),
    onSuccess: () => {
      toast.success('Category deleted');
      qc.invalidateQueries({ queryKey: ['siteProfile.catalog'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));
</script>

<div class="flex flex-col size-full gap-4 p-4 lg:p-6 overflow-auto">
  <div>
    <h1 class="text-xl font-semibold">Site Profile Setup</h1>
    <p class="text-sm text-muted-foreground">
      Define the fields and stack categories used to document every site. Default entries are seeded
      for each MSP and can be adjusted to match your operating model.
    </p>
  </div>

  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-base font-semibold">Profile Fields</h2>
        <p class="text-xs text-muted-foreground">
          Executive identity and Business Context entries that show up on every site profile.
        </p>
      </div>
      {#if canWriteSites}
        <Button size="sm" onclick={openNewField}>
          <Plus class="size-3.5" />
          New Field
        </Button>
      {/if}
    </div>

    <div class="overflow-x-auto border border-border">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr
            class="border-b border-border bg-muted/40 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            <th class="px-2 py-1.5">Key</th>
            <th class="px-2 py-1.5">Label</th>
            <th class="px-2 py-1.5">Section</th>
            <th class="px-2 py-1.5">Type</th>
            <th class="px-2 py-1.5">Mode</th>
            <th class="px-2 py-1.5">Options</th>
            <th class="px-2 py-1.5">Order</th>
            <th class="px-2 py-1.5">Origin</th>
            <th class="px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {#each fields as f (f.key)}
            <tr class="border-b border-border/40 last:border-b-0">
              <td class="px-2 py-1.5 font-mono text-[12px]">{f.key}</td>
              <td class="px-2 py-1.5">{f.label}</td>
              <td class="px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider">
                {f.section}
              </td>
              <td class="px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider">{f.type}</td>
              <td class="px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider">
                {f.valueMode ?? 'single'}
              </td>
              <td class="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                {f.values && f.values.length ? f.values.join(', ') : '—'}
              </td>
              <td class="px-2 py-1.5 font-mono text-[11px] tabular-nums">{f.displayOrder}</td>
              <td class="px-2 py-1.5">
                <span
                  class={`rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    f.builtIn
                      ? 'bg-primary/10 text-primary'
                      : 'bg-foreground/[0.07] text-foreground/80'
                  }`}
                >
                  {f.builtIn ? 'built-in' : 'custom'}
                </span>
              </td>
              <td class="px-2 py-1.5 text-right">
                <div class="flex justify-end gap-1">
                  {#if canWriteSites}
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7"
                      onclick={() => openEditField(f)}
                    >
                      <Pencil class="size-3.5" />
                    </Button>
                  {/if}
                  {#if !f.builtIn && canDeleteSites}
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7 text-destructive"
                      onclick={() => f.id && deleteField.mutate(f.id)}
                    >
                      <Trash class="size-3.5" />
                    </Button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="space-y-3">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-base font-semibold">Stack Categories</h2>
        <p class="text-xs text-muted-foreground">
          Required categories (RMM, EDR, Identity, Email, Backup) must be answered for every site,
          even when no integration is linked.
        </p>
      </div>
      {#if canWriteSites}
        <Button size="sm" onclick={openNewCategory}>
          <Plus class="size-3.5" />
          New Category
        </Button>
      {/if}
    </div>

    <div class="overflow-x-auto border border-border">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr
            class="border-b border-border bg-muted/40 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            <th class="px-2 py-1.5">Key</th>
            <th class="px-2 py-1.5">Label</th>
            <th class="px-2 py-1.5">Description</th>
            <th class="px-2 py-1.5">Details</th>
            <th class="px-2 py-1.5">Required</th>
            <th class="px-2 py-1.5">Order</th>
            <th class="px-2 py-1.5">Origin</th>
            <th class="px-2 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {#each categories as c (c.key)}
            <tr class="border-b border-border/40 last:border-b-0">
              <td class="px-2 py-1.5 font-mono text-[12px]">{c.key}</td>
              <td class="px-2 py-1.5">{c.label}</td>
              <td class="px-2 py-1.5 text-muted-foreground">{c.description || '—'}</td>
              <td class="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                {c.metadataFields?.length ?? 0}
              </td>
              <td class="px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider">
                {c.required ? 'yes' : 'no'}
              </td>
              <td class="px-2 py-1.5 font-mono text-[11px] tabular-nums">{c.displayOrder}</td>
              <td class="px-2 py-1.5">
                <span
                  class={`rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    c.builtIn
                      ? 'bg-primary/10 text-primary'
                      : 'bg-foreground/[0.07] text-foreground/80'
                  }`}
                >
                  {c.builtIn ? 'built-in' : 'custom'}
                </span>
              </td>
              <td class="px-2 py-1.5 text-right">
                <div class="flex justify-end gap-1">
                  {#if canWriteSites}
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7"
                      onclick={() => openEditCategory(c)}
                    >
                      <Pencil class="size-3.5" />
                    </Button>
                  {/if}
                  {#if !c.builtIn && canDeleteSites}
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7 text-destructive"
                      onclick={() => c.id && deleteCategory.mutate(c.id)}
                    >
                      <Trash class="size-3.5" />
                    </Button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>

<Dialog.Root bind:open={fieldOpen}>
  <Dialog.Content class="sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title>{fieldDraft.id ? 'Edit field' : 'New profile field'}</Dialog.Title>
      <Dialog.Description>
        Fields appear on every site profile under the section you choose.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4 p-4">
      <div class="grid gap-1.5">
        <Label for="field-label">Label</Label>
        <Input id="field-label" bind:value={fieldDraft.label} placeholder="Field label" />
      </div>
      <div class="grid gap-3 md:grid-cols-[1fr_150px]">
        <div class="grid gap-1.5">
          <Label for="field-key">Key</Label>
          <Input
            id="field-key"
            bind:value={fieldDraft.key}
            disabled={!!fieldDraft.id}
            placeholder="snake_case_key"
          />
        </div>
        <div class="grid gap-1.5">
          <Label for="field-order">Order</Label>
          <Input id="field-order" type="number" bind:value={fieldDraft.displayOrder} />
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="grid gap-1.5">
          <Label>Section</Label>
          <Select.Root
            type="single"
            value={fieldDraft.section}
            onValueChange={(v) => v && (fieldDraft.section = v as 'executive' | 'context')}
          >
            <Select.Trigger>{fieldDraft.section}</Select.Trigger>
            <Select.Content>
              <Select.Item value="executive">executive</Select.Item>
              <Select.Item value="context">context</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-1.5">
          <Label>Type</Label>
          <Select.Root
            type="single"
            value={fieldDraft.type}
            onValueChange={(v) => v && (fieldDraft.type = v as 'string' | 'number' | 'boolean')}
          >
            <Select.Trigger>{fieldDraft.type}</Select.Trigger>
            <Select.Content>
              <Select.Item value="string">string</Select.Item>
              <Select.Item value="number">number</Select.Item>
              <Select.Item value="boolean">boolean</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-1.5">
          <Label>Value Mode</Label>
          <Select.Root
            type="single"
            value={fieldDraft.valueMode}
            onValueChange={(v) => v && (fieldDraft.valueMode = v as 'single' | 'multiple')}
          >
            <Select.Trigger>{fieldDraft.valueMode}</Select.Trigger>
            <Select.Content>
              <Select.Item value="single">single</Select.Item>
              <Select.Item value="multiple">multiple</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="grid gap-1.5">
        <Label for="field-values">Allowed Options</Label>
        <div class="rounded-md border border-border bg-muted/20">
          <div class="grid gap-2 border-b border-border p-2 md:grid-cols-[1fr_auto]">
            <div class="relative">
              <Search
                class="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="field-values"
                bind:value={optionSearch}
                class="pl-7"
                placeholder={`Search ${fieldDraft.values.length} options`}
              />
            </div>
            <div class="flex gap-2">
              <Input
                bind:value={newOptionValue}
                placeholder="Add option value"
                onkeydown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addOption();
                  }
                }}
              />
              <Button type="button" variant="outline" size="icon" onclick={addOption}>
                <Plus class="size-4" />
              </Button>
            </div>
          </div>

          {#if fieldDraft.values.length}
            <div class="max-h-64 overflow-auto p-1">
              {#each visibleOptions as option (option)}
                <div
                  class="grid grid-cols-[minmax(0,1fr)_minmax(120px,0.65fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-background"
                >
                  <div class="min-w-0 truncate font-medium">{labelForOption(option)}</div>
                  <div class="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {option}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="size-7 text-muted-foreground hover:text-destructive"
                    onclick={() => removeOption(option)}
                  >
                    <Trash class="size-3.5" />
                  </Button>
                </div>
              {:else}
                <div class="px-2 py-6 text-center text-xs text-muted-foreground">
                  No options match this search.
                </div>
              {/each}
            </div>
          {:else}
            <div class="px-3 py-6 text-center text-xs text-muted-foreground">
              No allowed options. This field will be free-form.
            </div>
          {/if}
        </div>
      </div>
    </div>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (fieldOpen = false)}>Cancel</Button>
      <Button
        disabled={saveField.isPending || !fieldDraft.key || !fieldDraft.label || !canWriteSites}
        onclick={() => saveField.mutate(fieldDraft)}
      >
        Save
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={catOpen}>
  <Dialog.Content class="sm:max-w-[760px]">
    <Dialog.Header>
      <Dialog.Title>{catDraft.id ? 'Edit category' : 'New stack category'}</Dialog.Title>
      <Dialog.Description>
        Stack categories define what platforms every site is expected to have an answer for.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid max-h-[72vh] gap-4 overflow-y-auto p-4">
      <div class="grid gap-1.5">
        <Label for="cat-key">Key</Label>
        <Input
          id="cat-key"
          bind:value={catDraft.key}
          disabled={!!catDraft.id}
          placeholder="snake_case_key"
        />
      </div>
      <div class="grid gap-1.5">
        <Label for="cat-label">Label</Label>
        <Input id="cat-label" bind:value={catDraft.label} placeholder="Display name" />
      </div>
      <div class="grid gap-1.5">
        <Label for="cat-desc">Description</Label>
        <Input id="cat-desc" bind:value={catDraft.description} placeholder="What is this for?" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-1.5">
          <Label for="cat-required">Required</Label>
          <Select.Root
            type="single"
            value={catDraft.required ? 'yes' : 'no'}
            onValueChange={(v) => (catDraft.required = v === 'yes')}
          >
            <Select.Trigger>{catDraft.required ? 'yes' : 'no'}</Select.Trigger>
            <Select.Content>
              <Select.Item value="yes">yes</Select.Item>
              <Select.Item value="no">no</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-1.5">
          <Label for="cat-order">Display Order</Label>
          <Input id="cat-order" type="number" bind:value={catDraft.displayOrder} />
        </div>
      </div>
      <div class="grid gap-2">
        <div class="flex items-center justify-between gap-2">
          <div>
            <Label>Expected Details</Label>
            <p class="text-xs text-muted-foreground">
              These fields appear when documenting this category on a site.
            </p>
          </div>
          {#if canWriteSites}
            <Button type="button" variant="outline" size="sm" onclick={addCategoryMetadataField}>
              <Plus class="size-3.5" />
              Add Detail
            </Button>
          {/if}
        </div>
        {#if catDraft.metadataFields.length}
          <div class="grid gap-2">
            {#each catDraft.metadataFields as field, i (`${field.key}-${i}`)}
              <div class="grid gap-2 rounded-md border border-border p-2">
                <div
                  class="grid gap-2 md:grid-cols-[minmax(120px,0.7fr)_minmax(140px,1fr)_120px_96px_auto]"
                >
                  <Input
                    bind:value={field.key}
                    placeholder="field_key"
                    oninput={() => {
                      field.key = field.key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                    }}
                  />
                  <Input bind:value={field.label} placeholder="Label" />
                  <Select.Root
                    type="single"
                    value={field.type}
                    onValueChange={(v) =>
                      v &&
                      (field.type = v as
                        | 'string'
                        | 'number'
                        | 'boolean'
                        | 'url'
                        | 'ip'
                        | 'secret_ref')}
                  >
                    <Select.Trigger>{field.type}</Select.Trigger>
                    <Select.Content>
                      <Select.Item value="string">string</Select.Item>
                      <Select.Item value="number">number</Select.Item>
                      <Select.Item value="boolean">boolean</Select.Item>
                      <Select.Item value="url">url</Select.Item>
                      <Select.Item value="ip">ip</Select.Item>
                      <Select.Item value="secret_ref">secret ref</Select.Item>
                    </Select.Content>
                  </Select.Root>
                  <Select.Root
                    type="single"
                    value={field.required ? 'yes' : 'no'}
                    onValueChange={(v) => (field.required = v === 'yes')}
                  >
                    <Select.Trigger>{field.required ? 'required' : 'optional'}</Select.Trigger>
                    <Select.Content>
                      <Select.Item value="no">optional</Select.Item>
                      <Select.Item value="yes">required</Select.Item>
                    </Select.Content>
                  </Select.Root>
                  {#if canWriteSites}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="size-8 text-muted-foreground hover:text-destructive"
                      onclick={() => removeCategoryMetadataField(i)}
                    >
                      <Trash class="size-3.5" />
                    </Button>
                  {/if}
                </div>
                <Input bind:value={field.helpText} placeholder="Help text or data entry guidance" />
              </div>
            {/each}
          </div>
        {:else}
          <div
            class="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
          >
            No structured detail fields defined.
          </div>
        {/if}
      </div>
    </div>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (catOpen = false)}>Cancel</Button>
      <Button
        disabled={saveCategory.isPending || !catDraft.key || !catDraft.label || !canWriteSites}
        onclick={() => saveCategory.mutate(catDraft)}
      >
        Save
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
