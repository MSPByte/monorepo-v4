<script lang="ts">
  import '../workspace.css';
  import { getContext, onMount } from 'svelte';
  import type { Component } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { beforeNavigate, goto, replaceState } from '$app/navigation';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import type { AgentFieldType, AgentFormField, AgentFormRow, AgentFormInputSource, AgentFormPackageBindings, PackageRuntimeInput, ResolvedInputMeta } from '@mspbyte/shared';
  import { AGENT_PSA_METRICS, AGENT_SYSTEM_VARS, AGENT_FORM_SYSTEM_SOURCES, collectPackageRuntimeInputs, formFieldTypesForInput, formWantsEntraIdentity, isOpenPsaMetric } from '@mspbyte/shared';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import AgentFormPreview from '$lib/components/agent-form-preview.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
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
    CalendarDays,
    CheckSquare,
    ListFilter,
    Paperclip,
    Eye,
    FileText,
    X,
    GripVertical,
    LayoutGrid,
    Variable,
    Zap,
    TicketCheck,
    ShieldCheck,
    ArrowRight,
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
    date:       { label: 'Date',         shortLabel: 'Date',   icon: CalendarDays,defaultColSpan: 1, hasLabel: true,  hasRequired: true,  hasPlaceholder: false },
    checkbox:   { label: 'Checkbox',     shortLabel: 'Check',  icon: CheckSquare, defaultColSpan: 3, hasLabel: true,  hasRequired: false, hasPlaceholder: false },
    select:     { label: 'Dropdown',     shortLabel: 'Select', icon: ListFilter,  defaultColSpan: 2, hasLabel: true,  hasRequired: true,  hasPlaceholder: true  },
    attachment: { label: 'Attachment',   shortLabel: 'File',   icon: Paperclip,   defaultColSpan: 3, hasLabel: true,  hasRequired: false, hasPlaceholder: false },
  };

  const FIELD_TYPES_ORDERED: AgentFieldType[] = [
    'text', 'textarea', 'email', 'phone', 'number', 'date',
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
  const canReadPackages = $derived(authStore.isAllowed('Packages.Read'));

  // ── Editor state ─────────────────────────────────────────────────────────────

  let editingFormId = $state<string | null>(null);
  let formName = $state('');
  let formDescription = $state('');
  let ticketTitle = $state('');
  let ticketBody = $state('');
  let formRows = $state<AgentFormRow[]>([]);
  let packageId = $state<string | null>(null);
  let packageBindings = $state<AgentFormPackageBindings>({});
  let saving = $state(false);
  let loading = $state(true);
  let savedSnapshot = $state('');
  const snapshot = $derived(JSON.stringify({ formName, formDescription, ticketTitle, ticketBody, formRows, packageId, packageBindings }));
  const hasChanges = $derived(!loading && savedSnapshot !== snapshot);
  const fieldCount = $derived(formRows.flatMap(row => row.cols).filter(field => !['title', 'spacer'].includes(field.type)).length);

  beforeNavigate(({ cancel }) => {
    if (hasChanges && !window.confirm('Leave this form? Your unsaved changes will be lost.')) cancel();
  });

  function addPaletteField(type: AgentFieldType) {
    const target = formRows.find(row => row.id === addingToRowId && rowSpanUsed(row) < row.cols_max);
    if (target) addFieldToRow(target.id, type);
    else {
      const id = crypto.randomUUID();
      formRows = [...formRows, { id, cols_max: 3, cols: [] }];
      addFieldToRow(id, type);
    }
  }

  function startSupportForm() {
    formName = 'Support request';
    formDescription = 'Tell us what’s happening and our IT team will help.';
    const fields: { type: AgentFieldType; label: string; key: string; required: boolean }[] = [
      { type: 'text', label: 'What do you need help with?', key: 'summary', required: true },
      { type: 'textarea', label: 'Tell us more', key: 'details', required: true },
      { type: 'email', label: 'Your email', key: 'email', required: true },
      { type: 'attachment', label: 'Add a screenshot or file', key: 'attachment', required: false },
    ];
    formRows = fields.map(field => ({ id: crypto.randomUUID(), cols_max: 3, cols: [{ id: crypto.randomUUID(), type: field.type, label: field.label, hydrationKey: field.key, required: field.required, col_span: 3, ...(field.type === 'attachment' ? { allowUpload: true, allowScreenshot: true } : {}) }] }));
    ticketTitle = '{{summary}}';
    ticketBody = '{{details}}';
  }

  // Selection
  let selectedRowId = $state<string | null>(null);
  let selectedColIdx = $state<number | null>(null);
  let addingToRowId = $state<string | null>(null);
  let rightPanelTab = $state<'preview' | 'template' | 'automation'>('preview');
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

  // Live PSA options for the currently-selected field's closed metric.
  const psaMetric = $derived(selectedField?.psaMetric ?? '');
  const psaMetricOptionsQuery = createQuery(() => ({
    queryKey: ['agents', 'psaMetricOptions', psaMetric],
    queryFn: () => trpc.agents.configs.psaMetricOptions.query({ metric: psaMetric }),
    enabled: !!psaMetric && !isOpenPsaMetric(psaMetric),
    staleTime: 5 * 60 * 1000,
  }));

  const packagesQuery = createQuery(() => ({
    queryKey: ['forms', 'automationPackages'],
    queryFn: () => trpc.packages.list.query({}),
    enabled: canReadPackages,
    staleTime: 60_000,
  }));
  const capabilitiesQuery = createQuery(() => ({
    queryKey: ['forms', 'automationCapabilities'],
    queryFn: () => trpc.packages.capabilities.query(),
    enabled: canReadPackages,
    staleTime: 60_000,
  }));
  const activePackages = $derived((packagesQuery.data ?? []).filter(p => p.status === 'active'));
  const selectedPackage = $derived((packagesQuery.data ?? []).find(p => p.id === packageId));
  const capabilityMeta = $derived(new Map((capabilitiesQuery.data ?? []).map(c => [c.id, c.inputMeta])));
  const packageInputs = $derived.by((): PackageRuntimeInput[] => {
    if (!selectedPackage) return [];
    return collectPackageRuntimeInputs({
      steps: selectedPackage.steps ?? [],
      prompts: selectedPackage.prompts ?? [],
      outcomeSteps: selectedPackage.outcomeSteps ?? { onSuccess: [], onFailure: [] },
    }, id => (capabilityMeta.get(id) as ResolvedInputMeta | null | undefined) ?? null).inputs;
  });
  const requiresEntra = $derived(formWantsEntraIdentity(packageBindings));
  const mappedInputCount = $derived(packageInputs.filter(input => {
    const source = packageBindings[input.promptKey];
    if (!source) return false;
    return source.kind !== 'literal' || typeof source.value !== 'string' || source.value.trim() !== '';
  }).length);
  const unmappedRequired = $derived(packageInputs.filter(input => {
    if (!input.required) return false;
    const source = packageBindings[input.promptKey];
    if (!source) return true;
    return source.kind === 'literal' && typeof source.value === 'string' && source.value.trim() === '';
  }));

  const dataFields = $derived(formRows.flatMap(row => row.cols).filter(field => !['spacer', 'title', 'attachment'].includes(field.type)));

  function sourceValue(input: PackageRuntimeInput): string {
    const source = packageBindings[input.promptKey];
    if (!source) return '';
    if (source.kind === 'formField') return `field:${source.fieldId}`;
    if (source.kind === 'system') return `system:${source.key}`;
    return 'literal';
  }

  function sourceOptions(input: PackageRuntimeInput) {
    const compatible = formFieldTypesForInput(input);
    return [
      ...dataFields
        .filter(field => compatible.includes(field.type))
        .map(field => ({ value: `field:${field.id}`, label: field.label || 'Untitled field', group: 'Form answers' })),
      ...AGENT_FORM_SYSTEM_SOURCES.map(source => ({
        value: `system:${source.key}`,
        label: source.label,
        subLabel: source.description,
        group: source.key.startsWith('entra_') ? 'Verified identity' : 'Submission context',
      })),
      { value: 'literal', label: 'Fixed value', subLabel: 'Set by the MSP and hidden from the end user', group: 'Configuration' },
    ];
  }

  function setInputSource(input: PackageRuntimeInput, value: string) {
    const next = { ...packageBindings };
    if (!value) delete next[input.promptKey];
    else if (value.startsWith('field:')) next[input.promptKey] = { kind: 'formField', fieldId: value.slice(6) };
    else if (value.startsWith('system:')) next[input.promptKey] = { kind: 'system', key: value.slice(7) as Extract<AgentFormInputSource, { kind: 'system' }>['key'] };
    else next[input.promptKey] = { kind: 'literal', value: '' };
    packageBindings = next;
  }

  function setLiteral(input: PackageRuntimeInput, value: string) {
    packageBindings = { ...packageBindings, [input.promptKey]: { kind: 'literal', value } };
  }

  function selectPackage(value: string) {
    packageId = value || null;
    packageBindings = {};
  }

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
        packageId = row.packageId ?? null;
        packageBindings = (row.packageBindings ?? {}) as AgentFormPackageBindings;
        formRows = normalizeRows(row.rows);
      } catch (err) {
        toast.error(toUserMessage(err, 'Failed to load form'));
        goto(BACK);
      }
    } else {
      editingFormId = null;
      formName = '';
      formDescription = '';
      ticketTitle = '';
      ticketBody = '';
      packageId = null;
      packageBindings = {};
      formRows = [];
    }
    savedSnapshot = JSON.stringify({ formName, formDescription, ticketTitle, ticketBody, formRows, packageId, packageBindings });
    loading = false;
  });

  async function handleSave() {
    if (!canWrite || loading || saving) return;
    if (!formName.trim()) {
      toast.error('Form name is required');
      return;
    }
    if (packageId && unmappedRequired.length > 0) {
      deselect();
      rightPanelTab = 'automation';
      toast.error(`Map ${unmappedRequired.length} required automation input${unmappedRequired.length === 1 ? '' : 's'} before saving`);
      return;
    }
    saving = true;
    const savingSnapshot = snapshot;
    try {
      const payload = {
        name: formName,
        description: formDescription || undefined,
        rows: formRows,
        ticketTitle: ticketTitle || undefined,
        ticketBody: ticketBody || undefined,
        packageId,
        packageBindings,
      };
      if (editingFormId) {
        await updateMut.mutateAsync({ id: editingFormId, ...payload });
        toast.success('Form saved');
      } else {
        const result = await createMut.mutateAsync(payload);
        editingFormId = result?.id ?? null;
        if (editingFormId) {
          const url = new URL(get(page).url);
          url.searchParams.set('id', editingFormId);
          replaceState(url, get(page).state);
        }
        toast.success('Form created');
      }
      savedSnapshot = savingSnapshot;
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
      savedSnapshot = snapshot;
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
    // Value is a stable UUID fragment — never shown to the user, never changes after creation.
    const opts = [...(selectedField.selectOptions ?? []), { label: '', value: crypto.randomUUID().slice(0, 8) }];
    updateSelected({ selectOptions: opts });
  }

  function updateOption(idx: number, label: string) {
    if (!selectedField || selectedField.type !== 'select') return;
    const opts = (selectedField.selectOptions ?? []).map((o, i) =>
      i !== idx ? o : { ...o, label }
    );
    updateSelected({ selectOptions: opts });
  }

  function removeOption(idx: number) {
    if (!selectedField || selectedField.type !== 'select') return;
    // Also clean up any PSA mapping for the removed option's value.
    const removed = selectedField.selectOptions?.[idx];
    const next: AgentFormField = { ...selectedField, selectOptions: (selectedField.selectOptions ?? []).filter((_, i) => i !== idx) };
    if (removed && next.optionMappings) {
      const mappings = { ...next.optionMappings };
      delete mappings[removed.value];
      next.optionMappings = mappings;
    }
    updateSelected(next);
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

<svelte:window onbeforeunload={(event) => { if (hasChanges) { event.preventDefault(); event.returnValue = ''; } }} />

<!-- ─── Editor ────────────────────────────────────────────────────────────── -->
<div class="forms-workspace fw-editor">
  <header class="fw-editor-header">
    <div class="flex items-center gap-3 min-w-0">
      <Button variant="outline" size="icon" class="size-9 shrink-0" onclick={() => goto(BACK)} aria-label="Back to forms"><ArrowLeft class="size-4" /></Button>
      <div class="min-w-0"><p class="fw-eyebrow">MSPAgent / Forms</p><h1 class="font-semibold truncate">{editingFormId ? formName || 'Untitled form' : 'Create a form'}</h1></div>
    </div>
    <div class="flex items-center gap-2">
      <span class="fw-save-state" aria-live="polite"><span class:changed={hasChanges}></span>{loading ? 'Loading…' : saving ? 'Saving…' : hasChanges ? 'Unsaved changes' : editingFormId ? 'All changes saved' : 'New form'}</span>
      {#if editingFormId && canDelete}<Button variant="ghost" size="icon" aria-label="Delete form" onclick={() => deleteDialogId = editingFormId}><Trash2 class="size-4" /></Button>{/if}
      <Button variant="outline" size="sm" class="gap-1.5" onclick={() => { deselect(); rightPanelTab = 'preview'; }}><Eye size={14} /> Preview</Button>
      {#if canWrite}<Button size="sm" onclick={handleSave} disabled={saving || loading || !formName.trim() || !hasChanges}>{saving ? 'Saving…' : editingFormId ? 'Save changes' : 'Create form'}</Button>{/if}
    </div>
  </header>
  <div class="fw-editor-context"><span><LayoutGrid class="size-4" /> Form builder</span><p>Design the request. Preview the experience. Connect the next step.</p><span class="fw-field-count">{fieldCount} {fieldCount === 1 ? 'field' : 'fields'}</span></div>
  {#if loading}
    <div class="fw-empty" role="status"><p>Loading your form…</p></div>
  {:else}
    <div class="fw-editor-body">
      <aside class="fw-palette" aria-label="Add fields">
        <p class="fw-eyebrow">Build your form</p><h2>Add fields</h2><p class="fw-palette-help">Everything you need, one field at a time.</p>
        <div class="fw-palette-fields">
          {#each FIELD_TYPES_ORDERED as type}
            {@const Icon = FIELD_META[type].icon}
            <button type="button" onclick={() => addPaletteField(type)}><Icon class="size-4" /><span>{FIELD_META[type].label}</span><Plus class="size-3 fw-palette-plus" /></button>
          {/each}
        </div>
        <div class="fw-palette-tip"><LayoutGrid class="size-4" /><p>Need fields side by side? Add a row, then choose fields for its columns.</p></div>
      </aside>

      <div class="fw-canvas">
        <div class="fw-canvas-top"><span class="fw-eyebrow">Form canvas</span><span>Click any field to edit</span></div>
        <div class="fw-form-details">
          <label for="form-name" class="fw-eyebrow">Form name <span class="text-primary">*</span></label>
          <input id="form-name" bind:value={formName} placeholder="Give your form a name" class="fw-name-input" />
          <label for="form-description" class="sr-only">Form description</label>
          <input id="form-description" bind:value={formDescription} placeholder="Add a short description for your users…" class="fw-description-input" />
        </div>
        {#if formRows.length === 0}
          <div class="fw-builder-empty"><span class="fw-empty-icon"><FileText class="size-7" /></span><h2>A little structure. A better request.</h2><p>Add your first field from the left, or start with the essentials for a support ticket.</p><Button variant="outline" onclick={startSupportForm} class="gap-2"><TicketCheck class="size-4" /> Use support request template</Button><span>Summary, details, email, and attachments</span></div>
        {/if}

        <!-- Rows -->
        <div class="flex flex-col gap-3">
          {#each formRows as row, rowIdx (row.id)}
            {@const usedSpan = rowSpanUsed(row)}
            {@const remainingSpan = row.cols_max - usedSpan}

            <div class="fw-canvas-row group/row rounded-lg border bg-background shadow-sm">
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
                <div class="flex items-center gap-0.5 opacity-60 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onclick={() => moveRow(row.id, -1)}
                    disabled={rowIdx === 0}
                    class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move row up"
                  >
                    <ChevronUp class="size-3" />
                  </button>
                  <button
                    type="button"
                    onclick={() => moveRow(row.id, 1)}
                    disabled={rowIdx === formRows.length - 1}
                    class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move row down"
                  >
                    <ChevronDown class="size-3" />
                  </button>
                  <button
                    type="button"
                    onclick={() => removeRow(row.id)}
                    class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
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


                  <div
                    role="button"
                    tabindex="0"
                    aria-label={"Edit " + (field.label || meta.label)}
                    onkeydown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectCell(row.id, colIdx); } }}
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
                          <meta.icon class="size-3.5 text-muted-foreground" />
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
                      <div class="absolute -top-2 right-1 flex items-center gap-0.5 opacity-60 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 {isSelected ? 'opacity-100' : ''} transition-opacity">
                        {#if colIdx > 0}
                          <button
                            type="button"
                            onclick={(e) => { e.stopPropagation(); moveField(row.id, colIdx, -1); }}
                            class="flex h-6 w-6 items-center justify-center rounded-sm bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground"
                            title="Move left"
                          >
                            <ChevronLeft class="size-2.5" />
                          </button>
                        {/if}
                        {#if colIdx < row.cols.length - 1}
                          <button
                            type="button"
                            onclick={(e) => { e.stopPropagation(); moveField(row.id, colIdx, 1); }}
                            class="flex h-6 w-6 items-center justify-center rounded-sm bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground"
                            title="Move right"
                          >
                            <ChevronRight class="size-2.5" />
                          </button>
                        {/if}
                        <button
                          type="button"
                          onclick={(e) => { e.stopPropagation(); removeField(row.id, colIdx); }}
                          class="flex h-6 w-6 items-center justify-center rounded-sm bg-background border border-border shadow-sm text-muted-foreground hover:text-destructive"
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
                            <meta.icon class="size-3.5 text-muted-foreground" />
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
              Add 3-column row
            </button>
            <button
              type="button"
              onclick={() => addRow(2)}
              class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-3 text-sm text-muted-foreground/60 hover:border-border hover:text-muted-foreground hover:bg-background transition-all"
            >
              <Plus class="size-4" />
              Add 2-column row
            </button>
          </div>
        </div>
      </div>

      <!-- ── Right panel ─────────────────────────────────────────────────────── -->
      <div class="fw-inspector border-l bg-background flex flex-col overflow-hidden shrink-0">
        {#if selectedField}
          {@const SelectedIcon = FIELD_META[selectedField.type].icon}
          <!-- Field editor -->
          <div class="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
            <SelectedIcon class="size-3.5 text-muted-foreground" />
            <span class="text-sm font-semibold flex-1">Field settings</span>
            <button type="button" onclick={deselect} aria-label="Close field settings" class="text-muted-foreground hover:text-foreground">
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
                    <meta.icon class="size-3.5" />
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
                <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Options</p>
                <div class="flex flex-col gap-1.5">
                  {#each selectedField.selectOptions ?? [] as opt, i}
                    <div class="flex items-center gap-1">
                      <Input
                        value={opt.label}
                        oninput={(e) => updateOption(i, (e.currentTarget as HTMLInputElement).value)}
                        placeholder="Label"
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
                  <p class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">PSA field</p>
                  <p class="text-[10px] text-muted-foreground mt-0.5">Optionally map this value to a PSA ticket field</p>
                </div>
                <SingleSelect
                  options={AGENT_PSA_METRICS.map(m => ({ value: m.value, label: m.label }))}
                  selected={selectedField.psaMetric}
                  placeholder="— none —"
                  onchange={(v) => updateSelected({ psaMetric: v || undefined, optionMappings: undefined })}
                  class="text-xs h-8"
                />

                <!-- Per-option PSA value mapping — only for closed select fields with options defined -->
                {#if selectedField.type === 'select' && selectedField.psaMetric && !isOpenPsaMetric(selectedField.psaMetric) && (selectedField.selectOptions?.length ?? 0) > 0}
                  <div class="flex flex-col gap-1.5 mt-1">
                    {#if psaMetricOptionsQuery.isLoading}
                      <p class="text-[10px] text-muted-foreground">Loading PSA options…</p>
                    {:else if psaMetricOptionsQuery.isError}
                      <p class="text-[10px] text-destructive">Failed to load PSA options — check that HaloPSA is connected.</p>
                    {:else if (psaMetricOptionsQuery.data?.length ?? 0) > 0}
                      <p class="text-[10px] text-muted-foreground">Map each option to its PSA value:</p>
                      {#each selectedField.selectOptions ?? [] as opt}
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs text-muted-foreground flex-1 truncate">{opt.label || '(empty)'}</span>
                          <SingleSelect
                            options={(psaMetricOptionsQuery.data ?? []).map(psaOpt => ({ value: String(psaOpt.id), label: psaOpt.name }))}
                            selected={selectedField.optionMappings?.[opt.value]}
                            placeholder="— unset —"
                            onchange={(v) => {
                              const next = { ...(selectedField!.optionMappings ?? {}) };
                              if (v) next[opt.value] = v; else delete next[opt.value];
                              updateSelected({ optionMappings: next });
                            }}
                            class="w-36 shrink-0 text-xs"
                          />
                        </div>
                      {/each}
                    {:else}
                      <p class="text-[10px] text-muted-foreground">
                        No PSA options found — ensure HaloPSA is connected and the integration is active.
                      </p>
                    {/if}
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
              aria-pressed={rightPanelTab === 'preview'} onclick={() => (rightPanelTab = 'preview')}
              class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors
                {rightPanelTab === 'preview' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
            >
              <Eye class="size-3.5" />
              Preview
            </button>
            <button
              type="button"
              aria-pressed={rightPanelTab === 'template'} onclick={() => (rightPanelTab = 'template')}
              class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors
                {rightPanelTab === 'template' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
            >
              <FileText class="size-3.5" />
              Ticket
            </button>
            <button
              type="button"
              aria-pressed={rightPanelTab === 'automation'} onclick={() => (rightPanelTab = 'automation')}
              class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors
                {rightPanelTab === 'automation' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
            >
              <Zap class="size-3.5" />
              Automation
              {#if packageId}
                <span class="size-1.5 rounded-full {unmappedRequired.length ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
              {/if}
            </button>
          </div>

          {#if rightPanelTab === 'preview'}
            <div class="flex-1 overflow-y-auto p-5 bg-muted/20">
              <div class="fw-preview-heading"><span class="fw-eyebrow">End-user preview</span><span class="fw-live-dot">Live</span></div>
              <AgentFormPreview
                rows={formRows}
                formName={formName}
                formDescription={formDescription}
              />
              <p class="text-xs text-muted-foreground leading-relaxed mt-4 text-center">Try your fields here. This preview doesn’t submit a ticket.</p>
            </div>
          {:else if rightPanelTab === 'template'}
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
          {:else}
            <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
              <div class="rounded-lg border bg-background p-3">
                <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">When this form is sent</p>
                <div class="mt-3 flex items-center gap-2 text-xs font-medium">
                  <span class="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
                    <FileText class="size-3.5" /> Form
                  </span>
                  <ArrowRight class="size-3 text-muted-foreground" />
                  <span class="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
                    <TicketCheck class="size-3.5" /> Ticket
                  </span>
                  <ArrowRight class="size-3 text-muted-foreground" />
                  <span class="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-primary">
                    <Zap class="size-3.5 shrink-0" />
                    <span class="truncate">{selectedPackage?.name ?? 'No package'}</span>
                  </span>
                </div>
                <p class="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  The ticket is always created first. If automation cannot run, the ticket remains open for manual handling.
                </p>
              </div>

              {#if !canReadPackages}
                <div class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
                  Packages.Read permission is required to connect automation.
                </div>
              {:else}
                <div class="flex flex-col gap-1.5">
                  <Label class="text-xs font-medium">Package to run</Label>
                  <SingleSelect
                    options={activePackages.map(pkg => ({ value: pkg.id, label: pkg.name, subLabel: pkg.description ?? undefined }))}
                    selected={packageId ?? undefined}
                    placeholder={packagesQuery.isLoading ? 'Loading packages…' : 'No automation'}
                    loading={packagesQuery.isLoading}
                    onchange={selectPackage}
                  />
                  {#if packageId && !selectedPackage && !packagesQuery.isLoading}
                    <p class="text-[10px] text-destructive">The linked package is unavailable or no longer exists. Select another package.</p>
                  {/if}
                </div>

                {#if selectedPackage}
                  {#if requiresEntra}
                    <div class="flex gap-2.5 rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
                      <ShieldCheck class="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                      <div>
                        <p class="text-xs font-medium">Microsoft identity required for automation</p>
                        <p class="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                          End users are prompted to sign in with Microsoft. They may still send the form without signing in; the ticket is created and automation is skipped.
                        </p>
                      </div>
                    </div>
                  {/if}

                  <div class="flex items-center justify-between pt-1">
                    <div>
                      <p class="text-xs font-medium">Package inputs</p>
                      <p class="text-[10px] text-muted-foreground">Choose where each value comes from.</p>
                    </div>
                    <span class="text-[10px] tabular-nums text-muted-foreground">
                      {mappedInputCount}/{packageInputs.length} mapped
                    </span>
                  </div>

                  {#if capabilitiesQuery.isLoading}
                    <div class="rounded-md border p-3 text-xs text-muted-foreground">Loading package inputs…</div>
                  {:else if packageInputs.length === 0}
                    <div class="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      This package has no end-user inputs. It will run from the ticket and site context already configured in the package.
                    </div>
                  {:else}
                    <div class="flex flex-col overflow-hidden rounded-lg border bg-background">
                      {#each packageInputs as input, index (input.promptKey)}
                        <div class="flex flex-col gap-2 p-3 {index > 0 ? 'border-t' : ''}">
                          <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                              <p class="truncate text-xs font-medium">{input.label}</p>
                              <p class="truncate font-mono text-[9px] text-muted-foreground">{input.promptKey}</p>
                            </div>
                            <span class="rounded px-1.5 py-0.5 text-[9px] font-medium {input.required ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'}">
                              {input.required ? 'Required' : 'Optional'}
                            </span>
                          </div>
                          <SingleSelect
                            options={sourceOptions(input)}
                            selected={sourceValue(input)}
                            placeholder="Choose a value source…"
                            onchange={(value) => setInputSource(input, value)}
                            class="h-8 text-xs"
                          />
                          {#if packageBindings[input.promptKey]?.kind === 'literal'}
                            <Input
                              value={String((packageBindings[input.promptKey] as Extract<AgentFormInputSource, { kind: 'literal' }>).value ?? '')}
                              oninput={(event) => setLiteral(input, (event.currentTarget as HTMLInputElement).value)}
                              placeholder="Fixed value"
                              class="h-8 text-xs font-mono"
                            />
                          {/if}
                          {#if input.description}
                            <p class="text-[10px] leading-relaxed text-muted-foreground">{input.description}</p>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/if}
              {/if}
            </div>
          {/if}
        {/if}
      </div>

    </div>
    {/if}
</div>
