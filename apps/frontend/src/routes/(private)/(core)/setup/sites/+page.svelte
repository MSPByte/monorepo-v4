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
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Search from '@lucide/svelte/icons/search';
  import Trash from '@lucide/svelte/icons/trash-2';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

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
  };

  const emptyCategory: CategoryDraft = {
    key: '',
    label: '',
    description: '',
    required: false,
    displayOrder: 100,
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
    };
    catOpen = true;
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
      <Button size="sm" onclick={openNewField}>
        <Plus class="size-3.5" />
        New Field
      </Button>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7"
                    onclick={() => openEditField(f)}
                  >
                    <Pencil class="size-3.5" />
                  </Button>
                  {#if !f.builtIn}
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
      <Button size="sm" onclick={openNewCategory}>
        <Plus class="size-3.5" />
        New Category
      </Button>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7"
                    onclick={() => openEditCategory(c)}
                  >
                    <Pencil class="size-3.5" />
                  </Button>
                  {#if !c.builtIn}
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
        disabled={saveField.isPending || !fieldDraft.key || !fieldDraft.label}
        onclick={() => saveField.mutate(fieldDraft)}
      >
        Save
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={catOpen}>
  <Dialog.Content class="sm:max-w-[480px]">
    <Dialog.Header>
      <Dialog.Title>{catDraft.id ? 'Edit category' : 'New stack category'}</Dialog.Title>
      <Dialog.Description>
        Stack categories define what platforms every site is expected to have an answer for.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-3 p-4">
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
    </div>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (catOpen = false)}>Cancel</Button>
      <Button
        disabled={saveCategory.isPending || !catDraft.key || !catDraft.label}
        onclick={() => saveCategory.mutate(catDraft)}
      >
        Save
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
