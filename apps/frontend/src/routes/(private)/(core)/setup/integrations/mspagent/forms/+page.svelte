<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import type { Component } from 'svelte';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import type { AgentFieldType, AgentFormField, AgentFormRow } from '@mspbyte/shared';
  import { AGENT_PSA_SOURCES, AGENT_PSA_METRICS, AGENT_SYSTEM_VARS } from '@mspbyte/shared';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import AgentFormPreview from '$lib/components/agent-form-preview.svelte';
  import {
    ArrowLeft,
    Plus,
    Pencil,
    Trash2,
    ChevronUp,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Minus,
    Heading2,
    Type,
    AlignLeft,
    Phone,
    Mail,
    Hash,
    CheckSquare,
    ListFilter,
    Paperclip,
    Eye,
    FileText,
    X,
    GripVertical,
    LayoutGrid,
    Variable,
  } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { toUserMessage } from '$lib/utils/errors';
  import { authStore } from '$lib/stores/auth.store.svelte';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface FieldMeta {
    label: string;
    shortLabel: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: Component<any>;
    defaultColSpan: 1 | 2 | 3;
    hasLabel: boolean;
    hasRequired: boolean;
    hasPlaceholder: boolean;
  }

  const FIELD_META: Record<AgentFieldType, FieldMeta> = {
    spacer:     { label: 'Blank space',  shortLabel: 'Space',  icon: Minus,       defaultColSpan: 1, hasLabel: false, hasRequired: false, hasPlaceholder: false },
    title:      { label: 'Section title',shortLabel: 'Title',  icon: Heading2,    defaultColSpan: 3, hasLabel: true,  hasRequired: false, hasPlaceholder: false },
    text:       { label: 'Text',         shortLabel: 'Text',   icon: Type,        defaultColSpan: 3, hasLabel: true,  hasRequired: true,  hasPlaceholder: true  },
    textarea:   { label: 'Long text',    shortLabel: 'Area',   icon: AlignLeft,   defaultColSpan: 3, hasLabel: true,  hasRequired: true,  hasPlaceholder: true  },
    phone:      { label: 'Phone number', shortLabel: 'Phone',  icon: Phone,       defaultColSpan: 2, hasLabel: true,  hasRequired: true,  hasPlaceholder: true  },
    email:      { label: 'Email',        shortLabel: 'Email',  icon: Mail,        defaultColSpan: 2, hasLabel: true,  hasRequired: true,  hasPlaceholder: true  },
    number:     { label: 'Number',       shortLabel: 'Num',    icon: Hash,        defaultColSpan: 1, hasLabel: true,  hasRequired: true,  hasPlaceholder: true  },
    checkbox:   { label: 'Checkbox',     shortLabel: 'Check',  icon: CheckSquare, defaultColSpan: 3, hasLabel: true,  hasRequired: false, hasPlaceholder: false },
    select:     { label: 'Dropdown',     shortLabel: 'Select', icon: ListFilter,  defaultColSpan: 2, hasLabel: true,  hasRequired: true,  hasPlaceholder: true  },
    attachment: { label: 'Attachment',   shortLabel: 'File',   icon: Paperclip,   defaultColSpan: 3, hasLabel: true,  hasRequired: false, hasPlaceholder: false },
  };

  const FIELD_TYPES_ORDERED: AgentFieldType[] = [
    'text', 'textarea', 'email', 'phone', 'number',
    'checkbox', 'select', 'attachment', 'title', 'spacer',
  ];

  function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  }

  // ── Context + permissions ────────────────────────────────────────────────────

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const canWrite = $derived(authStore.isAllowed('Agents.Write'));
  const canDelete = $derived(authStore.isAllowed('Agents.Delete'));

  // ── Editor state ─────────────────────────────────────────────────────────────

  let editingFormId = $state<string | null>(null);
  let formName = $state('');
  let formDescription = $state('');
  let ticketTitle = $state('');
  let ticketBody = $state('');
  let formRows = $state<AgentFormRow[]>([]);
  let saving = $state(false);

  // Selection
  let selectedRowId = $state<string | null>(null);
  let selectedColIdx = $state<number | null>(null);
  let addingToRowId = $state<string | null>(null);
  let rightPanelTab = $state<'preview' | 'template'>('preview');
  let templateFocus = $state<'title' | 'body' | null>(null);
  let titleInputEl = $state<HTMLInputElement | null>(null);
  let bodyTextareaEl = $state<HTMLTextAreaElement | null>(null);

  function insertVar(key: string) {
    const tag = '{{' + key + '}}';
    const el: HTMLInputElement | HTMLTextAreaElement | null = templateFocus === 'title' ? titleInputEl : bodyTextareaEl;
    if (!el) {
      if (templateFocus === 'title') ticketTitle += tag;
      else if (templateFocus === 'body') ticketBody += tag;
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + tag + el.value.slice(end);
    if (templateFocus === 'title') ticketTitle = newVal;
    else ticketBody = newVal;
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  }

  // Derived selection
  const selectedField = $derived(
    selectedRowId !== null && selectedColIdx !== null
      ? (formRows.find(r => r.id === selectedRowId)?.cols[selectedColIdx] ?? null)
      : null
  );

  // All fields that expose a hydration variable, for the template editor hint list
  const hydrationVars = $derived(
    formRows.flatMap(r => r.cols)
      .filter(f => f.hydrationKey && f.type !== 'spacer' && f.type !== 'title')
      .map(f => ({ key: f.hydrationKey!, label: f.label || f.type }))
  );

  // ── Delete dialog ─────────────────────────────────────────────────────────────

  let deleteDialogId = $state<string | null>(null);
  let deleting = $state(false);

  // ── Mutations ────────────────────────────────────────────────────────────────

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

  const BACK = '/setup/integrations/mspagent?tab=forms';

  // ── Editor load / save ───────────────────────────────────────────────────────

  function normalizeField(f: AgentFormField, cols_max: number): AgentFormField {
    const col_span = Math.min(f.col_span ?? 1, cols_max) as 1 | 2 | 3;
    // Migrate legacy image / screenshot → attachment
    if ((f.type as string) === 'image') {
      return { ...f, id: f.id ?? crypto.randomUUID(), col_span, type: 'attachment', allowUpload: true, allowScreenshot: false };
    }
    if ((f.type as string) === 'screenshot') {
      return { ...f, id: f.id ?? crypto.randomUUID(), col_span, type: 'attachment', allowUpload: true, allowScreenshot: true };
    }
    // Auto-set hydrationKey from label for fields that don't have one yet
    const hydrationKey = f.hydrationKey || (f.label ? slugify(f.label) : undefined);
    return { ...f, id: f.id ?? crypto.randomUUID(), col_span, hydrationKey };
  }

  function normalizeRows(raw: unknown): AgentFormRow[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((r: unknown) => {
      const row = r as Record<string, unknown>;
      const cols_max = (row.cols_max === 2 || row.cols_max === 3) ? row.cols_max : 3;
      return {
        id: (row.id as string | undefined) ?? crypto.randomUUID(),
        cols_max,
        cols: Array.isArray(row.cols)
          ? row.cols.map((c: unknown) => normalizeField(c as AgentFormField, cols_max))
          : [],
      };
    });
  }

  onMount(async () => {
    const id = get(page).url.searchParams.get('id');
    if (id) {
      try {
        const row = await trpc.forms.get.query({ id });
        editingFormId = id;
        formName = row.name;
        formDescription = row.description ?? '';
        ticketTitle = (row as Record<string, unknown>).ticketTitle as string ?? '';
        ticketBody = (row as Record<string, unknown>).ticketBody as string ?? '';
        formRows = normalizeRows(row.rows);
      } catch (err) {
        toast.error(toUserMessage(err, 'Failed to load form'));
        goto(BACK);
      }
    } else {
      editingFormId = null;
      formName = 'New Form';
      formDescription = '';
      ticketTitle = '';
      ticketBody = '';
      formRows = [];
    }
  });

  async function handleSave() {
    if (!formName.trim()) {
      toast.error('Form name is required');
      return;
    }
    saving = true;
    try {
      const payload = {
        name: formName,
        description: formDescription || undefined,
        rows: formRows,
        ticketTitle: ticketTitle || undefined,
        ticketBody: ticketBody || undefined,
      };
      if (editingFormId) {
        await updateMut.mutateAsync({ id: editingFormId, ...payload });
        toast.success('Form saved');
      } else {
        const result = await createMut.mutateAsync(payload);
        editingFormId = result?.id ?? null;
        toast.success('Form created');
      }
      queryClient.invalidateQueries({ queryKey: ['forms.list'] });
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
      goto(BACK);
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to delete form'));
      deleteDialogId = null;
    } finally {
      deleting = false;
    }
  }

  // ── Row operations ───────────────────────────────────────────────────────────

  function addRow(cols_max: 2 | 3 = 3) {
    const id = crypto.randomUUID();
    formRows = [...formRows, { id, cols_max, cols: [] }];
    addingToRowId = id;
    selectedRowId = null;
    selectedColIdx = null;
  }

  function setRowColsMax(rowId: string, cols_max: 2 | 3) {
    formRows = formRows.map(r => {
      if (r.id !== rowId) return r;
      // Clamp existing field spans to new cols_max
      const cols = r.cols.map(f => ({
        ...f,
        col_span: Math.min(f.col_span, cols_max) as 1 | 2 | 3,
      }));
      return { ...r, cols_max, cols };
    });
  }

  function removeRow(rowId: string) {
    formRows = formRows.filter(r => r.id !== rowId);
    if (selectedRowId === rowId) {
      selectedRowId = null;
      selectedColIdx = null;
    }
    if (addingToRowId === rowId) addingToRowId = null;
  }

  function moveRow(rowId: string, dir: -1 | 1) {
    const idx = formRows.findIndex(r => r.id === rowId);
    if (idx === -1) return;
    const next = idx + dir;
    if (next < 0 || next >= formRows.length) return;
    const arr = [...formRows];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    formRows = arr;
  }

  // ── Field operations ──────────────────────────────────────────────────────────

  function rowSpanUsed(row: AgentFormRow) {
    return row.cols.reduce((s, f) => s + f.col_span, 0);
  }

  function addFieldToRow(rowId: string, type: AgentFieldType) {
    const meta = FIELD_META[type];
    const row = formRows.find(r => r.id === rowId);
    if (!row) return;
    const maxCols = row.cols_max;
    const remaining = maxCols - rowSpanUsed(row);
    if (remaining <= 0) return;
    const colSpan = Math.min(meta.defaultColSpan, remaining, maxCols) as 1 | 2 | 3;
    const newColIdx = row.cols.length;
    const label = meta.hasLabel ? meta.label : '';
    const newField: AgentFormField = {
      id: crypto.randomUUID(),
      type,
      col_span: colSpan,
      label,
      required: false,
      ...(meta.hasLabel && type !== 'title' ? { hydrationKey: slugify(label) } : {}),
      ...(type === 'attachment' ? { allowUpload: true, allowScreenshot: true } : {}),
    };
    formRows = formRows.map(r =>
      r.id !== rowId ? r : { ...r, cols: [...r.cols, newField] }
    );
    selectedRowId = rowId;
    selectedColIdx = newColIdx;
    addingToRowId = null;
  }

  function removeField(rowId: string, colIdx: number) {
    const row = formRows.find(r => r.id === rowId);
    if (!row) return;
    const newCols = row.cols.filter((_, i) => i !== colIdx);
    if (newCols.length === 0) {
      formRows = formRows.filter(r => r.id !== rowId);
    } else {
      formRows = formRows.map(r => r.id !== rowId ? r : { ...r, cols: newCols });
    }
    if (selectedRowId === rowId) {
      selectedRowId = null;
      selectedColIdx = null;
    }
  }

  function moveField(rowId: string, colIdx: number, dir: -1 | 1) {
    const row = formRows.find(r => r.id === rowId);
    if (!row) return;
    const next = colIdx + dir;
    if (next < 0 || next >= row.cols.length) return;
    const cols = [...row.cols];
    [cols[colIdx], cols[next]] = [cols[next], cols[colIdx]];
    formRows = formRows.map(r => r.id !== rowId ? r : { ...r, cols });
    if (selectedRowId === rowId) selectedColIdx = next;
  }

  function updateField(rowId: string, colIdx: number, patch: Partial<AgentFormField>) {
    formRows = formRows.map(row =>
      row.id !== rowId ? row : {
        ...row,
        cols: row.cols.map((f, i) => i !== colIdx ? f : { ...f, ...patch }),
      }
    );
  }

  function updateSelected(patch: Partial<AgentFormField>) {
    if (selectedRowId !== null && selectedColIdx !== null) {
      updateField(selectedRowId, selectedColIdx, patch);
    }
  }

  function selectCell(rowId: string, colIdx: number) {
    addingToRowId = null;
    selectedRowId = rowId;
    selectedColIdx = colIdx;
  }

  function deselect() {
    selectedRowId = null;
    selectedColIdx = null;
    addingToRowId = null;
  }

  // ── Select options ────────────────────────────────────────────────────────────

  function addOption() {
    if (!selectedField || selectedField.type !== 'select') return;
    const opts = [...(selectedField.selectOptions ?? []), { label: '', value: '' }];
    updateSelected({ selectOptions: opts });
  }

  function updateOption(idx: number, patch: { label?: string; value?: string }) {
    if (!selectedField || selectedField.type !== 'select') return;
    const opts = (selectedField.selectOptions ?? []).map((o, i) =>
      i !== idx ? o : { ...o, ...patch }
    );
    updateSelected({ selectOptions: opts });
  }

  function removeOption(idx: number) {
    if (!selectedField || selectedField.type !== 'select') return;
    updateSelected({ selectOptions: (selectedField.selectOptions ?? []).filter((_, i) => i !== idx) });
  }
</script>

<!-- ─── Delete confirm ──────────────────────────────────────────────────────── -->
<AlertDialog.Root open={!!deleteDialogId} onOpenChange={(o) => { if (!o) deleteDialogId = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this form?</AlertDialog.Title>
      <AlertDialog.Description>
        Configs that include this form will no longer show it to agents. Existing ticket submissions are not affected.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={handleDelete}
        disabled={deleting}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- ─── Editor ────────────────────────────────────────────────────────────── -->
<div class="flex flex-col size-full overflow-hidden">

    <!-- Editor header -->
    <div class="flex items-center gap-3 px-4 py-2.5 border-b bg-background shrink-0">
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5 text-muted-foreground hover:text-foreground -ml-1 shrink-0"
        onclick={() => goto(BACK)}
      >
        <ArrowLeft class="size-3.5" />
        Forms
      </Button>
      <div class="w-px h-4 bg-border shrink-0"></div>
      <input
        type="text"
        bind:value={formName}
        placeholder="Form name"
        class="flex-1 text-sm font-medium bg-transparent border-none outline-none placeholder:text-muted-foreground min-w-0"
      />
      <div class="flex items-center gap-2 shrink-0">
        {#if editingFormId && canDelete}
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive hover:text-destructive hover:bg-destructive/10"
            onclick={() => (deleteDialogId = editingFormId)}
          >
            <Trash2 class="size-3.5 mr-1.5" />
            Delete
          </Button>
        {/if}
        <Button variant="outline" size="sm" onclick={() => goto(BACK)}>Cancel</Button>
        <Button size="sm" onclick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Form'}
        </Button>
      </div>
    </div>

    <!-- Editor body: canvas + panel -->
    <div class="flex flex-1 overflow-hidden">

      <!-- ── Canvas ─────────────────────────────────────────────────────────── -->
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="flex-1 overflow-y-auto p-4 bg-muted/20"
        onclick={(e) => {
          if (e.target === e.currentTarget) deselect();
        }}
      >
        <!-- Form description (compact, inline) -->
        <div class="mb-4">
          <input
            type="text"
            bind:value={formDescription}
            placeholder="Optional description shown at the top of the form…"
            class="w-full text-xs text-muted-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <!-- Rows -->
        <div class="flex flex-col gap-2">
          {#each formRows as row, rowIdx (row.id)}
            {@const usedSpan = rowSpanUsed(row)}
            {@const remainingSpan = row.cols_max - usedSpan}

            <div class="group/row rounded-lg border bg-background shadow-sm">
              <!-- Row header -->
              <div class="flex items-center gap-1 px-2 pt-2 pb-1">
                <GripVertical class="size-3.5 text-muted-foreground/40 shrink-0" />
                <span class="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">Row {rowIdx + 1}</span>
                <!-- 2-col / 3-col toggle -->
                <div class="flex items-center rounded border overflow-hidden mx-1.5 shrink-0">
                  <button
                    type="button"
                    onclick={() => setRowColsMax(row.id, 2)}
                    class="flex items-center justify-center h-4 px-1.5 text-[10px] font-medium transition-colors
                      {row.cols_max === 2 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                    title="2-column layout"
                  >2</button>
                  <button
                    type="button"
                    onclick={() => setRowColsMax(row.id, 3)}
                    class="flex items-center justify-center h-4 px-1.5 text-[10px] font-medium transition-colors border-l
                      {row.cols_max === 3 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                    title="3-column layout"
                  >3</button>
                </div>
                <div class="flex-1"></div>
                <div class="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onclick={() => moveRow(row.id, -1)}
                    disabled={rowIdx === 0}
                    class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move row up"
                  >
                    <ChevronUp class="size-3" />
                  </button>
                  <button
                    type="button"
                    onclick={() => moveRow(row.id, 1)}
                    disabled={rowIdx === formRows.length - 1}
                    class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move row down"
                  >
                    <ChevronDown class="size-3" />
                  </button>
                  <button
                    type="button"
                    onclick={() => removeRow(row.id)}
                    class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                    title="Remove row"
                  >
                    <X class="size-3" />
                  </button>
                </div>
              </div>

              <!-- Field grid -->
              <div class="grid gap-2 px-2 pb-2" style="grid-template-columns: repeat({row.cols_max}, 1fr)">
                {#each row.cols as field, colIdx (field.id)}
                  {@const isSelected = selectedRowId === row.id && selectedColIdx === colIdx}
                  {@const meta = FIELD_META[field.type]}

                  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                  <div
                    style="grid-column: span {field.col_span}"
                    class="group/cell relative rounded-md border cursor-pointer transition-all
                      {isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : field.type === 'spacer'
                          ? 'border-dashed border-border/60 bg-transparent hover:border-border'
                          : 'border-border bg-muted/30 hover:bg-muted/50 hover:border-border/80'}"
                    onclick={() => selectCell(row.id, colIdx)}
                  >
                    <div class="flex items-center gap-2 p-2.5 min-h-[56px]">
                      {#if field.type === 'spacer'}
                        <div class="flex items-center gap-1.5 text-muted-foreground/40 w-full justify-center">
                          <Minus class="size-3.5" />
                          <span class="text-xs">Blank space</span>
                        </div>
                      {:else}
                        <div class="flex items-center justify-center h-7 w-7 rounded bg-muted shrink-0">
                          <svelte:component this={meta.icon} class="size-3.5 text-muted-foreground" />
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-xs font-medium truncate {field.label ? 'text-foreground' : 'text-muted-foreground italic'}">
                            {field.label || meta.label}
                          </p>
                          <p class="text-[10px] text-muted-foreground">{meta.label}</p>
                        </div>
                        {#if field.required}
                          <span class="text-[10px] text-destructive shrink-0 font-medium" title="Required">*</span>
                        {/if}
                      {/if}
                    </div>

                    <!-- Field controls on hover/select -->
                    {#if isSelected || true}
                      <div class="absolute -top-2 right-1 flex items-center gap-0.5 opacity-0 group-hover/cell:opacity-100 {isSelected ? 'opacity-100' : ''} transition-opacity">
                        {#if colIdx > 0}
                          <button
                            type="button"
                            onclick={(e) => { e.stopPropagation(); moveField(row.id, colIdx, -1); }}
                            class="flex h-4 w-4 items-center justify-center rounded-sm bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground"
                            title="Move left"
                          >
                            <ChevronLeft class="size-2.5" />
                          </button>
                        {/if}
                        {#if colIdx < row.cols.length - 1}
                          <button
                            type="button"
                            onclick={(e) => { e.stopPropagation(); moveField(row.id, colIdx, 1); }}
                            class="flex h-4 w-4 items-center justify-center rounded-sm bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground"
                            title="Move right"
                          >
                            <ChevronRight class="size-2.5" />
                          </button>
                        {/if}
                        <button
                          type="button"
                          onclick={(e) => { e.stopPropagation(); removeField(row.id, colIdx); }}
                          class="flex h-4 w-4 items-center justify-center rounded-sm bg-background border border-border shadow-sm text-muted-foreground hover:text-destructive"
                          title="Remove field"
                        >
                          <X class="size-2.5" />
                        </button>
                      </div>
                    {/if}
                  </div>
                {/each}

                <!-- Add field area / type picker -->
                {#if remainingSpan > 0}
                  {#if addingToRowId === row.id}
                    <!-- Type picker -->
                    <div
                      style="grid-column: span {remainingSpan}"
                      class="rounded-md border-2 border-primary/40 bg-primary/5 p-2"
                    >
                      <div class="grid grid-cols-4 gap-1 mb-2">
                        {#each FIELD_TYPES_ORDERED as type}
                          {@const meta = FIELD_META[type]}
                          {@const fits = meta.defaultColSpan <= remainingSpan || 1 <= remainingSpan}
                          <button
                            type="button"
                            onclick={() => addFieldToRow(row.id, type)}
                            disabled={!fits}
                            class="flex flex-col items-center gap-0.5 p-1.5 rounded text-center hover:bg-background transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title={meta.label}
                          >
                            <svelte:component this={meta.icon} class="size-3.5 text-muted-foreground" />
                            <span class="text-[9px] text-muted-foreground leading-none">{meta.shortLabel}</span>
                          </button>
                        {/each}
                      </div>
                      <button
                        type="button"
                        onclick={() => (addingToRowId = null)}
                        class="w-full text-[10px] text-muted-foreground hover:text-foreground text-center py-0.5"
                      >
                        Cancel
                      </button>
                    </div>
                  {:else}
                    <button
                      type="button"
                      style="grid-column: span {remainingSpan}"
                      onclick={(e) => { e.stopPropagation(); selectedRowId = null; selectedColIdx = null; addingToRowId = row.id; }}
                      class="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 text-muted-foreground/50 hover:border-primary/50 hover:text-primary/60 hover:bg-primary/5 transition-all min-h-[56px] text-xs"
                    >
                      <Plus class="size-3.5" />
                      Add field
                    </button>
                  {/if}
                {/if}
              </div>
            </div>
          {/each}

          <!-- Add row -->
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => addRow(3)}
              class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-3 text-sm text-muted-foreground/60 hover:border-border hover:text-muted-foreground hover:bg-background transition-all"
            >
              <Plus class="size-4" />
              Add row (3-col)
            </button>
            <button
              type="button"
              onclick={() => addRow(2)}
              class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-3 text-sm text-muted-foreground/60 hover:border-border hover:text-muted-foreground hover:bg-background transition-all"
            >
              <Plus class="size-4" />
              Add row (2-col)
            </button>
          </div>
        </div>
      </div>

      <!-- ── Right panel ─────────────────────────────────────────────────────── -->
      <div class="w-96 border-l bg-background flex flex-col overflow-hidden shrink-0">
        {#if selectedField}
          <!-- Field editor -->
          <div class="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
            <svelte:component this={FIELD_META[selectedField.type].icon} class="size-3.5 text-muted-foreground" />
            <span class="text-xs font-medium flex-1">Edit Field</span>
            <button type="button" onclick={deselect} class="text-muted-foreground hover:text-foreground">
              <X class="size-3.5" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto">
            <!-- Type picker -->
            <div class="p-3 border-b">
              <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Field type</p>
              <div class="grid grid-cols-4 gap-1">
                {#each FIELD_TYPES_ORDERED as type}
                  {@const meta = FIELD_META[type]}
                  <button
                    type="button"
                    onclick={() => updateSelected({ type, label: selectedField.type === type ? selectedField.label : meta.hasLabel ? meta.label : '' })}
                    class="flex flex-col items-center gap-0.5 p-1.5 rounded text-center transition-colors
                      {selectedField.type === type
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted text-muted-foreground'}"
                    title={meta.label}
                  >
                    <svelte:component this={meta.icon} class="size-3.5" />
                    <span class="text-[9px] leading-none">{meta.shortLabel}</span>
                  </button>
                {/each}
              </div>
            </div>

            <!-- Core properties -->
            <div class="flex flex-col gap-3 p-3 border-b">
              {#if FIELD_META[selectedField.type].hasLabel}
                <div class="flex flex-col gap-1.5">
                  <Label class="text-xs">Label</Label>
                  <Input
                    value={selectedField.label}
                    oninput={(e) => updateSelected({ label: (e.currentTarget as HTMLInputElement).value })}
                    placeholder={FIELD_META[selectedField.type].label}
                    class="h-8 text-xs"
                  />
                </div>
              {/if}

              {#if selectedField.type === 'title'}
                <div class="flex flex-col gap-1.5">
                  <Label class="text-xs">Subtitle <span class="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    value={selectedField.subtitle ?? ''}
                    oninput={(e) => updateSelected({ subtitle: (e.currentTarget as HTMLInputElement).value || undefined })}
                    placeholder="Supporting text below the section title"
                    class="h-8 text-xs"
                  />
                </div>
              {/if}

              <!-- Column width -->
              {#if selectedRowId !== null}
                {@const spanRow = formRows.find(r => r.id === selectedRowId)}
                {#if spanRow}
                  {@const maxCols = spanRow.cols_max}
                  <div class="flex flex-col gap-1.5">
                    <Label class="text-xs">Width</Label>
                    <div class="flex rounded-md border overflow-hidden">
                      {#each Array.from({ length: maxCols }, (_, i) => i + 1) as span}
                        <button
                          type="button"
                          onclick={() => {
                            if (selectedColIdx === null) return;
                            const otherSpan = spanRow.cols.reduce((s, f, i) => i !== selectedColIdx ? s + f.col_span : s, 0);
                            if (otherSpan + span > maxCols) return;
                            updateSelected({ col_span: span as 1 | 2 | 3 });
                          }}
                          class="flex-1 py-1.5 text-xs font-medium transition-colors
                            {selectedField.col_span === span
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-muted'}"
                        >
                          {span}/{maxCols}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              {/if}

              {#if FIELD_META[selectedField.type].hasRequired}
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium">Required</span>
                  <Switch
                    checked={selectedField.required ?? false}
                    onCheckedChange={(v) => updateSelected({ required: v })}
                  />
                </div>
              {/if}

              {#if FIELD_META[selectedField.type].hasPlaceholder}
                <div class="flex flex-col gap-1.5">
                  <Label class="text-xs">Placeholder <span class="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    value={selectedField.placeholder ?? ''}
                    oninput={(e) => updateSelected({ placeholder: (e.currentTarget as HTMLInputElement).value || undefined })}
                    placeholder="Hint shown inside the field"
                    class="h-8 text-xs"
                  />
                </div>
              {/if}

              {#if selectedField.type !== 'spacer'}
                <div class="flex flex-col gap-1.5">
                  <Label class="text-xs">Help text <span class="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    value={selectedField.helpText ?? ''}
                    oninput={(e) => updateSelected({ helpText: (e.currentTarget as HTMLInputElement).value || undefined })}
                    placeholder="Shown below the field"
                    class="h-8 text-xs"
                  />
                </div>
              {/if}
            </div>

            <!-- Type-specific: Select -->
            {#if selectedField.type === 'select'}
              <div class="flex flex-col gap-3 p-3 border-b">
                <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Options source</p>
                <div class="flex flex-col gap-2">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="optionSource"
                      checked={!selectedField.psaSource}
                      onchange={() => updateSelected({ psaSource: undefined })}
                      class="accent-primary"
                    />
                    <span class="text-xs">Manual options</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="optionSource"
                      checked={!!selectedField.psaSource}
                      onchange={() => updateSelected({ psaSource: 'urgency' })}
                      class="accent-primary"
                    />
                    <span class="text-xs">From PSA</span>
                  </label>
                </div>

                {#if selectedField.psaSource}
                  <div class="flex flex-col gap-1.5">
                    <Label class="text-xs">PSA field</Label>
                    <select
                      value={selectedField.psaSource}
                      onchange={(e) => updateSelected({ psaSource: (e.currentTarget as HTMLSelectElement).value })}
                      class="text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {#each AGENT_PSA_SOURCES as src}
                        <option value={src.value}>{src.label}</option>
                      {/each}
                    </select>
                    <p class="text-[10px] text-muted-foreground">Options are loaded from the configured PSA at runtime.</p>
                  </div>
                {:else}
                  <!-- Manual options -->
                  <div class="flex flex-col gap-1.5">
                    {#each selectedField.selectOptions ?? [] as opt, i}
                      <div class="flex items-center gap-1">
                        <Input
                          value={opt.label}
                          oninput={(e) => updateOption(i, { label: (e.currentTarget as HTMLInputElement).value })}
                          placeholder="Label"
                          class="h-7 text-xs flex-1"
                        />
                        <Input
                          value={opt.value}
                          oninput={(e) => updateOption(i, { value: (e.currentTarget as HTMLInputElement).value })}
                          placeholder="Value"
                          class="h-7 text-xs flex-1"
                        />
                        <button
                          type="button"
                          onclick={() => removeOption(i)}
                          class="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <X class="size-3" />
                        </button>
                      </div>
                    {/each}
                    <Button type="button" variant="outline" size="sm" class="gap-1.5 h-7 text-xs" onclick={addOption}>
                      <Plus class="size-3" />
                      Add option
                    </Button>
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Type-specific: Attachment -->
            {#if selectedField.type === 'attachment'}
              <div class="flex flex-col gap-3 p-3 border-b">
                <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Capture methods</p>
                <label class="flex items-center justify-between cursor-pointer">
                  <span class="text-xs">Allow file upload</span>
                  <Switch
                    checked={selectedField.allowUpload ?? true}
                    onCheckedChange={(v) => updateSelected({ allowUpload: v })}
                  />
                </label>
                <label class="flex items-center justify-between cursor-pointer">
                  <span class="text-xs">Allow screenshot</span>
                  <Switch
                    checked={selectedField.allowScreenshot ?? true}
                    onCheckedChange={(v) => updateSelected({ allowScreenshot: v })}
                  />
                </label>
                <div class="flex items-center justify-between">
                  <Label class="text-xs">Max size (MB)</Label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={selectedField.maxSizeMb ?? 10}
                    onchange={(e) => updateSelected({ maxSizeMb: Number((e.currentTarget as HTMLInputElement).value) || 10 })}
                    class="w-16 text-xs px-2 py-1 rounded border bg-background focus:outline-none"
                  />
                </div>
              </div>
            {/if}

            <!-- Hydration key (for all data-bearing fields) -->
            {#if selectedField.type !== 'spacer' && selectedField.type !== 'title' && selectedField.type !== 'attachment'}
              <div class="flex flex-col gap-1.5 p-3 border-b">
                <div>
                  <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Template variable</p>
                  <p class="text-[10px] text-muted-foreground mt-0.5">Use <code class="bg-muted px-0.5 rounded">{'{{' + (selectedField.hydrationKey || '…') + '}}'}</code> in the ticket title &amp; body</p>
                </div>
                <Input
                  value={selectedField.hydrationKey ?? ''}
                  oninput={(e) => updateSelected({ hydrationKey: (e.currentTarget as HTMLInputElement).value })}
                  placeholder="e.g. description"
                  class="h-7 text-xs font-mono"
                />
              </div>

              <!-- PSA metric this field drives -->
              <div class="flex flex-col gap-2 p-3 border-b">
                <div>
                  <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">PSA metric</p>
                  <p class="text-[10px] text-muted-foreground mt-0.5">Optionally map this value to a PSA ticket field</p>
                </div>
                <select
                  value={selectedField.psaMetric ?? ''}
                  onchange={(e) => updateSelected({ psaMetric: (e.currentTarget as HTMLSelectElement).value || undefined })}
                  class="text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">— none —</option>
                  {#each AGENT_PSA_METRICS as m}
                    <option value={m.value}>{m.label}</option>
                  {/each}
                </select>

                <!-- Per-option PSA value mappings (only for manual-option select fields) -->
                {#if selectedField.type === 'select' && selectedField.psaMetric && !selectedField.psaSource && (selectedField.selectOptions?.length ?? 0) > 0}
                  <div class="flex flex-col gap-1.5 mt-1">
                    <p class="text-[10px] text-muted-foreground">Map each option to the value your PSA expects:</p>
                    {#each selectedField.selectOptions ?? [] as opt}
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs text-muted-foreground flex-1 truncate">{opt.label || opt.value || '(empty)'}</span>
                        <Input
                          value={selectedField.optionMappings?.[opt.value] ?? ''}
                          oninput={(e) => {
                            const val = (e.currentTarget as HTMLInputElement).value;
                            const next = { ...(selectedField!.optionMappings ?? {}) };
                            if (val) next[opt.value] = val; else delete next[opt.value];
                            updateSelected({ optionMappings: next });
                          }}
                          placeholder="PSA value"
                          class="h-6 text-xs w-24 font-mono shrink-0"
                        />
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

        {:else}
          <!-- Right panel tab bar -->
          <div class="flex border-b shrink-0">
            <button
              type="button"
              onclick={() => (rightPanelTab = 'preview')}
              class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors
                {rightPanelTab === 'preview' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
            >
              <Eye class="size-3.5" />
              Preview
            </button>
            <button
              type="button"
              onclick={() => (rightPanelTab = 'template')}
              class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors
                {rightPanelTab === 'template' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
            >
              <FileText class="size-3.5" />
              Ticket Template
            </button>
          </div>

          {#if rightPanelTab === 'preview'}
            <div class="flex-1 overflow-y-auto p-3 bg-muted/20">
              <AgentFormPreview
                rows={formRows}
                formName={formName}
                formDescription={formDescription}
              />
            </div>
          {:else}
            <!-- Ticket template editor -->
            <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <Label class="text-xs font-medium">Ticket Title</Label>
                <input
                  bind:this={titleInputEl}
                  bind:value={ticketTitle}
                  onfocus={() => (templateFocus = 'title')}
                  placeholder={'e.g. Issue: {{summary}}'}
                  class="h-9 text-xs font-mono px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-full"
                />
              </div>
              <div class="flex flex-col gap-1.5">
                <Label class="text-xs font-medium">Ticket Body</Label>
                <textarea
                  bind:this={bodyTextareaEl}
                  bind:value={ticketBody}
                  onfocus={() => (templateFocus = 'body')}
                  placeholder={"**Details:** {{description}}\n**Urgency:** {{urgency}}\n**Affected:** {{affected}}"}
                  rows={7}
                  class="text-xs font-mono px-3 py-2 rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-y w-full"
                ></textarea>
                <p class="text-[10px] text-muted-foreground">Markdown supported. Images are appended automatically.</p>
              </div>

              <!-- Insert helper -->
              <div class="flex flex-col gap-2 rounded-md border p-3 bg-muted/30">
                <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Variable class="size-3" />
                  {templateFocus ? 'Click to insert at cursor' : 'Click a field above, then insert'}
                </p>
                <div class="flex flex-wrap gap-1.5">
                  {#each AGENT_SYSTEM_VARS as sv}
                    <button
                      type="button"
                      onclick={() => insertVar(sv.key)}
                      title={sv.label}
                      class="inline-flex items-center gap-1 text-[10px] font-mono bg-muted hover:bg-muted/80 border border-border rounded px-1.5 py-0.5 transition-colors"
                    >
                      {'{{' + sv.key + '}}'}
                    </button>
                  {/each}
                  {#each hydrationVars as hv}
                    <button
                      type="button"
                      onclick={() => insertVar(hv.key)}
                      title={hv.label}
                      class="inline-flex items-center gap-1 text-[10px] font-mono bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded px-1.5 py-0.5 transition-colors"
                    >
                      {'{{' + hv.key + '}}'}
                    </button>
                  {/each}
                  {#if hydrationVars.length === 0}
                    <p class="text-[10px] text-muted-foreground/60 italic">Fields with template keys appear here.</p>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </div>

    </div>
  </div>
