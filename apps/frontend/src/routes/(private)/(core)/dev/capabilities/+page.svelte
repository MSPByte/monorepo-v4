<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { INTEGRATIONS, WRITE_BACK_ALLOWED_TABLES } from '@mspbyte/shared';
  import { toast } from 'svelte-sonner';

  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Label } from '$lib/components/ui/label';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Sheet from '$lib/components/ui/sheet';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import {
    NativeSelect,
    NativeSelectOption,
  } from '$lib/components/ui/native-select';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { toUserMessage } from '$lib/utils/errors';

  import BookOpen from '@lucide/svelte/icons/book-open';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Copy from '@lucide/svelte/icons/copy';
  import Download from '@lucide/svelte/icons/download';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  // ── Integration options ────────────────────────────────────────────────────
  const INTEGRATION_OPTIONS = Object.values(INTEGRATIONS).map((i) => ({
    id: i.id,
    name: i.name,
  }));

  // Connection defaults per integration (activeLink = needs a site link)
  const CONNECTION_DEFAULTS: Record<string, 'configured' | 'activeLink'> = {
    'microsoft-365': 'activeLink',
    'sophos-partner': 'activeLink',
    dattormm: 'activeLink',
    cove: 'configured',
    mspagent: 'configured',
    halopsa: 'configured',
  };

  // HTTP method colours
  const METHOD_COLORS: Record<string, string> = {
    GET: 'text-sky-600 bg-sky-50 border-sky-200',
    POST: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    PUT: 'text-amber-600 bg-amber-50 border-amber-200',
    PATCH: 'text-violet-600 bg-violet-50 border-violet-200',
    DELETE: 'text-rose-600 bg-rose-50 border-rose-200',
  };

  type LifecycleStatus = 'generated' | 'approved' | 'live' | 'rejected';
  type Tab = LifecycleStatus | 'import' | 'registry';

  // ── Navigation ─────────────────────────────────────────────────────────────
  let activeTab: Tab = $state('import');
  let selectedId: string | null = $state(null);
  let showGuide = $state(false);

  // ── Import form ────────────────────────────────────────────────────────────
  let specUrl = $state('');
  let specText = $state('');
  let integration = $state(INTEGRATION_OPTIONS[0]?.id ?? 'microsoft-365');
  let connection: 'configured' | 'activeLink' = $state('activeLink');
  let specSource = $state('');
  let importStep: 'form' | 'preview' | 'done' = $state('form');

  // derived vendor from integration selection
  let vendor = $derived(integration);

  // auto-update connection when integration changes
  $effect(() => {
    connection = CONNECTION_DEFAULTS[integration] ?? 'configured';
  });

  // init write-back, output panels, and metadata form when candidate selection changes
  $effect(() => {
    initWriteBack(selectedQuery.data);
    initOutputFields(selectedQuery.data);
    initMeta(selectedQuery.data);
    initInputRows(selectedQuery.data);
    initTestInputs(selectedQuery.data);
    editingMeta = false;
    activeTestRunId = null;
    activeTestPackageId = null;
    showTestRunner = false;
    testLinkId = null;
    showBodyFieldPicker = false;
    selectedBodyFields = new Set();
  });

  // Operations preview state
  let previewOps: Array<{ operationId: string; method: string; path: string; summary?: string }> = $state([]);
  let selectedOps = $state(new Set<string>());
  let opSearch = $state('');
  let methodFilter = $state('ALL');

  let filteredOps = $derived(
    previewOps.filter((op) => {
      if (methodFilter !== 'ALL' && op.method !== methodFilter) return false;
      if (!opSearch.trim()) return true;
      const q = opSearch.toLowerCase();
      return (
        op.operationId.toLowerCase().includes(q) ||
        op.path.toLowerCase().includes(q) ||
        (op.summary ?? '').toLowerCase().includes(q)
      );
    }),
  );

  let availableMethods = $derived([...new Set(previewOps.map((o) => o.method))].sort());

  // ── Candidate list search ──────────────────────────────────────────────────
  let candidateSearch = $state('');

  // ── Registry search ────────────────────────────────────────────────────────
  let registrySearch = $state('');

  // ── Candidate detail ───────────────────────────────────────────────────────
  let editingJson = $state(false);
  let editJson = $state('');
  let smokeEvidence = $state('');
  let smokeNotes = $state('');
  let showSmokeDialog = $state(false);
  let showScaffold = $state(false);
  let scaffoldContent = $state('');
  let scaffoldFile = $state('');
  let showStatusDialog = $state(false);
  let pendingStatus: LifecycleStatus | null = $state(null);
  let statusNotes = $state('');
  let showDeleteDialog = $state(false);

  // ── Metadata editing ───────────────────────────────────────────────────────
  let editingMeta = $state(false);
  let metaName = $state('');
  let metaDescription = $state('');
  let metaCategory = $state('');
  let metaVendor = $state('');
  let metaNotes = $state('');

  function initMeta(c: typeof selectedQuery.data) {
    if (!c) return;
    metaName = c.name;
    metaDescription = c.description ?? '';
    metaCategory = c.category ?? '';
    metaVendor = c.vendor;
    metaNotes = c.notes ?? '';
  }

  // ── E2E test runner ────────────────────────────────────────────────────────
  let testLinkId = $state<string | null>(null);
  let testInputs = $state<Record<string, string>>({});
  let activeTestRunId = $state<string | null>(null);
  let activeTestPackageId = $state<string | null>(null);
  let showTestRunner = $state(false);

  function initTestInputs(candidate: typeof selectedQuery.data) {
    if (!candidate) return;
    const meta = (candidate.inputMeta ?? {}) as Record<string, { required?: boolean; valueType?: string }>;
    testInputs = Object.fromEntries(Object.keys(meta).map((k) => [k, '']));
  }

  // ── Input field definitions ────────────────────────────────────────────────
  type InputLocation = 'path' | 'query' | 'body' | 'none';

  type InputRow = {
    key: string;
    label: string;
    description: string;
    required: boolean;
    valueType: string;
    /** Set when valueType starts with 'entity:' — e.g. 'm365_identity'. */
    entityType?: string;
    location: InputLocation;
    apiFieldName: string;
  };

  const INPUT_LOCATIONS: { value: InputLocation; label: string }[] = [
    { value: 'path',  label: 'path'  },
    { value: 'query', label: 'query' },
    { value: 'body',  label: 'body'  },
    { value: 'none',  label: 'meta'  },
  ];

  let inputRows: InputRow[] = $state([]);

  function initInputRows(candidate: typeof selectedQuery.data) {
    if (!candidate) return;
    type Param = { in: string; name: string; input: string; required?: boolean };
    const params = ((candidate.operation as Record<string, unknown>)?.parameters ?? []) as Param[];
    const meta = (candidate.inputMeta ?? {}) as Record<string, {
      label?: string; description?: string; required?: boolean; valueType?: string; entityType?: string;
    }>;

    const toRowValueType = (m: { valueType?: string; entityType?: string }) =>
      m.entityType ? `entity:${m.entityType}` : (m.valueType ?? 'text');

    const seen = new Set<string>();
    const rows: InputRow[] = [];

    for (const p of params) {
      seen.add(p.input);
      const m = meta[p.input] ?? {};
      rows.push({
        key: p.input,
        label: m.label ?? p.input,
        description: m.description ?? '',
        required: p.required ?? m.required ?? false,
        valueType: toRowValueType(m),
        entityType: m.entityType,
        location: (p.in as InputLocation) ?? 'none',
        apiFieldName: p.name,
      });
    }

    for (const [key, m] of Object.entries(meta)) {
      if (seen.has(key)) continue;
      rows.push({
        key,
        label: m.label ?? key,
        description: m.description ?? '',
        required: m.required ?? false,
        valueType: toRowValueType(m),
        entityType: m.entityType,
        location: 'none',
        apiFieldName: key,
      });
    }

    inputRows = rows;
  }

  function buildInputsFromRows(candidate: typeof selectedQuery.data) {
    const op = (candidate!.operation ?? {}) as Record<string, unknown>;
    const existingBody = (op.body as Record<string, unknown> | undefined) ?? {};

    const newParameters = inputRows
      .filter((r) => r.location !== 'none' && r.key)
      .map((r) => ({
        in: r.location,
        input: r.key,
        name: r.apiFieldName || r.key,
        ...(r.required ? { required: true } : {}),
      }));

    const newInputMeta: Record<string, unknown> = {};
    for (const r of inputRows.filter((r) => r.key)) {
      const isEntity = r.valueType.startsWith('entity:');
      const entityType = isEntity ? r.valueType.slice('entity:'.length) : undefined;
      newInputMeta[r.key] = {
        label: r.label || r.key,
        required: r.required,
        ...(isEntity
          ? { entityType, allowedBindings: ['literal', 'runtime', 'priorOutput'] }
          : { valueType: r.valueType }),
        ...(r.description ? { description: r.description } : {}),
      };
    }

    const hasBodyParams = inputRows.some((r) => r.location === 'body');
    let newBody: Record<string, unknown> | undefined;
    if (existingBody.contentType || Object.keys(existingBody).length > 0) {
      newBody = { ...existingBody };
      if (hasBodyParams) delete newBody.input;
    }

    return { newInputMeta, newParameters, newBody };
  }

  // Derived key list used in DB sync + outputs auto-suggest (live from editor state)
  let inputRowKeys = $derived(inputRows.filter((r) => r.key).map((r) => r.key));

  // Body passthrough detection
  let bodyPassthroughKey = $derived(() => {
    if (!selectedQuery.data) return null;
    const op = (selectedQuery.data.operation ?? {}) as Record<string, unknown>;
    const body = op.body as Record<string, string> | undefined;
    const hasBodyParams = inputRows.some((r) => r.location === 'body');
    if (body?.input && !hasBodyParams) return body.input;
    return null;
  });

  const saveInputsMutation = createMutation(() => ({
    mutationFn: (candidate: typeof selectedQuery.data & {}) => {
      const { newInputMeta, newParameters, newBody } = buildInputsFromRows(candidate);
      const op: Record<string, unknown> = { ...(candidate!.operation as Record<string, unknown>), parameters: newParameters };
      if (newBody !== undefined) op.body = newBody;
      return trpc.capabilities.candidates.upsert.mutate({
        id: candidate!.id,
        vendor: candidate!.vendor,
        name: candidate!.name,
        description: candidate!.description,
        category: candidate!.category,
        integration: (candidate!.integration ?? {}) as Record<string, unknown>,
        operation: op,
        inputMeta: newInputMeta,
        outputMeta: (candidate!.outputMeta ?? {}) as Record<string, unknown>,
        sourceUrl: candidate!.sourceUrl,
        notes: candidate!.notes,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.detail', selectedId] });
      toast.success('Inputs saved');
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  // ── Output field definitions ───────────────────────────────────────────────
  type OutFieldSource = 'response' | 'input';
  type OutField = {
    key: string;
    label: string;
    description: string;
    valueType: string;
    source: OutFieldSource;
    path: string;      // for source:'response' — dot-path into response body
    inputKey: string;  // for source:'input' — echo this input key
    sensitive: boolean;
  };

  const VALUE_TYPES = [
    { value: 'text',      label: 'Text' },
    { value: 'number',    label: 'Number' },
    { value: 'boolean',   label: 'Yes / No' },
    { value: 'object',    label: 'Object' },
    { value: 'text_list', label: 'List' },
    { value: 'uuid',      label: 'UUID' },
  ];

  // Entity type options — shown only in the input type picker, not outputs.
  const ENTITY_VALUE_TYPES = [
    { value: 'entity:m365_identity',      label: 'M365 Identity' },
    { value: 'entity:m365_group',         label: 'M365 Group' },
    { value: 'entity:m365_license',       label: 'M365 License' },
    { value: 'entity:m365_role',          label: 'M365 Role' },
    { value: 'entity:sophos_endpoint',    label: 'Sophos Endpoint' },
    { value: 'entity:halo_ticket',        label: 'Halo Ticket' },
  ];

  const INPUT_VALUE_TYPES = [
    ...VALUE_TYPES,
    ...ENTITY_VALUE_TYPES,
  ];

  let outFields: OutField[] = $state([]);

  let outFieldDuplicateKeys = $derived(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const f of outFields) {
      if (!f.key) continue;
      if (seen.has(f.key)) dupes.add(f.key);
      seen.add(f.key);
    }
    return dupes;
  });

  function initOutputFields(candidate: typeof selectedQuery.data) {
    if (!candidate) return;
    const om = (candidate.outputMeta ?? {}) as Record<string, {
      label?: string; description?: string; valueType?: string;
      source?: OutFieldSource; path?: string; inputKey?: string; sensitive?: boolean;
    }>;
    outFields = Object.entries(om)
      .filter(([key]) => key !== 'data' && key !== 'status')
      .map(([key, def]) => ({
        key,
        label: def.label ?? key,
        description: def.description ?? '',
        valueType: def.valueType ?? 'text',
        source: def.source ?? 'response',
        path: def.path ?? '',
        inputKey: def.inputKey ?? '',
        sensitive: def.sensitive ?? false,
      }));
  }

  function autoSuggestOutputs(candidate: typeof selectedQuery.data): void {
    if (!candidate) return;
    const op = (candidate.operation ?? {}) as { method?: string };
    const method = op.method ?? '';
    const existing = new Set(outFields.map((f) => f.key));
    const suggestions: OutField[] = [];

    if (method === 'PATCH' || method === 'PUT') {
      // PATCH/PUT usually returns 204 — echo body params as outputs
      const bodyKeys = inputRows.filter((r) => r.location === 'body' && r.key);
      for (const r of bodyKeys) {
        if (existing.has(r.key)) continue;
        suggestions.push({
          key: r.key,
          label: r.label || r.key.replace(/([A-Z])/g, ' $1').replace(/^\s/, ''),
          description: '',
          valueType: r.valueType.startsWith('entity:') ? 'uuid' : r.valueType,
          source: 'input',
          path: '',
          inputKey: r.key,
          sensitive: false,
        });
      }
    } else if (method === 'POST' || method === 'GET') {
      // POST/GET returns a body — suggest common fields
      for (const field of ['id', 'createdDateTime', 'displayName']) {
        if (!existing.has(field)) {
          suggestions.push({
            key: field,
            label: field.replace(/([A-Z])/g, ' $1').replace(/^\s/, ''),
            description: '',
            valueType: field === 'id' ? 'uuid' : 'text',
            source: 'response',
            path: field,
            inputKey: '',
            sensitive: false,
          });
        }
      }
    }

    outFields = [...outFields, ...suggestions];
  }

  function buildOutputMeta(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      data: { label: 'Response Data', description: 'The raw API response body.', valueType: 'object' },
      status: { label: 'HTTP Status', description: 'The HTTP status code returned by the vendor API.', valueType: 'number' },
    };
    for (const f of outFields) {
      if (!f.key) continue;
      const def: Record<string, unknown> = { label: f.label || f.key, valueType: f.valueType, source: f.source };
      if (f.description) def.description = f.description;
      if (f.source === 'response' && f.path) def.path = f.path;
      if (f.source === 'input' && f.inputKey) def.inputKey = f.inputKey;
      if (f.sensitive) def.sensitive = true;
      base[f.key] = def;
    }
    return base;
  }

  const saveOutputsMutation = createMutation(() => ({
    mutationFn: (candidate: typeof selectedQuery.data & {}) =>
      trpc.capabilities.candidates.upsert.mutate({
        id: candidate!.id,
        vendor: candidate!.vendor,
        name: candidate!.name,
        description: candidate!.description,
        category: candidate!.category,
        integration: (candidate!.integration ?? {}) as Record<string, unknown>,
        operation: (candidate!.operation ?? {}) as Record<string, unknown>,
        inputMeta: (candidate!.inputMeta ?? {}) as Record<string, unknown>,
        outputMeta: buildOutputMeta(),
        sourceUrl: candidate!.sourceUrl,
        notes: candidate!.notes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.detail', selectedId] });
      toast.success('Outputs saved');
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  // ── Write-back (DB sync) ───────────────────────────────────────────────────
  type WbEffect = 'none' | 'patch' | 'insert' | 'delete';
  type WbSource = 'inputs' | 'response';
  type WbMapping = { field: string; column: string; source: WbSource };

  let wbEffect: WbEffect = $state('none');
  let wbTable = $state('');
  let wbKeyField = $state('');
  let wbKeyColumn = $state('');
  let wbKeySource: WbSource = $state('inputs');
  let wbMappings: WbMapping[] = $state([]);

  function defaultEffectForMethod(method?: string): WbEffect {
    if (method === 'PATCH' || method === 'PUT') return 'patch';
    if (method === 'POST') return 'insert';
    if (method === 'DELETE') return 'delete';
    return 'none';
  }

  function toSnakeCase(s: string): string {
    return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }

  function initWriteBack(candidate: typeof selectedQuery.data) {
    if (!candidate) return;
    const op = (candidate.operation ?? {}) as Record<string, unknown>;
    const wb = op.writeBack as Record<string, unknown> | undefined;
    if (wb) {
      wbEffect = (wb.effect as WbEffect) ?? 'none';
      wbTable = (wb.table as string) ?? '';
      const key = wb.key as Record<string, string> | undefined;
      wbKeyField = key?.field ?? '';
      wbKeyColumn = key?.column ?? '';
      wbKeySource = (key?.source as WbSource) ?? 'inputs';
      wbMappings = ((wb.mappings as WbMapping[]) ?? []).map((m) => ({ ...m }));
    } else {
      wbEffect = defaultEffectForMethod(op.method as string);
      wbTable = '';
      wbKeyField = '';
      wbKeyColumn = '';
      wbKeySource = 'inputs';
      wbMappings = [];
    }
  }

  function autoSuggestMappings(
    integrationTables: Record<string, { columns: ReadonlyArray<{ name: string }> }>,
    table: string,
    inputKeys: string[],
  ): WbMapping[] {
    const schema = integrationTables[table];
    if (!schema) return [];
    const colSet = new Set(schema.columns.map((c) => c.name));
    const SPECIAL: Record<string, string> = {
      displayName: 'name',
      accountEnabled: 'enabled',
      mail: 'email',
      userPrincipalName: 'email',
    };
    const seen = new Set<string>();
    const out: WbMapping[] = [];
    for (const field of inputKeys) {
      const col = SPECIAL[field] ?? toSnakeCase(field);
      if (colSet.has(col) && !seen.has(col)) {
        seen.add(col);
        out.push({ field, column: col, source: 'inputs' });
      }
    }
    return out;
  }

  function buildWriteBack(): Record<string, unknown> | undefined {
    if (wbEffect === 'none') return undefined;
    const wb: Record<string, unknown> = { effect: wbEffect };
    if (wbTable) wb.table = wbTable;
    if (wbKeyField && wbKeyColumn) {
      wb.key = { field: wbKeyField, column: wbKeyColumn, source: wbKeySource };
    }
    if (wbMappings.length > 0) wb.mappings = wbMappings;
    return wb;
  }

  const saveWriteBackMutation = createMutation(() => ({
    mutationFn: (candidate: typeof selectedQuery.data & {}) => {
      const op = { ...(candidate!.operation as Record<string, unknown>) };
      const wb = buildWriteBack();
      if (wb) op.writeBack = wb;
      else delete op.writeBack;
      return trpc.capabilities.candidates.upsert.mutate({
        id: candidate!.id,
        vendor: candidate!.vendor,
        name: candidate!.name,
        description: candidate!.description,
        category: candidate!.category,
        integration: (candidate!.integration ?? {}) as Record<string, unknown>,
        operation: op,
        inputMeta: (candidate!.inputMeta ?? {}) as Record<string, unknown>,
        outputMeta: (candidate!.outputMeta ?? {}) as Record<string, unknown>,
        sourceUrl: candidate!.sourceUrl,
        notes: candidate!.notes,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidate', selectedId] });
      toast.success('DB sync saved');
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  // ── Curl command generator ─────────────────────────────────────────────────
  const INTEGRATION_BASE_URLS: Record<string, string> = {
    'microsoft-365': 'https://graph.microsoft.com/v1.0',
    'halopsa': 'https://<your-halo-domain>/api',
    'sophos-partner': 'https://api.central.sophos.com',
    dattormm: 'https://api.datto.com/api/v1',
    cove: 'https://api.backup.management',
  };

  function generateCurl(candidate: { integration?: unknown; operation?: unknown }): string {
    type Param = { in: string; name: string; input: string };
    const op = (candidate.operation ?? {}) as {
      method?: string;
      path?: string;
      parameters?: Param[];
      body?: { contentType?: string; input?: string };
    };
    const intg = (candidate.integration ?? {}) as { integrationId?: string };
    const baseUrl = INTEGRATION_BASE_URLS[intg?.integrationId ?? ''] ?? 'https://api.vendor.example';
    const method = op.method ?? 'GET';

    let path = op.path ?? '/';
    for (const p of (op.parameters ?? []).filter((p) => p.in === 'path')) {
      path = path.replace(`{${p.name}}`, `<${p.name.toUpperCase().replace(/-/g, '_')}>`);
    }

    const queryParams = (op.parameters ?? []).filter((p) => p.in === 'query');
    const bodyFields = (op.parameters ?? []).filter((p) => p.in === 'body');

    let url = `${baseUrl}${path}`;
    if (queryParams.length > 0) {
      url += '?' + queryParams.map((p) => `${p.name}=<${p.name.toUpperCase()}>`).join('&');
    }

    let cmd = `curl -s -X ${method} \\\n  "${url}" \\\n  -H "Authorization: Bearer <ACCESS_TOKEN>"`;

    if (op.body) {
      cmd += ` \\\n  -H "Content-Type: ${op.body.contentType ?? 'application/json'}"`;
      if (op.body.input) {
        cmd += ` \\\n  -d '{"key": "value"}'`;
      } else if (bodyFields.length > 0) {
        const shown = bodyFields.slice(0, 5);
        const bodyLines = shown
          .map((f, i) => `    "${f.name}": "<${f.name.toUpperCase().replace(/-/g, '_')}>"${i < shown.length - 1 ? ',' : ''}`)
          .join('\n');
        const more = bodyFields.length > 5 ? `\n    // … ${bodyFields.length - 5} more optional fields` : '';
        cmd += ` \\\n  -d '{\n${bodyLines}${more}\n  }'`;
      }
    }

    return cmd;
  }

  // ── Fetch spec from URL ────────────────────────────────────────────────────
  let fetchingSpec = $state(false);
  async function fetchSpec() {
    if (!specUrl.trim()) return;
    fetchingSpec = true;
    try {
      const res = await fetch(specUrl.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      specText = await res.text();
      specSource = specUrl.trim();
      toast.success('Spec fetched');
    } catch (e) {
      toast.error(`Could not fetch: ${toUserMessage(e)}. Try pasting the spec text directly.`);
    } finally {
      fetchingSpec = false;
    }
  }

  // ── tRPC ───────────────────────────────────────────────────────────────────
  const countsQuery = createQuery(() => ({
    queryKey: ['capabilities.candidates.counts'],
    queryFn: () => trpc.capabilities.candidates.counts.query(),
    refetchInterval: 10_000,
  }));

  const previewMutation = createMutation(() => ({
    mutationFn: (text: string) => trpc.capabilities.import.preview.mutate({ specText: text }),
    onSuccess: (ops) => {
      previewOps = ops;
      selectedOps = new Set(ops.map((o) => o.operationId));
      opSearch = '';
      methodFilter = 'ALL';
      importStep = 'preview';
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const saveMutation = createMutation(() => ({
    mutationFn: () =>
      trpc.capabilities.import.save.mutate({
        specText,
        integration,
        vendor,
        connection,
        operations: [...selectedOps],
        source: specSource || undefined,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidates'] });
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.counts'] });
      toast.success(`${r.saved.length} candidate(s) saved`);
      activeTab = 'generated';
      selectedId = r.saved[0] ?? null;
      importStep = 'form';
      specText = '';
      specUrl = '';
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const candidatesQuery = createQuery(() => ({
    queryKey: ['capabilities.candidates', activeTab],
    queryFn: () =>
      ['import', 'registry'].includes(activeTab)
        ? Promise.resolve([])
        : trpc.capabilities.candidates.list.query({ status: activeTab as LifecycleStatus }),
    enabled: !['import', 'registry'].includes(activeTab),
  }));

  let filteredCandidates = $derived(
    (candidatesQuery.data ?? []).filter((c) => {
      if (!candidateSearch.trim()) return true;
      const q = candidateSearch.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    }),
  );

  const registryQuery = createQuery(() => ({
    queryKey: ['capabilities.registry'],
    queryFn: () => trpc.capabilities.registry.list.query(),
    enabled: activeTab === 'registry',
  }));

  const filteredRegistry = $derived(
    (registryQuery.data ?? []).filter((cap) => {
      if (!registrySearch.trim()) return true;
      const q = registrySearch.toLowerCase();
      return (
        cap.name.toLowerCase().includes(q) ||
        cap.id.toLowerCase().includes(q) ||
        cap.vendor.toLowerCase().includes(q) ||
        (cap.category ?? '').toLowerCase().includes(q)
      );
    }),
  );

  const selectedQuery = createQuery(() => ({
    queryKey: ['capabilities.candidates.detail', selectedId],
    queryFn: () => trpc.capabilities.candidates.get.query({ id: selectedId! }),
    enabled: !!selectedId && !['import', 'registry'].includes(activeTab),
  }));

  // ── Body field browser ─────────────────────────────────────────────────────
  let showBodyFieldPicker = $state(false);
  let selectedBodyFields = $state(new Set<string>());

  const bodyFieldsQuery = createQuery(() => ({
    queryKey: ['capabilities.candidates.bodyFields', selectedId],
    queryFn: () => trpc.capabilities.candidates.fetchBodyFields.query({ candidateId: selectedId! }),
    enabled: showBodyFieldPicker && !!selectedId,
    staleTime: Infinity,
  }));

  function addSelectedBodyFields() {
    const existing = new Set(inputRows.map((r) => r.key));
    const fields = (bodyFieldsQuery.data?.fields ?? []).filter((f) => selectedBodyFields.has(f.name));
    const newRows = fields
      .filter((f) => !existing.has(f.name))
      .map((f): InputRow => ({
        key: f.name,
        label: labelFor(f.name),
        description: f.description ?? '',
        required: f.required,
        valueType: f.valueType,
        location: 'body',
        apiFieldName: f.name,
      }));
    inputRows = [...inputRows, ...newRows];
    showBodyFieldPicker = false;
    selectedBodyFields = new Set();
  }

  function labelFor(name: string): string {
    return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const smokeTestsQuery = createQuery(() => ({
    queryKey: ['capabilities.smokeTests', selectedId],
    queryFn: () => trpc.capabilities.smokeTests.list.query({ candidateId: selectedId! }),
    enabled: !!selectedId && !['import', 'registry'].includes(activeTab),
  }));

  const setStatus = createMutation(() => ({
    mutationFn: (vars: { id: string; status: LifecycleStatus; notes?: string }) =>
      trpc.capabilities.candidates.setStatus.mutate(vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidates'] });
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.counts'] });
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.detail', selectedId] });
      toast.success('Status updated');
      showStatusDialog = false;
      statusNotes = '';
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const upsertMutation = createMutation(() => ({
    mutationFn: (body: string) => trpc.capabilities.candidates.upsert.mutate(JSON.parse(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.detail', selectedId] });
      toast.success('Saved');
      editingJson = false;
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const addSmokeTest = createMutation(() => ({
    mutationFn: (vars: { candidateId: string; evidence: string; notes?: string }) =>
      trpc.capabilities.smokeTests.add.mutate(vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.smokeTests', selectedId] });
      toast.success('Test recorded');
      showSmokeDialog = false;
      smokeEvidence = '';
      smokeNotes = '';
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const scaffoldMutation = createMutation(() => ({
    mutationFn: (id: string) => trpc.capabilities.scaffold.generate.mutate({ candidateId: id }),
    onSuccess: (r) => {
      scaffoldContent = r.content;
      scaffoldFile = r.filename;
      showScaffold = true;
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const deleteMutation = createMutation(() => ({
    mutationFn: (id: string) => trpc.capabilities.candidates.delete.mutate({ id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidates'] });
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.counts'] });
      selectedId = null;
      showDeleteDialog = false;
      toast.success('Candidate deleted');
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const updateMetaMutation = createMutation(() => ({
    mutationFn: (c: typeof selectedQuery.data & {}) =>
      trpc.capabilities.candidates.upsert.mutate({
        id: c!.id,
        vendor: metaVendor,
        name: metaName,
        description: metaDescription || null,
        category: metaCategory || null,
        integration: (c!.integration ?? {}) as Record<string, unknown>,
        operation: (c!.operation ?? {}) as Record<string, unknown>,
        inputMeta: (c!.inputMeta ?? {}) as Record<string, unknown>,
        outputMeta: (c!.outputMeta ?? {}) as Record<string, unknown>,
        sourceUrl: c!.sourceUrl,
        notes: metaNotes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['capabilities.candidates.detail', selectedId] });
      qc.invalidateQueries({ queryKey: ['capabilities.candidates'] });
      editingMeta = false;
      toast.success('Metadata saved');
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const runTestMutation = createMutation(() => ({
    mutationFn: (vars: { candidateId: string; linkId?: string | null; inputs: Record<string, unknown> }) =>
      trpc.capabilities.candidates.runTest.mutate(vars),
    onSuccess: (r) => {
      activeTestRunId = r.runId;
      activeTestPackageId = r.packageId;
    },
    onError: (e) => toast.error(toUserMessage(e)),
  }));

  const deleteTestPackageMutation = createMutation(() => ({
    mutationFn: (packageId: string) =>
      trpc.capabilities.candidates.deleteTestPackage.mutate({ packageId }),
    onError: (e) => console.error('Failed to clean up dev-test package:', toUserMessage(e)),
  }));

  // Auto-cleanup: once the test run settles, delete the throwaway package so it
  // doesn't appear in the packages list showing "capability no longer available".
  $effect(() => {
    const status = testResultQuery.data?.status;
    if ((status === 'completed' || status === 'failed') && activeTestPackageId) {
      const pid = activeTestPackageId;
      activeTestPackageId = null;
      deleteTestPackageMutation.mutate(pid);
    }
  });

  const testResultQuery = createQuery(() => ({
    queryKey: ['capabilities.candidates.testResult', activeTestRunId],
    queryFn: () => trpc.capabilities.candidates.getTestResult.query({ runId: activeTestRunId! }),
    enabled: !!activeTestRunId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'pending' || s === 'queued' || s === 'running' ? 2000 : false;
    },
  }));

  // Integration links for the test link picker
  const testLinksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.forTest', selectedQuery.data?.id],
    queryFn: () => {
      const intg = (selectedQuery.data?.integration as { integrationId?: string })?.integrationId;
      return trpc.integrationLinks.list.query({ integrationId: intg });
    },
    enabled: showTestRunner && !!selectedQuery.data,
  }));

  // ── Helpers ────────────────────────────────────────────────────────────────
  function badgeVariant(status: LifecycleStatus) {
    if (status === 'live') return 'default' as const;
    if (status === 'approved') return 'secondary' as const;
    if (status === 'rejected') return 'destructive' as const;
    return 'outline' as const;
  }

  function openStatus(status: LifecycleStatus) {
    pendingStatus = status;
    showStatusDialog = true;
  }

  function startEdit(c: Record<string, unknown>) {
    editJson = JSON.stringify(c, null, 2);
    editingJson = true;
  }

  function copy(text: string, label = 'Copied') {
    navigator.clipboard.writeText(text);
    toast.success(label);
  }

  function download(filename: string, content: string) {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([content], { type: 'text/plain' })),
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toggleOp(id: string) {
    const next = new Set(selectedOps);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedOps = next;
  }

  function selectVisible(select: boolean) {
    const next = new Set(selectedOps);
    for (const op of filteredOps) {
      if (select) next.add(op.operationId); else next.delete(op.operationId);
    }
    selectedOps = next;
  }

  const GUIDE_PHASES = [
    {
      phase: '1 — Import',
      steps: [
        'Paste a spec URL and click Fetch, or paste JSON/YAML directly',
        'Select the integration and connection type',
        'Click Parse — all operations in the spec appear',
        'Search or filter by method, then select the ones to import',
        'Click Import to save candidates to the catalog',
      ],
    },
    {
      phase: '2 — Review & refine',
      steps: [
        'Open a candidate and read the auto-generated metadata',
        'Click Edit JSON to add entity mappings, fix labels, narrow bindings',
        'Download the JSON as a reference for the handler author',
        'Record a smoke test — manually call the API on a non-prod tenant',
        'Click Approve once the metadata and test pass review',
      ],
    },
    {
      phase: '3 — Build or ship as dynamic',
      steps: [
        'OpenAPI pass-through (GET / POST / PATCH / DELETE via connector): no TypeScript required',
        'Set inputs, outputs, and optional DB sync in the builder, then mark Approved → Live',
        'The dynamic executor resolves the manifest at runtime — no code change, no deploy',
        'For bespoke logic: click Generate scaffold, fill in the handler, register in src/registry.ts',
        'Code-backed capabilities must export from the vendor index and pass bun run check-types',
      ],
    },
    {
      phase: '4 — Ship',
      steps: [
        'Click Mark live — liveAt timestamp is set in catalog',
        'Dynamic capabilities are immediately available; code-backed ones need a deploy',
        'The capability appears in the Registry tab under type: catalog or type: code',
        "Available in the package builder for any tenant whose integration is configured",
      ],
    },
  ];
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between border-b px-6 py-4 shrink-0">
    <div>
      <h1 class="text-lg font-semibold">Capabilities Workshop</h1>
      <p class="text-sm text-muted-foreground">Import OpenAPI specs, review candidates, scaffold handlers, and ship.</p>
    </div>
    <Button variant="outline" size="sm" onclick={() => showGuide = true}>
      <BookOpen class="mr-1.5 size-3.5" />
      Guide
    </Button>
  </div>

  <!-- Tabs with counts -->
  <div class="flex items-center gap-0 border-b px-4 shrink-0">
    {#each [
      { id: 'import' as Tab, label: 'Import', count: null },
      { id: 'generated' as Tab, label: 'Generated', count: countsQuery.data?.generated ?? null },
      { id: 'approved' as Tab, label: 'Approved', count: countsQuery.data?.approved ?? null },
      { id: 'live' as Tab, label: 'Live', count: countsQuery.data?.live ?? null },
      { id: 'rejected' as Tab, label: 'Rejected', count: countsQuery.data?.rejected ?? null },
      { id: 'registry' as Tab, label: 'Registry', count: null },
    ] as tab}
      <button
        onclick={() => { activeTab = tab.id; selectedId = null; candidateSearch = ''; if (tab.id === 'import') importStep = 'form'; }}
        class="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
          {activeTab === tab.id
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        {tab.label}
        {#if tab.count !== null && tab.count > 0}
          <span class="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium leading-none text-muted-foreground">
            {tab.count}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Body -->
  <div class="flex flex-1 overflow-hidden">

    <!-- ── IMPORT TAB ──────────────────────────────────────────────────────── -->
    {#if activeTab === 'import'}
      <div class="flex-1 overflow-auto p-6">

        {#if importStep === 'form'}
          <!-- Two-column layout: spec left, integration right -->
          <div class="grid grid-cols-[1fr_320px] gap-5 max-w-5xl">
            <!-- Left: spec source -->
            <SectionPanel title="Spec source" code="SRC">
              <div class="space-y-3">
                <div>
                  <Label>Spec URL</Label>
                  <div class="flex gap-2 mt-1">
                    <Input
                      bind:value={specUrl}
                      placeholder="https://vendor.example/openapi.yaml"
                      class="flex-1"
                      onkeydown={(e) => { if (e.key === 'Enter') fetchSpec(); }}
                    />
                    <Button variant="outline" onclick={fetchSpec} disabled={!specUrl.trim() || fetchingSpec}>
                      {fetchingSpec ? 'Fetching…' : 'Fetch'}
                    </Button>
                  </div>
                  <p class="text-xs text-muted-foreground mt-1">
                    Fetched by your browser — paste the text below if CORS blocks it.
                  </p>
                </div>
                <div>
                  <div class="flex items-baseline justify-between">
                    <Label>Spec text <span class="font-normal text-muted-foreground">(JSON or YAML)</span></Label>
                    {#if specText.trim()}
                      <span class="text-xs text-muted-foreground">{specText.length.toLocaleString()} chars</span>
                    {/if}
                  </div>
                  <Textarea
                    bind:value={specText}
                    placeholder="Paste OpenAPI/Swagger JSON or YAML here…"
                    class="mt-1 font-mono text-xs resize-none overflow-y-auto"
                    style="min-height: 140px; max-height: 220px;"
                  />
                </div>
              </div>
            </SectionPanel>

            <!-- Right: integration config -->
            <div class="space-y-5">
              <SectionPanel title="Integration" code="INT">
                <div class="space-y-4">
                  <div>
                    <Label>Integration</Label>
                    <NativeSelect bind:value={integration} class="mt-1 w-full">
                      {#each INTEGRATION_OPTIONS as opt}
                        <NativeSelectOption value={opt.id}>{opt.name}</NativeSelectOption>
                      {/each}
                    </NativeSelect>
                  </div>
                  <div>
                    <Label>Vendor ID <span class="font-normal text-muted-foreground">(auto)</span></Label>
                    <Input value={vendor} readonly class="mt-1 bg-muted/40 text-muted-foreground font-mono text-sm" />
                  </div>
                  <div>
                    <Label>Connection type</Label>
                    <div class="flex flex-col gap-2 mt-1.5">
                      {#each [
                        { value: 'activeLink' as const, label: 'Active link', hint: 'Requires a per-site integration link' },
                        { value: 'configured' as const, label: 'Configured', hint: 'Uses tenant-wide credentials' },
                      ] as opt}
                        <button
                          onclick={() => connection = opt.value}
                          class="rounded border px-3 py-2 text-left text-sm transition-colors
                            {connection === opt.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-input hover:bg-muted/50 text-muted-foreground'}"
                        >
                          <p class="font-medium">{opt.label}</p>
                          <p class="text-xs mt-0.5 {connection === opt.value ? 'text-primary/70' : 'text-muted-foreground'}">{opt.hint}</p>
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              </SectionPanel>

              <div class="flex justify-end">
                <Button
                  class="w-full"
                  disabled={!specText.trim() || previewMutation.isPending}
                  onclick={() => previewMutation.mutate(specText)}
                >
                  {previewMutation.isPending ? 'Parsing…' : 'Parse spec →'}
                </Button>
              </div>
            </div>
          </div>

        {:else if importStep === 'preview'}
          <!-- Operations preview: full width -->
          <div class="flex flex-col h-full gap-4" style="max-width: min(100%, 1200px);">
            <!-- Toolbar: search + method filters + bulk controls -->
            <div class="flex items-center gap-3 flex-wrap">
              <div class="relative flex-1 min-w-48">
                <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <Input bind:value={opSearch} placeholder="Search by ID, path, or summary…" class="pl-8 h-8 text-sm" />
                {#if opSearch}
                  <button onclick={() => opSearch = ''} class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X class="size-3.5" />
                  </button>
                {/if}
              </div>
              <!-- Method filter pills -->
              <div class="flex gap-1 shrink-0">
                {#each ['ALL', ...availableMethods] as m}
                  <button
                    onclick={() => methodFilter = m}
                    class="px-2.5 py-1 rounded text-xs font-semibold border transition-colors
                      {methodFilter === m
                        ? 'border-primary bg-primary text-primary-foreground'
                        : m === 'ALL'
                          ? 'border-input hover:bg-muted text-muted-foreground'
                          : `${METHOD_COLORS[m] ?? 'border-input text-muted-foreground'} opacity-60 hover:opacity-100`}"
                  >
                    {m}
                  </button>
                {/each}
              </div>
              <!-- Bulk controls -->
              <div class="flex items-center gap-3 text-xs shrink-0 ml-auto">
                <span class="text-muted-foreground">
                  {selectedOps.size} / {previewOps.length} selected
                  {#if filteredOps.length !== previewOps.length}· {filteredOps.length} visible{/if}
                </span>
                <button onclick={() => selectVisible(true)} class="text-primary hover:underline">Select visible</button>
                <button onclick={() => selectVisible(false)} class="text-muted-foreground hover:text-foreground">Clear visible</button>
                <button onclick={() => selectedOps = new Set()} class="text-muted-foreground hover:text-foreground">Clear all</button>
              </div>
            </div>

            <!-- Operations table -->
            <div class="flex-1 border rounded overflow-hidden flex flex-col">
              <!-- Table header -->
              <div class="grid gap-3 px-3 py-2 bg-muted/50 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0"
                style="grid-template-columns: 20px 70px 280px 1fr auto;">
                <span></span>
                <span>Method</span>
                <span>Path</span>
                <span>Operation ID</span>
                <span>Summary</span>
              </div>
              <!-- Rows -->
              <div class="overflow-y-auto flex-1" style="max-height: calc(100vh - 340px);">
                {#each filteredOps as op}
                  {@const checked = selectedOps.has(op.operationId)}
                  <label
                    class="grid items-center gap-3 px-3 py-2.5 border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors {checked ? 'bg-muted/20' : ''}"
                    style="grid-template-columns: 20px 70px 280px 1fr auto;"
                  >
                    <input
                      type="checkbox"
                      {checked}
                      onchange={() => toggleOp(op.operationId)}
                      class="shrink-0"
                    />
                    <span class="font-mono text-xs px-1.5 py-0.5 rounded border font-semibold text-center w-fit
                      {METHOD_COLORS[op.method] ?? 'text-foreground bg-muted border-border'}">
                      {op.method}
                    </span>
                    <span class="font-mono text-xs text-muted-foreground truncate" title={op.path}>{op.path}</span>
                    <span class="text-sm font-medium truncate" title={op.operationId}>{op.operationId}</span>
                    <span class="text-xs text-muted-foreground truncate max-w-64" title={op.summary}>{op.summary ?? ''}</span>
                  </label>
                {/each}
                {#if filteredOps.length === 0}
                  <p class="px-3 py-10 text-center text-sm text-muted-foreground">No operations match your search.</p>
                {/if}
              </div>
            </div>

            <!-- Footer actions -->
            <div class="flex justify-between shrink-0">
              <Button variant="outline" onclick={() => { importStep = 'form'; previewOps = []; }}>← Back</Button>
              <Button
                disabled={selectedOps.size === 0 || saveMutation.isPending}
                onclick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? 'Saving…' : `Import ${selectedOps.size} candidate${selectedOps.size === 1 ? '' : 's'} →`}
              </Button>
            </div>
          </div>
        {/if}
      </div>

    <!-- ── REGISTRY TAB ─────────────────────────────────────────────────────── -->
    {:else if activeTab === 'registry'}
      <div class="flex-1 overflow-auto p-6">
        {#if registryQuery.isPending}
          <Loader />
        {:else if registryQuery.data}
          {@const codeCount = registryQuery.data.filter((c) => c.type === 'code').length}
          {@const catalogCount = registryQuery.data.filter((c) => c.type === 'catalog').length}
          <SectionPanel title="All capabilities — {registryQuery.data.length} total ({codeCount} code, {catalogCount} catalog)" code="REG">
            <!-- Search -->
            <div class="mb-3">
              <Input
                bind:value={registrySearch}
                placeholder="Search by name, ID, vendor, or category…"
                class="h-8 text-sm"
              />
            </div>
            <!-- Table header -->
            <div class="grid gap-3 px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b bg-muted/30"
              style="grid-template-columns: 1fr 100px 80px 80px 60px;">
              <span>Name / ID</span>
              <span>Vendor</span>
              <span>Category</span>
              <span>Type</span>
              <span>Status</span>
            </div>
            <div class="divide-y">
              {#each filteredRegistry as cap}
                {@const isCatalog = cap.type === 'catalog'}
                <div
                  class="grid items-center gap-3 px-2 py-2.5 text-sm
                    {isCatalog ? 'cursor-pointer hover:bg-muted/40 transition-colors' : ''}"
                  style="grid-template-columns: 1fr 100px 80px 80px 60px;"
                  onclick={isCatalog ? () => { activeTab = cap.catalogStatus as Tab; selectedId = cap.id; } : undefined}
                  role={isCatalog ? 'button' : undefined}
                  tabindex={isCatalog ? 0 : undefined}
                >
                  <div class="min-w-0">
                    <p class="font-medium truncate">{cap.name}</p>
                    <p class="font-mono text-xs text-muted-foreground truncate">{cap.id}</p>
                  </div>
                  <span class="font-mono text-xs text-muted-foreground truncate">{cap.vendor}</span>
                  <span class="text-xs text-muted-foreground">{cap.category ?? '—'}</span>
                  <span>
                    {#if isCatalog}
                      <Badge variant="secondary" class="text-xs">catalog</Badge>
                    {:else}
                      <Badge variant="outline" class="text-xs">code</Badge>
                    {/if}
                  </span>
                  <Badge variant={badgeVariant(cap.catalogStatus as LifecycleStatus)} class="text-xs w-fit">
                    {cap.catalogStatus ?? 'live'}
                  </Badge>
                </div>
              {/each}
              {#if filteredRegistry.length === 0}
                <p class="py-6 text-center text-sm text-muted-foreground">
                  {registrySearch.trim() ? 'No capabilities match your search.' : 'No capabilities registered yet.'}
                </p>
              {/if}
            </div>
          </SectionPanel>
        {/if}
      </div>

    <!-- ── CANDIDATE TABS ──────────────────────────────────────────────────── -->
    {:else}
      <!-- Candidate list -->
      <div class="w-72 shrink-0 flex flex-col border-r overflow-hidden">
        <!-- Search -->
        <div class="p-2 border-b">
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              bind:value={candidateSearch}
              placeholder="Search candidates…"
              class="pl-8 h-8 text-sm"
            />
            {#if candidateSearch}
              <button onclick={() => candidateSearch = ''} class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X class="size-3.5" />
              </button>
            {/if}
          </div>
        </div>

        <div class="flex-1 overflow-auto divide-y">
          {#if candidatesQuery.isPending}
            <div class="p-4"><Loader /></div>
          {:else if filteredCandidates.length === 0}
            <p class="p-4 text-sm text-muted-foreground">
              {candidateSearch ? 'No matches.' : `No ${activeTab} candidates.`}
            </p>
          {:else}
            {#each filteredCandidates as c}
              <button
                onclick={() => { selectedId = c.id; editingJson = false; showScaffold = false; }}
                class="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors
                  {selectedId === c.id ? 'bg-muted' : ''}"
              >
                <p class="text-sm font-medium truncate">{c.name}</p>
                <p class="font-mono text-xs text-muted-foreground truncate">{c.id}</p>
                <div class="flex gap-1.5 mt-1.5">
                  <Badge variant={badgeVariant(c.lifecycleStatus as LifecycleStatus)} class="text-xs">{c.lifecycleStatus}</Badge>
                  <Badge variant="outline" class="text-xs font-mono">{c.vendor}</Badge>
                </div>
              </button>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Detail panel -->
      <div class="flex-1 overflow-auto p-6">
        {#if !selectedId}
          <div class="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <p class="text-sm">Select a candidate to review its details, run a smoke test, or generate a scaffold.</p>
          </div>
        {:else if selectedQuery.isPending}
          <Loader />
        {:else if selectedQuery.data}
          {@const c = selectedQuery.data}
          <div class="space-y-4 max-w-2xl">

            <!-- Header row -->
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="text-base font-semibold">{c.name}</h2>
                <p class="font-mono text-xs text-muted-foreground mt-0.5">{c.id}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Badge variant={badgeVariant(c.lifecycleStatus as LifecycleStatus)}>{c.lifecycleStatus}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Download candidate JSON"
                  onclick={() => download(`${c.id}.candidate.json`, JSON.stringify(c, null, 2))}
                >
                  <Download class="size-3.5" />
                </Button>
              </div>
            </div>

            {#if c.description}
              <p class="text-sm text-muted-foreground">{c.description}</p>
            {/if}

            <!-- Metadata -->
            <SectionPanel title="Metadata" code="META">
              {#if editingMeta}
                <div class="space-y-3">
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <Label class="text-xs">Name</Label>
                      <Input bind:value={metaName} placeholder="Capability name" class="mt-1 h-8 text-sm" />
                    </div>
                    <div>
                      <Label class="text-xs">Category</Label>
                      <Input bind:value={metaCategory} placeholder="e.g. identity, device" class="mt-1 h-8 text-sm" />
                    </div>
                    <div>
                      <Label class="text-xs">Vendor</Label>
                      <Input bind:value={metaVendor} placeholder="Vendor display name" class="mt-1 h-8 text-sm" />
                    </div>
                    <div>
                      <Label class="text-xs">Connection</Label>
                      <p class="mt-1.5 text-xs font-mono text-muted-foreground">{(c.integration as Record<string, string>)?.connection ?? '—'} <span class="text-muted-foreground/60">(from operation spec)</span></p>
                    </div>
                  </div>
                  <div>
                    <Label class="text-xs">Description</Label>
                    <Textarea bind:value={metaDescription} placeholder="What does this capability do?" rows={2} class="mt-1 text-sm" />
                  </div>
                  <div>
                    <Label class="text-xs">Notes <span class="font-normal text-muted-foreground">(internal, not shown to operators)</span></Label>
                    <Textarea bind:value={metaNotes} placeholder="Review notes, caveats, known issues…" rows={2} class="mt-1 text-sm" />
                  </div>
                  <div class="flex gap-2">
                    <Button size="sm" disabled={updateMetaMutation.isPending} onclick={() => updateMetaMutation.mutate(c)}>
                      {updateMetaMutation.isPending ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="outline" onclick={() => { editingMeta = false; initMeta(c); }}>Cancel</Button>
                  </div>
                </div>
              {:else}
                <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt class="text-muted-foreground">Vendor</dt>
                  <dd class="font-mono text-xs">{c.vendor}</dd>
                  <dt class="text-muted-foreground">Category</dt>
                  <dd>{c.category ?? '—'}</dd>
                  <dt class="text-muted-foreground">Connection</dt>
                  <dd class="font-mono text-xs">{(c.integration as Record<string, string>)?.connection ?? '—'}</dd>
                  {#if c.sourceUrl}
                    <dt class="text-muted-foreground">Source</dt>
                    <dd class="truncate font-mono text-xs">{c.sourceUrl}</dd>
                  {/if}
                  {#if c.approvedAt}
                    <dt class="text-muted-foreground">Approved</dt>
                    <dd>{new Date(c.approvedAt).toLocaleDateString()}</dd>
                  {/if}
                  {#if c.liveAt}
                    <dt class="text-muted-foreground">Live since</dt>
                    <dd>{new Date(c.liveAt).toLocaleDateString()}</dd>
                  {/if}
                  {#if c.notes}
                    <dt class="text-muted-foreground">Notes</dt>
                    <dd class="text-xs text-muted-foreground col-span-2 whitespace-pre-wrap">{c.notes}</dd>
                  {/if}
                </dl>
                <Button size="sm" variant="outline" class="mt-3" onclick={() => { initMeta(c); editingMeta = true; }}>Edit metadata</Button>
              {/if}
            </SectionPanel>

            <!-- Operation summary -->
            <SectionPanel title="Operation" code="OP">
              {@const op = c.operation as Record<string, unknown>}
              <div class="flex items-center gap-2 mb-2">
                <span class="font-mono text-xs px-1.5 py-0.5 rounded border font-semibold
                  {METHOD_COLORS[(op.method as string) ?? ''] ?? 'text-foreground bg-muted border-border'}">
                  {op.method}
                </span>
                <code class="font-mono text-sm">{op.path}</code>
              </div>
              <p class="text-xs text-muted-foreground mb-3">Operation ID: <code class="font-mono">{op.operationId}</code></p>
              <details class="text-xs">
                <summary class="cursor-pointer text-muted-foreground hover:text-foreground select-none">Full JSON</summary>
                <pre class="mt-2 overflow-auto rounded bg-muted px-3 py-2 max-h-40">{JSON.stringify(op, null, 2)}</pre>
              </details>
            </SectionPanel>

            <!-- JSON editor -->
            <SectionPanel title="Candidate JSON" code="JSON">
              {#if editingJson}
                <Textarea bind:value={editJson} rows={18} class="font-mono text-xs" />
                <div class="flex gap-2 mt-2">
                  <Button size="sm" disabled={upsertMutation.isPending} onclick={() => upsertMutation.mutate(editJson)}>
                    {upsertMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="outline" onclick={() => editingJson = false}>Cancel</Button>
                </div>
              {:else}
                <div class="flex gap-2">
                  <Button size="sm" variant="outline" onclick={() => startEdit(c as Record<string, unknown>)}>Edit JSON</Button>
                  <Button size="sm" variant="ghost" onclick={() => copy(JSON.stringify(c, null, 2), 'JSON copied')}>
                    <Copy class="mr-1.5 size-3.5" />Copy
                  </Button>
                </div>
              {/if}
            </SectionPanel>

            <!-- Inputs editor -->
            <SectionPanel title="Inputs" code="IN">
              {@const op = c.operation as { method?: string; path?: string; body?: { input?: string } }}

              <!-- Body passthrough banner -->
              {#if bodyPassthroughKey()}
                <div class="rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 mb-4 text-xs">
                  <p class="font-medium text-amber-700 dark:text-amber-400">Body passthrough active</p>
                  <p class="text-amber-600 dark:text-amber-500 mt-0.5">
                    The entire request body is taken from one <code class="font-mono">"{bodyPassthroughKey()}"</code> input as a raw JSON object.
                    Add individual body fields below — saving will switch to structured mode automatically.
                  </p>
                </div>
              {/if}

              <!-- Path hint -->
              {#if op.path}
                {@const pathParams = [...(op.path.matchAll(/\{([^}]+)\}/g))].map(m => m[1])}
                {#if pathParams.length > 0}
                  <p class="text-xs text-muted-foreground mb-3">
                    Path params required: {pathParams.map(p => `{${p}}`).join(', ')}
                  </p>
                {/if}
              {/if}

              {#if inputRows.length > 0}
                <div class="grid gap-1 mb-1 px-0 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                  style="grid-template-columns: 1fr 110px 1fr 80px 40px 28px;">
                  <span>Input key</span>
                  <span>Location</span>
                  <span>API field name</span>
                  <span>Type</span>
                  <span>Req'd</span>
                  <span></span>
                </div>
                <div class="space-y-1.5 mb-3">
                  {#each inputRows as row, i}
                    <div class="space-y-1">
                      <div class="grid items-center gap-1.5 text-xs" style="grid-template-columns: 1fr 110px 1fr 80px 40px 28px;">
                        <!-- Key -->
                        <Input
                          value={row.key}
                          oninput={(e) => { inputRows[i] = { ...row, key: (e.target as HTMLInputElement).value }; }}
                          placeholder="inputKey"
                          class="h-7 text-xs font-mono"
                        />
                        <!-- Location -->
                        <div class="flex rounded border overflow-hidden shrink-0">
                          {#each INPUT_LOCATIONS as loc}
                            <button
                              onclick={() => { inputRows[i] = { ...row, location: loc.value }; }}
                              class="flex-1 px-1 py-1 text-xs transition-colors
                                {row.location === loc.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                            >{loc.label}</button>
                          {/each}
                        </div>
                        <!-- API field name -->
                        <Input
                          value={row.apiFieldName}
                          oninput={(e) => { inputRows[i] = { ...row, apiFieldName: (e.target as HTMLInputElement).value }; }}
                          placeholder={row.key || 'fieldName'}
                          class="h-7 text-xs font-mono"
                        />
                        <!-- Type -->
                        <SingleSelect
                          selected={row.valueType}
                          options={INPUT_VALUE_TYPES}
                          onchange={(v) => { inputRows[i] = { ...row, valueType: v, entityType: v.startsWith('entity:') ? v.slice('entity:'.length) : undefined }; }}
                        />
                        <!-- Required toggle -->
                        <button
                          onclick={() => { inputRows[i] = { ...row, required: !row.required }; }}
                          class="rounded border px-1.5 py-1 text-xs transition-colors
                            {row.required ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted'}"
                        >{row.required ? 'yes' : 'no'}</button>
                        <!-- Remove -->
                        <button
                          onclick={() => { inputRows = inputRows.filter((_, j) => j !== i); }}
                          class="p-1 text-muted-foreground hover:text-destructive"
                        ><X class="size-3" /></button>
                      </div>
                      <!-- Label + description sub-row -->
                      <div class="grid gap-1.5" style="grid-template-columns: 1fr 1fr; padding-left: 0;">
                        <Input
                          value={row.label}
                          oninput={(e) => { inputRows[i] = { ...row, label: (e.target as HTMLInputElement).value }; }}
                          placeholder="Display label"
                          class="h-7 text-xs"
                        />
                        <Input
                          value={row.description}
                          oninput={(e) => { inputRows[i] = { ...row, description: (e.target as HTMLInputElement).value }; }}
                          placeholder="Description (optional)"
                          class="h-7 text-xs"
                        />
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="text-xs text-muted-foreground mb-3">No inputs defined. Add path or body fields below.</p>
              {/if}

              <!-- Body field picker from spec -->
              {#if showBodyFieldPicker}
                <div class="rounded border bg-muted/20 p-3 mb-3 space-y-2">
                  <div class="flex items-center justify-between">
                    <p class="text-xs font-medium">Body fields from spec</p>
                    <button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => { showBodyFieldPicker = false; selectedBodyFields = new Set(); }}>✕</button>
                  </div>
                  {#if bodyFieldsQuery.isPending}
                    <p class="text-xs text-muted-foreground">Fetching spec…</p>
                  {:else if bodyFieldsQuery.isError}
                    <p class="text-xs text-destructive">{bodyFieldsQuery.error?.message ?? 'Failed to fetch spec'}</p>
                  {:else if (bodyFieldsQuery.data?.fields ?? []).length === 0}
                    <p class="text-xs text-muted-foreground">No body schema properties found in spec.</p>
                  {:else}
                    {@const fields = bodyFieldsQuery.data?.fields ?? []}
                    {@const existingKeys = new Set(inputRows.map(r => r.key))}
                    <div class="max-h-52 overflow-y-auto space-y-0.5 rounded border bg-background px-2 py-1">
                      {#each fields as field}
                        {@const already = existingKeys.has(field.name)}
                        <label class="flex items-center gap-2 py-1 cursor-pointer {already ? 'opacity-40' : 'hover:bg-muted/50'} rounded px-1">
                          <input
                            type="checkbox"
                            disabled={already}
                            checked={selectedBodyFields.has(field.name)}
                            onchange={() => {
                              const next = new Set(selectedBodyFields);
                              if (next.has(field.name)) next.delete(field.name); else next.add(field.name);
                              selectedBodyFields = next;
                            }}
                            class="shrink-0"
                          />
                          <span class="font-mono text-xs">{field.name}</span>
                          <span class="text-xs text-muted-foreground truncate">{field.description ?? ''}</span>
                          <span class="ml-auto text-xs text-muted-foreground/60 shrink-0">{field.valueType}</span>
                        </label>
                      {/each}
                    </div>
                    <div class="flex items-center justify-between">
                      <div class="flex gap-3 text-xs">
                        <button onclick={() => { selectedBodyFields = new Set(fields.filter(f => !existingKeys.has(f.name)).map(f => f.name)); }} class="text-primary hover:underline">Select all</button>
                        <button onclick={() => { selectedBodyFields = new Set(); }} class="text-muted-foreground hover:text-foreground">Clear</button>
                      </div>
                      <Button
                        size="sm"
                        disabled={selectedBodyFields.size === 0}
                        onclick={addSelectedBodyFields}
                      >
                        Add {selectedBodyFields.size} field{selectedBodyFields.size === 1 ? '' : 's'}
                      </Button>
                    </div>
                  {/if}
                </div>
              {/if}

              <div class="flex items-center gap-3 flex-wrap">
                <button
                  onclick={() => { inputRows = [...inputRows, { key: '', label: '', description: '', required: false, valueType: 'text', location: 'body', apiFieldName: '' }]; }}
                  class="text-xs text-primary hover:underline"
                >+ Add body field</button>
                {#if c.sourceUrl}
                  <button
                    onclick={() => { showBodyFieldPicker = !showBodyFieldPicker; selectedBodyFields = new Set(); }}
                    class="text-xs text-muted-foreground hover:text-foreground"
                  >Browse spec fields</button>
                {/if}
                <button
                  onclick={() => { inputRows = [...inputRows, { key: '', label: '', description: '', required: false, valueType: 'text', location: 'query', apiFieldName: '' }]; }}
                  class="text-xs text-muted-foreground hover:text-foreground"
                >+ Add query param</button>
                <Button
                  size="sm"
                  class="ml-auto"
                  disabled={saveInputsMutation.isPending}
                  onclick={() => saveInputsMutation.mutate(c)}
                >
                  {saveInputsMutation.isPending ? 'Saving…' : 'Save inputs'}
                </Button>
              </div>
            </SectionPanel>

            <!-- DB sync / write-back -->
            <SectionPanel title="DB sync" code="SYNC">
              {@const integrationId = (c.integration as { integrationId?: string })?.integrationId ?? ''}
              {@const integrationTables = Object.fromEntries(
                Object.entries(WRITE_BACK_ALLOWED_TABLES).filter(([, t]) => t.integration === integrationId)
              )}
              {@const tableSchema = integrationTables[wbTable]}

              <!-- Effect selector -->
              <div class="mb-4">
                <p class="text-xs text-muted-foreground mb-2">What does this operation do to local data?</p>
                <div class="flex gap-2 flex-wrap">
                  {#each [
                    { value: 'none'   as WbEffect, label: 'No sync',    hint: 'Read-only or audit-only' },
                    { value: 'patch'  as WbEffect, label: 'Patch row',  hint: 'Update fields on an existing row' },
                    { value: 'insert' as WbEffect, label: 'Insert row', hint: 'Create a new row' },
                    { value: 'delete' as WbEffect, label: 'Delete row', hint: 'Remove a row' },
                  ] as opt}
                    <button
                      onclick={() => wbEffect = opt.value}
                      class="flex-1 min-w-28 rounded border px-3 py-2 text-left text-xs transition-colors
                        {wbEffect === opt.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-input hover:bg-muted/50 text-muted-foreground'}"
                    >
                      <p class="font-semibold">{opt.label}</p>
                      <p class="mt-0.5 {wbEffect === opt.value ? 'text-primary/70' : 'text-muted-foreground'}">{opt.hint}</p>
                    </button>
                  {/each}
                </div>
              </div>

              {#if wbEffect !== 'none'}
                <!-- Table picker -->
                <div class="mb-4">
                  <Label class="text-xs">Target table</Label>
                  {#if !Object.keys(integrationTables).length}
                    <p class="text-xs text-amber-600 mt-1">
                      No writable tables configured for integration <code class="font-mono">{integrationId || '(unknown)'}</code>.
                      Add entries to <code class="font-mono">WRITE_BACK_ALLOWED_TABLES</code> in <code class="font-mono">packages/shared/src/config/write-back-tables.ts</code>.
                    </p>
                  {:else}
                    <SingleSelect
                      class="mt-1"
                      selected={wbTable || undefined}
                      placeholder="Select a table…"
                      options={Object.entries(integrationTables).map(([key, schema]) => ({ value: key, label: schema.label }))}
                      onchange={(v) => {
                        wbTable = v;
                        if (wbMappings.length === 0 && inputRowKeys.length > 0) {
                          wbMappings = autoSuggestMappings(integrationTables, v, inputRowKeys);
                        }
                      }}
                    />
                  {/if}
                </div>

                {#if wbTable && tableSchema}
                  <!-- Row key -->
                  <div class="mb-4">
                    <Label class="text-xs">Lookup key — which column identifies the row to update</Label>
                    <p class="text-xs text-muted-foreground mt-0.5 mb-1.5">Usually: input <code class="font-mono">user-id</code> → column <code class="font-mono">external_id</code></p>
                    <div class="mt-1.5 space-y-2">
                      <div class="flex items-center gap-2 text-xs">
                        <span class="text-muted-foreground shrink-0 w-16">Source</span>
                        <div class="flex rounded border overflow-hidden text-xs">
                          {#each [{ v: 'inputs', l: 'inputs' }, { v: 'response', l: 'response' }] as src}
                            <button
                              onclick={() => wbKeySource = src.v as WbSource}
                              class="px-2 py-1 transition-colors
                                {wbKeySource === src.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                            >{src.l}</button>
                          {/each}
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-muted-foreground shrink-0 w-16">Field</span>
                        {#if wbKeySource === 'inputs'}
                          <SingleSelect
                            class="flex-1"
                            selected={wbKeyField || undefined}
                            placeholder="Input field…"
                            options={inputRowKeys.map((k) => ({ value: k, label: k }))}
                            onchange={(v) => { wbKeyField = v; }}
                          />
                        {:else}
                          <Input bind:value={wbKeyField} placeholder="response.id" class="h-8 text-xs font-mono flex-1" />
                        {/if}
                        <span class="text-muted-foreground px-1 shrink-0">→</span>
                        <SingleSelect
                          class="flex-1"
                          selected={wbKeyColumn || undefined}
                          placeholder="DB column…"
                          options={(tableSchema?.allowedKeyColumns ?? []).map((col) => ({
                            value: col,
                            label: col,
                            subLabel: col === 'external_id' ? 'vendor ID (recommended)' : col === 'id' ? 'internal UUID' : undefined,
                          }))}
                          onchange={(v) => { wbKeyColumn = v; }}
                        />
                      </div>
                    </div>
                  </div>

                  <!-- Field mappings (not for delete) -->
                  {#if wbEffect !== 'delete'}
                    <div class="mb-4">
                      <div class="flex items-center justify-between mb-1.5">
                        <Label class="text-xs">Field mappings — which columns get updated on success</Label>
                        <button
                          onclick={() => { wbMappings = autoSuggestMappings(integrationTables, wbTable, inputRowKeys); }}
                          class="text-xs text-primary hover:underline"
                        >Auto-suggest</button>
                      </div>

                      {#if inputRowKeys.length === 0 && wbMappings.length === 0}
                        <p class="text-xs text-amber-600 mb-2">Add body field inputs first, then auto-suggest will map them to DB columns.</p>
                      {/if}

                      {#if wbMappings.length > 0}
                        <div class="space-y-1.5 mb-2">
                          {#each wbMappings as mapping, i}
                            <div class="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-1.5 text-xs">
                              <!-- Source toggle -->
                              <div class="flex rounded border overflow-hidden shrink-0">
                                {#each [{ v: 'inputs', l: 'inp' }, { v: 'response', l: 'resp' }] as src}
                                  <button
                                    title={src.v}
                                    onclick={() => { wbMappings[i] = { ...mapping, source: src.v as WbSource }; }}
                                    class="px-2 py-0.5 transition-colors text-xs
                                      {mapping.source === src.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                                  >{src.l}</button>
                                {/each}
                              </div>
                              <!-- Field -->
                              {#if mapping.source === 'inputs'}
                                <SingleSelect
                                  selected={mapping.field || undefined}
                                  placeholder="Input field…"
                                  options={inputRowKeys.map((k) => ({ value: k, label: k }))}
                                  onchange={(v) => { wbMappings[i] = { ...mapping, field: v }; }}
                                />
                              {:else}
                                <Input
                                  value={mapping.field}
                                  oninput={(e) => { wbMappings[i] = { ...mapping, field: (e.target as HTMLInputElement).value }; }}
                                  placeholder="response.field"
                                  class="h-7 text-xs font-mono"
                                />
                              {/if}
                              <span class="text-muted-foreground">→</span>
                              <!-- Column -->
                              <SingleSelect
                                selected={mapping.column || undefined}
                                placeholder="DB column…"
                                options={tableSchema.columns.map((col) => ({ value: col.name, label: col.name, subLabel: col.label }))}
                                onchange={(v) => { wbMappings[i] = { ...mapping, column: v }; }}
                              />
                              <!-- Remove -->
                              <button
                                onclick={() => { wbMappings = wbMappings.filter((_, j) => j !== i); }}
                                class="p-1 text-muted-foreground hover:text-destructive"
                              ><X class="size-3" /></button>
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <p class="text-xs text-muted-foreground mb-2">No mappings yet — click Auto-suggest or add manually.</p>
                      {/if}

                      <button
                        onclick={() => { wbMappings = [...wbMappings, { field: '', column: '', source: 'inputs' }]; }}
                        class="text-xs text-primary hover:underline"
                      >+ Add mapping</button>

                      {#if wbMappings.length > 0}
                        <div class="mt-3 rounded border border-dashed border-muted-foreground/30 bg-muted/20 p-2.5 text-xs text-muted-foreground">
                          <span class="font-medium text-foreground">{wbMappings.filter(m => m.field && m.column).length} field{wbMappings.filter(m => m.field && m.column).length === 1 ? '' : 's'} sync immediately</span>
                          {#if inputRowKeys.length > wbMappings.length}
                            · {inputRowKeys.filter(k => !wbMappings.some(m => m.field === k)).length} others update at next ingestion
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                {/if}

                <Button
                  size="sm"
                  disabled={saveWriteBackMutation.isPending || !wbTable || !wbKeyField || !wbKeyColumn}
                  onclick={() => saveWriteBackMutation.mutate(c)}
                >
                  {saveWriteBackMutation.isPending ? 'Saving…' : 'Save sync config'}
                </Button>
              {:else}
                <p class="text-xs text-muted-foreground">This operation will not write to the local vendor DB.</p>
              {/if}
            </SectionPanel>

            <!-- Output field builder -->
            <SectionPanel title="Outputs" code="OUT">
              <p class="text-xs text-muted-foreground mb-3">
                Define named output fields that downstream package steps bind to.
                <code class="font-mono">data</code> and <code class="font-mono">status</code> are always available as raw fallbacks.
              </p>

              {#if outFields.length > 0}
                <!-- Header row -->
                <div class="grid gap-1.5 px-0 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1"
                  style="grid-template-columns: 1fr 90px 1fr 70px auto;">
                  <span>Key</span>
                  <span>Source</span>
                  <span>Path / Input</span>
                  <span>Type</span>
                  <span></span>
                </div>
                <div class="space-y-1.5 mb-3">
                  {#each outFields as field, i}
                    <div class="grid items-center gap-1.5 text-xs" style="grid-template-columns: 1fr 90px 1fr 70px auto;">
                      <!-- Key -->
                      <Input
                        value={field.key}
                        oninput={(e) => { outFields[i] = { ...field, key: (e.target as HTMLInputElement).value }; }}
                        placeholder="outputKey"
                        class="h-7 text-xs font-mono"
                      />
                      <!-- Source toggle -->
                      <div class="flex rounded border overflow-hidden shrink-0">
                        {#each (['response', 'input'] as OutFieldSource[]) as src}
                          <button
                            onclick={() => { outFields[i] = { ...field, source: src }; }}
                            class="flex-1 px-2 py-1 text-xs transition-colors
                              {field.source === src ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
                          >{src === 'response' ? 'resp' : 'input'}</button>
                        {/each}
                      </div>
                      <!-- Path or input key -->
                      {#if field.source === 'response'}
                        <Input
                          value={field.path}
                          oninput={(e) => { outFields[i] = { ...field, path: (e.target as HTMLInputElement).value }; }}
                          placeholder="response.id"
                          class="h-7 text-xs font-mono"
                        />
                      {:else}
                        <SingleSelect
                          selected={field.inputKey || undefined}
                          placeholder="Input field…"
                          options={inputRowKeys.map((k) => ({ value: k, label: k }))}
                          onchange={(v) => { outFields[i] = { ...field, inputKey: v }; }}
                        />
                      {/if}
                      <!-- Type -->
                      <SingleSelect
                        selected={field.valueType}
                        options={VALUE_TYPES}
                        onchange={(v) => { outFields[i] = { ...field, valueType: v }; }}
                      />
                      <!-- Remove -->
                      <button
                        onclick={() => { outFields = outFields.filter((_, j) => j !== i); }}
                        class="p-1 text-muted-foreground hover:text-destructive"
                      ><X class="size-3" /></button>
                    </div>
                    <!-- Label + description row (collapsed under the grid row) -->
                    <div class="grid gap-1.5 mb-1" style="grid-template-columns: 1fr 1fr;">
                      <Input
                        value={field.label}
                        oninput={(e) => { outFields[i] = { ...field, label: (e.target as HTMLInputElement).value }; }}
                        placeholder="Display label"
                        class="h-7 text-xs"
                      />
                      <Input
                        value={field.description}
                        oninput={(e) => { outFields[i] = { ...field, description: (e.target as HTMLInputElement).value }; }}
                        placeholder="Description (optional)"
                        class="h-7 text-xs"
                      />
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="text-xs text-muted-foreground mb-3">No named outputs defined — click Auto-suggest or add manually.</p>
              {/if}

              {#if outFieldDuplicateKeys().size > 0}
                <p class="text-xs text-destructive mb-2">
                  Duplicate output keys: {[...outFieldDuplicateKeys()].join(', ')} — each key must be unique.
                </p>
              {/if}

              <div class="flex items-center gap-3 flex-wrap">
                <button
                  onclick={() => autoSuggestOutputs(c)}
                  class="text-xs text-primary hover:underline"
                >Auto-suggest</button>
                <button
                  onclick={() => { outFields = [...outFields, { key: '', label: '', description: '', valueType: 'text', source: 'response', path: '', inputKey: '', sensitive: false }]; }}
                  class="text-xs text-primary hover:underline"
                >+ Add field</button>
                <Button
                  size="sm"
                  class="ml-auto"
                  disabled={saveOutputsMutation.isPending || outFieldDuplicateKeys().size > 0}
                  onclick={() => saveOutputsMutation.mutate(c)}
                >
                  {saveOutputsMutation.isPending ? 'Saving…' : 'Save outputs'}
                </Button>
              </div>
            </SectionPanel>

            <!-- Smoke tests / E2E test runner -->
            <SectionPanel title="Tests" code="TEST">
              {@const inputMeta = (c.inputMeta ?? {}) as Record<string, { label?: string; description?: string; required?: boolean; valueType?: string }>}
              {@const connectionType = (c.integration as { connection?: string })?.connection ?? 'activeLink'}

              <!-- Previous recorded tests -->
              {#if smokeTestsQuery.data && smokeTestsQuery.data.length > 0}
                <div class="space-y-2 mb-4">
                  {#each smokeTestsQuery.data as st}
                    <div class="rounded border p-2.5 text-xs space-y-0.5">
                      <p class="font-medium font-mono">{st.evidence}</p>
                      {#if st.notes}<p class="text-muted-foreground">{st.notes}</p>{/if}
                      <p class="text-muted-foreground">{new Date(st.testedAt).toLocaleString()}</p>
                    </div>
                  {/each}
                </div>
              {:else if smokeTestsQuery.data}
                <p class="text-xs text-muted-foreground mb-4">No tests recorded yet.</p>
              {/if}

              {#if true}
                <!-- In-app E2E test runner — available for all lifecycle states -->
                {#if !showTestRunner}
                  <div class="flex gap-2">
                    <Button variant="outline" size="sm" onclick={() => { showTestRunner = true; }}>
                      Run E2E test
                    </Button>
                    <Button variant="ghost" size="sm" onclick={() => { smokeEvidence = `${(c.operation as { method?: string }).method ?? 'PATCH'} ${(c.operation as { path?: string }).path ?? ''} → `; showSmokeDialog = true; }}>
                      Record manually
                    </Button>
                  </div>
                {:else}
                  <div class="rounded border bg-muted/20 p-4 space-y-3">
                    <div class="flex items-center justify-between">
                      <p class="text-xs font-medium">E2E test — {c.name}</p>
                      <button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => { showTestRunner = false; activeTestRunId = null; }}>✕ Close</button>
                    </div>

                    {#if !activeTestRunId}
                      <!-- Input form -->
                      {#if connectionType === 'activeLink'}
                        <div>
                          <Label class="text-xs">Integration link (tenant)</Label>
                          <SingleSelect
                            class="mt-1"
                            selected={testLinkId ?? undefined}
                            placeholder="Select a tenant link…"
                            loading={testLinksQuery.isPending}
                            options={(testLinksQuery.data ?? []).map((l) => ({
                              value: l.id,
                              label: l.name ?? l.id,
                              subLabel: l.status ?? undefined,
                            }))}
                            onchange={(v) => { testLinkId = v; }}
                          />
                        </div>
                      {/if}

                      {#if Object.keys(inputMeta).length > 0}
                        <div class="space-y-2">
                          <Label class="text-xs">Inputs</Label>
                          {#each Object.entries(inputMeta) as [key, meta]}
                            <div>
                              <Label class="text-xs font-normal text-muted-foreground">
                                {meta.label ?? key}{meta.required ? ' *' : ''}
                              </Label>
                              <Input
                                value={testInputs[key] ?? ''}
                                oninput={(e) => { testInputs = { ...testInputs, [key]: (e.target as HTMLInputElement).value }; }}
                                placeholder={meta.valueType ?? 'text'}
                                class="mt-0.5 h-7 text-xs font-mono"
                              />
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <p class="text-xs text-muted-foreground">This capability has no inputs.</p>
                      {/if}

                      <Button
                        size="sm"
                        disabled={runTestMutation.isPending || (connectionType === 'activeLink' && !testLinkId)}
                        onclick={() => runTestMutation.mutate({
                          candidateId: c.id,
                          linkId: testLinkId,
                          inputs: Object.fromEntries(Object.entries(testInputs).filter(([, v]) => v !== '')),
                        })}
                      >
                        {runTestMutation.isPending ? 'Starting…' : 'Run test'}
                      </Button>
                    {:else}
                      <!-- Polling result -->
                      {@const tr = testResultQuery.data}
                      <div class="space-y-2">
                        <div class="flex items-center gap-2">
                          <div class="size-2 rounded-full
                            {tr?.status === 'completed' ? 'bg-green-500' :
                             tr?.status === 'failed' ? 'bg-destructive' :
                             'bg-amber-400 animate-pulse'}">
                          </div>
                          <span class="text-xs font-medium capitalize">{tr?.status ?? 'waiting…'}</span>
                          {#if tr?.step?.finishedAt}
                            <span class="text-xs text-muted-foreground ml-auto">{new Date(tr.step.finishedAt).toLocaleTimeString()}</span>
                          {/if}
                        </div>

                        {#if tr?.step?.status === 'success'}
                          <div>
                            <p class="text-xs font-medium text-green-600 mb-1">Success</p>
                            <pre class="text-xs font-mono bg-muted rounded px-3 py-2 overflow-x-auto max-h-48">{JSON.stringify(tr.step.outputs, null, 2)}</pre>
                          </div>
                          <div class="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onclick={() => {
                                smokeEvidence = `${(c.operation as {method?:string}).method} ${(c.operation as {path?:string}).path} → ${tr.step!.status} (HTTP ${(tr.step!.outputs as Record<string,unknown>)?.status ?? '?'})`;
                                showSmokeDialog = true;
                              }}
                            >Record as passed</Button>
                            <Button size="sm" variant="ghost" onclick={() => { activeTestRunId = null; }}>Run again</Button>
                          </div>
                        {:else if tr?.step?.status === 'fail'}
                          <div>
                            <p class="text-xs font-medium text-destructive mb-1">{tr.step.errorClass ?? 'Error'}</p>
                            <p class="text-xs text-muted-foreground">{tr.step.errorMessage}</p>
                          </div>
                          <div class="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onclick={() => {
                                smokeEvidence = `FAIL ${(c.operation as {method?:string}).method} ${(c.operation as {path?:string}).path}: ${tr.step!.errorClass}`;
                                smokeNotes = tr.step!.errorMessage ?? '';
                                showSmokeDialog = true;
                              }}
                            >Record failure</Button>
                            <Button size="sm" variant="ghost" onclick={() => { activeTestRunId = null; }}>Retry</Button>
                          </div>
                        {:else if !tr || tr.status === 'pending' || tr.status === 'queued' || tr.status === 'running'}
                          <p class="text-xs text-muted-foreground">Worker is executing the step… polling every 2 s.</p>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
              {/if}
            </SectionPanel>

            <!-- Scaffold (only on generated/approved) -->
            {#if c.lifecycleStatus === 'approved' || c.lifecycleStatus === 'generated'}
              <SectionPanel title="TypeScript scaffold" code="BUILD">
                {#if showScaffold}
                  <p class="text-xs text-muted-foreground mb-2">
                    Save as <code class="font-mono">{scaffoldFile}</code> and fill in the TODOs.
                  </p>
                  <pre class="text-xs overflow-auto rounded bg-muted px-3 py-2 max-h-64 mb-3">{scaffoldContent}</pre>
                  <div class="flex gap-2">
                    <Button size="sm" variant="outline" onclick={() => copy(scaffoldContent, 'Scaffold copied')}>
                      <Copy class="mr-1.5 size-3.5" />Copy
                    </Button>
                    <Button size="sm" variant="outline" onclick={() => download(scaffoldFile, scaffoldContent)}>
                      <Download class="mr-1.5 size-3.5" />Download
                    </Button>
                    <Button size="sm" variant="ghost" onclick={() => showScaffold = false}>Dismiss</Button>
                  </div>
                {:else}
                  <p class="text-sm text-muted-foreground mb-3">
                    Generate a TypeScript stub with the manifest pre-filled and handler TODOs.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={scaffoldMutation.isPending}
                    onclick={() => scaffoldMutation.mutate(c.id)}
                  >
                    {scaffoldMutation.isPending ? 'Generating…' : 'Generate scaffold'}
                  </Button>
                {/if}
              </SectionPanel>
            {/if}

            <!-- Lifecycle actions -->
            <SectionPanel title="Lifecycle" code="LC">
              <div class="flex flex-wrap gap-2">
                {#if c.lifecycleStatus === 'generated'}
                  <Button size="sm" onclick={() => openStatus('approved')}>Approve</Button>
                  <Button size="sm" variant="destructive" onclick={() => openStatus('rejected')}>Reject</Button>
                {:else if c.lifecycleStatus === 'approved'}
                  <Button size="sm" onclick={() => openStatus('live')}>Mark live</Button>
                  <Button size="sm" variant="outline" onclick={() => openStatus('generated')}>Revert to generated</Button>
                  <Button size="sm" variant="destructive" onclick={() => openStatus('rejected')}>Reject</Button>
                {:else if c.lifecycleStatus === 'live'}
                  <Button size="sm" variant="outline" onclick={() => openStatus('approved')}>Move back to approved</Button>
                {:else if c.lifecycleStatus === 'rejected'}
                  <Button size="sm" variant="outline" onclick={() => openStatus('generated')}>Restore</Button>
                {/if}
                <Button
                  size="sm"
                  variant="ghost"
                  class="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                  onclick={() => showDeleteDialog = true}
                >
                  Delete candidate
                </Button>
              </div>
              {#if c.notes}
                <p class="text-xs text-muted-foreground mt-3 whitespace-pre-wrap border-t pt-3">{c.notes}</p>
              {/if}
            </SectionPanel>

          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- ── Guide sheet ──────────────────────────────────────────────────────────── -->
<Sheet.Root bind:open={showGuide}>
  <Sheet.Content side="right" class="w-[420px] sm:w-[480px]">
    <Sheet.Header>
      <Sheet.Title>Capability authoring guide</Sheet.Title>
      <Sheet.Description>Four phases from API spec to live capability.</Sheet.Description>
    </Sheet.Header>
    <ScrollArea class="h-[calc(100vh-120px)] pr-2 mt-4">
      <div class="space-y-6">
        {#each GUIDE_PHASES as phase, i}
          <div>
            <div class="flex items-center gap-2 mb-3">
              <div class="size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</div>
              <h3 class="font-semibold text-sm">{phase.phase}</h3>
            </div>
            <ul class="space-y-1.5 ml-8">
              {#each phase.steps as step}
                <li class="flex items-start gap-2 text-sm text-muted-foreground">
                  <ChevronRight class="size-3.5 mt-0.5 shrink-0 text-muted-foreground/60" />
                  <span>{step}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}

        <div class="rounded border bg-muted/40 p-4 space-y-2">
          <p class="text-sm font-medium">Method colour key</p>
          <div class="flex flex-wrap gap-2">
            {#each Object.entries(METHOD_COLORS) as [method, cls]}
              <span class="font-mono text-xs px-1.5 py-0.5 rounded border font-semibold {cls}">{method}</span>
            {/each}
          </div>
        </div>

        <div class="rounded border bg-muted/40 p-4 space-y-2 text-sm">
          <p class="font-medium">Key rules</p>
          <ul class="space-y-1 text-xs text-muted-foreground">
            <li>• Every candidate needs at least one smoke test before approval.</li>
            <li>• Do not expose raw IDs — use entityType pickers in inputMeta.</li>
            <li>• Never put credential handling or DB access in a generated handler.</li>
            <li>• Dynamic (catalog-only) candidates can go live without TypeScript — the executor runs the manifest directly.</li>
            <li>• Code-backed capabilities must be in registry.ts with passing types before going live.</li>
          </ul>
        </div>
      </div>
    </ScrollArea>
  </Sheet.Content>
</Sheet.Root>

<!-- ── Smoke test dialog ────────────────────────────────────────────────────── -->
<Dialog.Root bind:open={showSmokeDialog}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Record test result</Dialog.Title>
      <Dialog.Description>Paste the HTTP status and any relevant response details from your test run.</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-3 py-2">
      <div>
        <Label>Result <span class="font-normal text-muted-foreground">(e.g. 200 OK, user updated)</span></Label>
        <Textarea bind:value={smokeEvidence} placeholder="PATCH /users/:id → 200 OK on Contoso test tenant" rows={2} class="mt-1 font-mono text-sm" />
      </div>
      <div>
        <Label>Notes <span class="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea bind:value={smokeNotes} placeholder="Fields verified, any caveats or surprises…" rows={2} class="mt-1" />
      </div>
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => showSmokeDialog = false}>Cancel</Button>
      <Button
        disabled={!smokeEvidence.trim() || addSmokeTest.isPending}
        onclick={() => addSmokeTest.mutate({ candidateId: selectedId!, evidence: smokeEvidence.trim(), notes: smokeNotes.trim() || undefined })}
      >
        Save test
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- ── Delete dialog ─────────────────────────────────────────────────────────── -->
<Dialog.Root bind:open={showDeleteDialog}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Delete candidate?</Dialog.Title>
      <Dialog.Description>
        This permanently removes the candidate and all its smoke tests from the catalog. This cannot be undone.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => showDeleteDialog = false}>Cancel</Button>
      <Button
        variant="destructive"
        disabled={deleteMutation.isPending}
        onclick={() => selectedId && deleteMutation.mutate(selectedId)}
      >
        {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- ── Status dialog ────────────────────────────────────────────────────────── -->
<Dialog.Root bind:open={showStatusDialog}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Change status to "{pendingStatus}"</Dialog.Title>
    </Dialog.Header>
    <div class="py-2">
      <Label>Notes <span class="font-normal text-muted-foreground">(optional)</span></Label>
      <Textarea bind:value={statusNotes} placeholder="Reason, context, what was verified…" rows={3} class="mt-1" />
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => showStatusDialog = false}>Cancel</Button>
      <Button
        disabled={setStatus.isPending}
        onclick={() => pendingStatus && setStatus.mutate({ id: selectedId!, status: pendingStatus, notes: statusNotes.trim() || undefined })}
      >
        Confirm
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
