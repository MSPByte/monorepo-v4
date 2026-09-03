<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Plus, Pencil, Trash2, GripVertical, X } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { toUserMessage, logError } from '$lib/utils/errors';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  type FieldType = 'text' | 'textarea' | 'select' | 'email' | 'phone' | 'checkbox' | 'number' | 'image';

  interface FormField {
    id: string;
    type: FieldType;
    label: string;
    required: boolean;
    col_span: 1 | 2 | 3;
    placeholder?: string;
    options?: string[];
  }

  interface FormRow {
    cols: FormField[];
  }

  interface PsaMapping {
    psa_field: string;
  }

  const FIELD_TYPES: { value: FieldType; label: string }[] = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Long Text' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'select', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'number', label: 'Number' },
    { value: 'image', label: 'Image / Screenshot' },
  ];

  const PSA_FIELDS = [
    { value: '', label: '— none —' },
    { value: 'summary', label: 'Ticket Summary' },
    { value: 'description', label: 'Description' },
    { value: 'name', label: 'Contact Name' },
    { value: 'email', label: 'Contact Email' },
    { value: 'phone', label: 'Contact Phone' },
  ];

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const canWrite = $derived(authStore.isAllowed('Agents.Write'));
  const canDelete = $derived(authStore.isAllowed('Agents.Delete'));

  const formsQuery = createQuery(() => ({
    queryKey: ['forms.list'],
    queryFn: () => trpc.forms.list.query(),
  }));

  const forms = $derived(formsQuery.data ?? []);

  // Editor state
  let editorOpen = $state(false);
  let editingId = $state<string | null>(null);
  let formName = $state('');
  let formDescription = $state('');
  let formRows = $state<FormRow[]>([]);
  let psaMappings = $state<Record<string, PsaMapping>>({});
  let saving = $state(false);

  let deleteDialogId = $state<string | null>(null);
  let deleting = $state(false);

  function openNew() {
    editingId = null;
    formName = '';
    formDescription = '';
    formRows = [];
    psaMappings = {};
    editorOpen = true;
  }

  async function openEdit(id: string) {
    try {
      const row = await trpc.forms.get.query({ id });
      editingId = id;
      formName = row.name;
      formDescription = row.description ?? '';
      formRows = (row.rows as FormRow[]) ?? [];
      psaMappings = (row.psaMappings as Record<string, PsaMapping>) ?? {};
      editorOpen = true;
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to load form'));
    }
  }

  function addRow() {
    formRows = [
      ...formRows,
      { cols: [newField()] },
    ];
  }

  function newField(): FormField {
    return {
      id: crypto.randomUUID(),
      type: 'text',
      label: '',
      required: false,
      col_span: 3,
    };
  }

  function addFieldToRow(rowIdx: number) {
    const row = formRows[rowIdx];
    const used = row.cols.reduce((s, f) => s + f.col_span, 0);
    if (used >= 3) return;
    formRows = formRows.map((r, i) =>
      i === rowIdx ? { cols: [...r.cols, { ...newField(), col_span: Math.min(3 - used, 3) as 1 | 2 | 3 }] } : r
    );
  }

  function removeField(rowIdx: number, colIdx: number) {
    const updated = formRows.map((r, i) => {
      if (i !== rowIdx) return r;
      const cols = r.cols.filter((_, ci) => ci !== colIdx);
      return { cols };
    }).filter((r) => r.cols.length > 0);
    formRows = updated;
  }

  function removeRow(rowIdx: number) {
    formRows = formRows.filter((_, i) => i !== rowIdx);
  }

  function updateField(rowIdx: number, colIdx: number, patch: Partial<FormField>) {
    formRows = formRows.map((r, ri) => {
      if (ri !== rowIdx) return r;
      return { cols: r.cols.map((f, ci) => (ci === colIdx ? { ...f, ...patch } : f)) };
    });
  }

  function getPsaField(fieldId: string): string {
    return psaMappings[fieldId]?.psa_field ?? '';
  }

  function setPsaField(fieldId: string, psaField: string) {
    const next = { ...psaMappings };
    if (psaField) {
      next[fieldId] = { psa_field: psaField };
    } else {
      delete next[fieldId];
    }
    psaMappings = next;
  }

  const createMut = createMutation(() => ({
    mutationFn: (data: Parameters<typeof trpc.forms.create.mutate>[0]) =>
      trpc.forms.create.mutate(data),
  }));

  const updateMut = createMutation(() => ({
    mutationFn: (data: Parameters<typeof trpc.forms.update.mutate>[0]) =>
      trpc.forms.update.mutate(data),
  }));

  const deleteMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.forms.delete.mutate({ id }),
  }));

  async function handleSave() {
    if (!formName.trim()) {
      toast.error('Form name is required');
      return;
    }
    saving = true;
    try {
      if (editingId) {
        await updateMut.mutateAsync({
          id: editingId,
          name: formName,
          description: formDescription || undefined,
          rows: formRows,
          psaMappings,
        });
        toast.success('Form updated');
      } else {
        await createMut.mutateAsync({
          name: formName,
          description: formDescription || undefined,
          rows: formRows,
          psaMappings,
        });
        toast.success('Form created');
      }
      queryClient.invalidateQueries({ queryKey: ['forms.list'] });
      editorOpen = false;
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to save form'));
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    if (!deleteDialogId) return;
    deleting = true;
    try {
      await deleteMut.mutateAsync(deleteDialogId);
      queryClient.invalidateQueries({ queryKey: ['forms.list'] });
      toast.success('Form deleted');
      deleteDialogId = null;
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to delete form'));
    } finally {
      deleting = false;
    }
  }
</script>

<!-- Delete confirm -->
<AlertDialog.Root open={!!deleteDialogId} onOpenChange={(o) => { if (!o) deleteDialogId = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete form?</AlertDialog.Title>
      <AlertDialog.Description>
        This will remove the form. Existing ticket submissions are not affected.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={handleDelete}
        disabled={deleting}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {deleting ? 'Deleting...' : 'Delete'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- Form editor dialog -->
<Dialog.Root bind:open={editorOpen}>
  <Dialog.Content class="max-w-3xl max-h-[90vh] flex flex-col">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>{editingId ? 'Edit Form' : 'New Form'}</Dialog.Title>
    </Dialog.Header>

    <div class="flex flex-col gap-5 overflow-y-auto py-2 px-1 flex-1">
      <!-- Name + description -->
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="form-name">Form Name</label>
          <Input id="form-name" bind:value={formName} placeholder="e.g. Support Request" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="form-desc">Description (optional)</label>
          <Input id="form-desc" bind:value={formDescription} placeholder="Short description shown to users" />
        </div>
      </div>

      <!-- Field rows -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold">Fields</span>
          <Button type="button" size="sm" variant="outline" onclick={addRow} class="gap-1.5">
            <Plus class="size-3.5" />
            Add Row
          </Button>
        </div>

        {#each formRows as row, rowIdx}
          <div class="border rounded-md p-3 flex flex-col gap-3 bg-muted/20">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">Row {rowIdx + 1}</span>
              <div class="flex gap-1">
                {#if row.cols.reduce((s, f) => s + f.col_span, 0) < 3}
                  <Button type="button" size="sm" variant="ghost" class="h-6 px-2 text-xs" onclick={() => addFieldToRow(rowIdx)}>
                    + Field
                  </Button>
                {/if}
                <Button type="button" size="sm" variant="ghost" class="h-6 px-2 text-destructive" onclick={() => removeRow(rowIdx)}>
                  <X class="size-3" />
                </Button>
              </div>
            </div>

            <!-- 3-col grid -->
            <div class="grid grid-cols-3 gap-2">
              {#each row.cols as field, colIdx}
                <div
                  class="col-span-{field.col_span} border rounded p-2.5 flex flex-col gap-2 bg-background"
                  style="grid-column: span {field.col_span}"
                >
                  <div class="flex items-center justify-between gap-1">
                    <input
                      type="text"
                      value={field.label}
                      oninput={(e) => updateField(rowIdx, colIdx, { label: (e.currentTarget as HTMLInputElement).value })}
                      placeholder="Field label"
                      class="flex-1 text-sm px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button type="button" onclick={() => removeField(rowIdx, colIdx)} class="text-muted-foreground hover:text-destructive">
                      <X class="size-3.5" />
                    </button>
                  </div>

                  <div class="grid grid-cols-2 gap-1.5">
                    <div class="flex flex-col gap-0.5">
                      <span class="text-xs text-muted-foreground">Type</span>
                      <select
                        value={field.type}
                        onchange={(e) => updateField(rowIdx, colIdx, { type: (e.currentTarget as HTMLSelectElement).value as FieldType })}
                        class="text-xs px-1.5 py-1 rounded border bg-background focus:outline-none"
                      >
                        {#each FIELD_TYPES as ft}
                          <option value={ft.value}>{ft.label}</option>
                        {/each}
                      </select>
                    </div>

                    <div class="flex flex-col gap-0.5">
                      <span class="text-xs text-muted-foreground">Span</span>
                      <select
                        value={field.col_span}
                        onchange={(e) => updateField(rowIdx, colIdx, { col_span: Number((e.currentTarget as HTMLSelectElement).value) as 1 | 2 | 3 })}
                        class="text-xs px-1.5 py-1 rounded border bg-background focus:outline-none"
                      >
                        <option value={1}>1 col</option>
                        <option value={2}>2 cols</option>
                        <option value={3}>3 cols</option>
                      </select>
                    </div>
                  </div>

                  <div class="flex flex-col gap-0.5">
                    <span class="text-xs text-muted-foreground">PSA Field</span>
                    <select
                      value={getPsaField(field.id)}
                      onchange={(e) => setPsaField(field.id, (e.currentTarget as HTMLSelectElement).value)}
                      class="text-xs px-1.5 py-1 rounded border bg-background focus:outline-none"
                    >
                      {#each PSA_FIELDS as pf}
                        <option value={pf.value}>{pf.label}</option>
                      {/each}
                    </select>
                  </div>

                  <label class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onchange={(e) => updateField(rowIdx, colIdx, { required: (e.currentTarget as HTMLInputElement).checked })}
                      class="rounded"
                    />
                    Required
                  </label>
                </div>
              {/each}
            </div>
          </div>
        {/each}

        {#if formRows.length === 0}
          <div class="text-sm text-muted-foreground text-center py-6 border rounded-md border-dashed">
            No fields yet. Click <strong>Add Row</strong> to start building your form.
          </div>
        {/if}
      </div>
    </div>

    <div class="flex justify-end gap-2 pt-2 shrink-0 border-t">
      <Button variant="outline" onclick={() => (editorOpen = false)}>Cancel</Button>
      <Button onclick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Form'}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Page -->
<div class="flex flex-col size-full p-4 gap-4 overflow-hidden">
  <div class="flex items-center justify-between shrink-0">
    <div>
      <h2 class="text-sm font-semibold">Forms</h2>
      <p class="text-xs text-muted-foreground">Configure the support forms shown in the agent tray.</p>
    </div>
    {#if canWrite}
      <Button size="sm" onclick={openNew} class="gap-1.5">
        <Plus class="size-4" />
        New Form
      </Button>
    {/if}
  </div>

  {#if formsQuery.isLoading}
    <Loader />
  {:else if forms.length === 0}
    <div class="flex items-center justify-center flex-1 text-sm text-muted-foreground">
      No forms yet. Create one to let agents submit support tickets.
    </div>
  {:else}
    <div class="flex flex-col gap-2 overflow-y-auto">
      {#each forms as form}
        <Card.Root class="flex items-center px-4 py-3 gap-3">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{form.name}</p>
            {#if form.description}
              <p class="text-xs text-muted-foreground truncate">{form.description}</p>
            {/if}
          </div>
          <span class="text-xs text-muted-foreground shrink-0">
            Updated {new Date(form.updatedAt).toLocaleDateString()}
          </span>
          <div class="flex items-center gap-1 shrink-0">
            {#if canWrite}
              <Button size="sm" variant="ghost" class="h-8 w-8 p-0" onclick={() => openEdit(form.id)} title="Edit">
                <Pencil class="size-3.5" />
              </Button>
            {/if}
            {#if canDelete}
              <Button
                size="sm"
                variant="ghost"
                class="h-8 w-8 p-0 text-destructive hover:text-destructive"
                onclick={() => (deleteDialogId = form.id)}
                title="Delete"
              >
                <Trash2 class="size-3.5" />
              </Button>
            {/if}
          </div>
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
