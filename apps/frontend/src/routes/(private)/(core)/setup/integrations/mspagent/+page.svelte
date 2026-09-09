<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { createTrpcClient } from '$lib/trpc';
  import IntegrationHeader from '../_helpers/integration-header.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as Command from '$lib/components/ui/command/index.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import {
    Settings,
    TriangleAlert,
    Building2,
    CircleCheck,
    CircleX,
    CircleDot,
    KeyRound,
    Copy,
    Check,
    Plus,
    Trash2,
    MoreHorizontal,
    Star,
    Copy as CopyIcon,
    Pencil,
    Eye,
    EyeOff,
    Download,
    Shield,
    ImageIcon,
    Upload,
    X as XIcon,
    LayoutGrid,
    GripVertical,
    Smartphone,
    Users,
    ChevronDown,
    Search,
    Palette,
    LayoutList,
    UserPlus,
    Zap,
  } from '@lucide/svelte';
  import { goto, replaceState } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { toast } from 'svelte-sonner';
  import { toUserMessage, logError } from '$lib/utils/errors';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';

  type MSPAgentConfig = { primaryPsa?: string; siteVariableName?: string };
  type MSPAgentLinkMeta = {
    rmm: 'dattormm';
    variableName: string;
    variableStatus: 'ok' | 'missing' | 'mismatch' | null;
    lastCheckedAt: string | null;
  };
  type CheckResult = { status: 'ok' | 'missing' | 'mismatch'; currentValue: string | null };

  type AgentConfig = {
    id: string;
    name: string;
    description: string | null;
    isDefault: boolean;
    data: Record<string, unknown>;
    siteCount: number;
    groupCount: number;
    updatedAt: string;
  };

  type ConfigAssignment = {
    id: string;
    bundleId: string;
    bundleName: string;
    siteId: string | null;
    siteGroupId: string | null;
    siteName: string | null;
    siteGroupName: string | null;
  };

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();
  const integration = INTEGRATIONS['mspagent'];

  // ── Permission flags (must come before queries that gate on them) ─────────
  const canManage = $derived(authStore.isAllowed('Agents.Write'));
  const canDelete = $derived(authStore.isAllowed('Agents.Delete'));

  // ── Queries ──────────────────────────────────────────────────────────────

  const integrationQuery = createQuery(() => ({
    queryKey: ['integrations.get', 'mspagent'],
    queryFn: () => trpc.integrations.get.query({ id: 'mspagent' }),
  }));

  const dattoLinksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'dattormm'],
    queryFn: () => trpc.integrationLinks.list.query({ integrationId: 'dattormm' }),
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const configsQuery = createQuery(() => ({
    queryKey: ['agents.configs.list'],
    queryFn: () => trpc.agents.configs.list.query(),
    enabled: canManage,
  }));

  const assignmentsQuery = createQuery(() => ({
    queryKey: ['agents.configs.listAssignments'],
    queryFn: () => trpc.agents.configs.listAssignments.query(),
    enabled: canManage,
  }));

  const tokenListQuery = createQuery(() => ({
    queryKey: ['agents.enrollmentToken.list'],
    queryFn: () => trpc.agents.enrollmentToken.list.query(),
    enabled: canManage,
  }));

  const formsQuery = createQuery(() => ({
    queryKey: ['forms.list'],
    queryFn: () => trpc.forms.list.query(),
    enabled: canManage,
  }));

  const siteGroupsQuery = createQuery(() => ({
    queryKey: ['siteGroups.list'],
    queryFn: () => trpc.siteGroups.list.query(),
    enabled: canManage,
  }));

  const webhookSecretQuery = createQuery(() => ({
    queryKey: ['agents.configs.webhookSecret'],
    queryFn: () => trpc.agents.configs.webhookSecret.query(),
    enabled: canManage,
  }));

  // ── Derived state ─────────────────────────────────────────────────────────

  const dbIntegration = $derived(integrationQuery.data ?? null);
  const isConfigured = $derived(!!(dbIntegration && !dbIntegration.deletedAt));
  const existingConfig = $derived((dbIntegration?.config as MSPAgentConfig) ?? null);
  const dattoLinks = $derived(dattoLinksQuery.data ?? []);
  const allSites = $derived(sitesQuery.data ?? []);
  const configs = $derived((configsQuery.data ?? []) as AgentConfig[]);
  const assignments = $derived((assignmentsQuery.data ?? []) as ConfigAssignment[]);
  const forms = $derived(formsQuery.data ?? []);
  const siteGroups = $derived(siteGroupsQuery.data ?? []);
  const isLoading = $derived(integrationQuery.isLoading || sitesQuery.isLoading);


  const linkedSiteIds = $derived(new Set(dattoLinks.filter((l) => l.siteId).map((l) => l.siteId as string)));
  const allLinkedSiteIds = $derived([...linkedSiteIds]);

  const persistedStatus = $derived(
    new Map(
      dattoLinks
        .filter((l) => l.siteId && l.meta)
        .map((l) => {
          const meta = l.meta as MSPAgentLinkMeta;
          return [l.siteId as string, { status: meta.variableStatus, lastCheckedAt: meta.lastCheckedAt }];
        })
    )
  );

  const tokenBySite = $derived(new Map((tokenListQuery.data ?? []).map((t) => [t.siteId, t])));

  // Maps siteId → assignment (site-level only)
  const siteAssignmentMap = $derived(
    new Map(assignments.filter((a) => a.siteId).map((a) => [a.siteId as string, a]))
  );

  const defaultConfig = $derived(configs.find((c) => c.isDefault) ?? null);

  // ── Integration settings sheet ────────────────────────────────────────────

  let configSheetOpen = $state(false);
  let savingConfig = $state(false);
  let showDeleteConfirm = $state(false);

  // ── App Config CRUD ───────────────────────────────────────────────────────

  type ConfigFormData = {
    name: string;
    description: string;
    branding: { appName: string; primaryColor: string; supportEmail: string; supportPhone: string; logoUrl: string };
    tray: { show: boolean; label: string; showMyTickets: boolean };
    enabledFormIds: string[];
    ticketReplyStatusId: number | null;
  };

  function emptyConfigForm(): ConfigFormData {
    return {
      name: '',
      description: '',
      branding: { appName: '', primaryColor: '#3b82f6', supportEmail: '', supportPhone: '', logoUrl: '' },
      tray: { show: true, label: '', showMyTickets: true },
      enabledFormIds: [],
      ticketReplyStatusId: null,
    };
  }

  let configEditOpen = $state(false);

  const psaStatusesQuery = createQuery(() => ({
    queryKey: ['agents.configs.psaMetricOptions', 'status'],
    queryFn: () => trpc.agents.configs.psaMetricOptions.query({ metric: 'status' }),
    enabled: configEditOpen,
    staleTime: 5 * 60 * 1000,
  }));

  let configEditId = $state<string | null>(null);
  let configDialogTab = $state<'details' | 'forms' | 'assignments'>('details');
  let configForm = $state<ConfigFormData>(emptyConfigForm());
  let savingConfigEdit = $state(false);
  let draggingFormId = $state<string | null>(null);
  let dragOverFormId = $state<string | null>(null);

  function reorderForm(targetId: string) {
    if (!draggingFormId || draggingFormId === targetId) return;
    const ids = [...configForm.enabledFormIds];
    const from = ids.indexOf(draggingFormId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, draggingFormId);
    configForm.enabledFormIds = ids;
    draggingFormId = null;
    dragOverFormId = null;
  }

  function openNewConfig() {
    configEditId = null;
    configForm = emptyConfigForm();
    configDialogTab = 'details';
    configEditOpen = true;
  }

  function openEditConfig(config: AgentConfig) {
    configEditId = config.id;
    const d = config.data as {
      branding?: { appName?: string; primaryColor?: string; supportEmail?: string; supportPhone?: string; logoUrl?: string };
      tray?: { show?: boolean; label?: string; showMyTickets?: boolean };
      enabledFormIds?: string[];
      ticketReplyStatusId?: number;
    };
    configForm = {
      name: config.name,
      description: config.description ?? '',
      branding: {
        appName: d?.branding?.appName ?? '',
        primaryColor: d?.branding?.primaryColor ?? '#3b82f6',
        supportEmail: d?.branding?.supportEmail ?? '',
        supportPhone: d?.branding?.supportPhone ?? '',
        logoUrl: d?.branding?.logoUrl ?? '',
      },
      tray: { show: d?.tray?.show ?? true, label: d?.tray?.label ?? '', showMyTickets: d?.tray?.showMyTickets ?? true },
      enabledFormIds: d?.enabledFormIds ?? [],
      ticketReplyStatusId: d?.ticketReplyStatusId ?? null,
    };
    configDialogTab = 'details';
    configEditOpen = true;
  }

  const createConfigMutation = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.agents.configs.create.mutate>[0]) =>
      trpc.agents.configs.create.mutate(input),
  }));

  const updateConfigMutation = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.agents.configs.update.mutate>[0]) =>
      trpc.agents.configs.update.mutate(input),
  }));

  const duplicateConfigMutation = createMutation(() => ({
    mutationFn: (id: string) => trpc.agents.configs.duplicate.mutate({ id }),
  }));

  const deleteConfigMutation = createMutation(() => ({
    mutationFn: (id: string) => trpc.agents.configs.delete.mutate({ id }),
  }));

  const setDefaultMutation = createMutation(() => ({
    mutationFn: (id: string) => trpc.agents.configs.setDefault.mutate({ id }),
  }));

  const assignConfigMutation = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.agents.configs.assign.mutate>[0]) =>
      trpc.agents.configs.assign.mutate(input),
  }));

  const unassignConfigMutation = createMutation(() => ({
    mutationFn: (input: Parameters<typeof trpc.agents.configs.unassign.mutate>[0]) =>
      trpc.agents.configs.unassign.mutate(input),
  }));

  function buildConfigData(form: ConfigFormData) {
    return {
      branding: {
        ...(form.branding.appName ? { appName: form.branding.appName } : {}),
        ...(form.branding.primaryColor ? { primaryColor: form.branding.primaryColor } : {}),
        ...(form.branding.supportEmail ? { supportEmail: form.branding.supportEmail } : {}),
        ...(form.branding.supportPhone ? { supportPhone: form.branding.supportPhone } : {}),
        ...(form.branding.logoUrl ? { logoUrl: form.branding.logoUrl } : {}),
      },
      tray: {
        show: form.tray.show,
        ...(form.tray.label ? { label: form.tray.label } : {}),
        showMyTickets: form.tray.showMyTickets,
      },
      enabledFormIds: form.enabledFormIds,
      ...(form.ticketReplyStatusId != null ? { ticketReplyStatusId: form.ticketReplyStatusId } : {}),
    };
  }

  async function handleSaveConfig() {
    savingConfigEdit = true;
    try {
      const data = buildConfigData(configForm);
      if (configEditId) {
        await updateConfigMutation.mutateAsync({ id: configEditId, name: configForm.name, description: configForm.description || undefined, data });
        toast.success('Config updated');
      } else {
        await createConfigMutation.mutateAsync({ name: configForm.name, description: configForm.description || undefined, data });
        toast.success('Config created');
      }
      queryClient.invalidateQueries({ queryKey: ['agents.configs.list'] });
      configEditOpen = false;
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to save config'));
    } finally {
      savingConfigEdit = false;
    }
  }

  async function handleDuplicateConfig(id: string) {
    try {
      await duplicateConfigMutation.mutateAsync(id);
      queryClient.invalidateQueries({ queryKey: ['agents.configs.list'] });
      toast.success('Config duplicated');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to duplicate config'));
    }
  }

  let deletingConfigId = $state<string | null>(null);
  async function handleDeleteConfig(id: string) {
    try {
      await deleteConfigMutation.mutateAsync(id);
      queryClient.invalidateQueries({ queryKey: ['agents.configs.list'] });
      toast.success('Config deleted');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to delete config'));
    } finally {
      deletingConfigId = null;
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await setDefaultMutation.mutateAsync(id);
      queryClient.invalidateQueries({ queryKey: ['agents.configs.list'] });
      toast.success('Default config updated');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to set default'));
    }
  }

  // ── Config assignment for sites ───────────────────────────────────────────

  async function handleAssignConfig(siteId: string, bundleId: string) {
    try {
      await assignConfigMutation.mutateAsync({ bundleId, siteId });
      queryClient.invalidateQueries({ queryKey: ['agents.configs.listAssignments'] });
      toast.success('Config assigned');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to assign config'));
    }
  }

  async function handleUnassignConfig(siteId: string) {
    try {
      await unassignConfigMutation.mutateAsync({ siteId });
      queryClient.invalidateQueries({ queryKey: ['agents.configs.listAssignments'] });
      toast.success('Reverted to default config');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to remove config assignment'));
    }
  }

  // ── Assignment picker (config dialog Assignments tab) ─────────────────────

  let assignmentPickerValue = $state(''); // "site:<id>" or "group:<id>"
  let assignmentPickerOpen = $state(false);

  async function assignItem(type: 'site' | 'group', id: string) {
    if (!configEditId) return;
    try {
      if (type === 'site') {
        await assignConfigMutation.mutateAsync({ bundleId: configEditId, siteId: id });
      } else {
        await assignConfigMutation.mutateAsync({ bundleId: configEditId, siteGroupId: id });
      }
      queryClient.invalidateQueries({ queryKey: ['agents.configs.listAssignments'] });
      assignmentPickerOpen = false;
      toast.success('Assignment added');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to assign'));
    }
  }

  function configInitial(name: string) {
    const trimmed = (name ?? '').trim();
    return trimmed ? trimmed[0]!.toUpperCase() : '?';
  }

  const configCurrentAssignments = $derived(
    assignments.filter((a) => a.bundleId === configEditId)
  );
  const assignedSiteIds = $derived(
    new Set(configCurrentAssignments.filter((a) => a.siteId).map((a) => a.siteId!))
  );
  const assignedGroupIds = $derived(
    new Set(configCurrentAssignments.filter((a) => a.siteGroupId).map((a) => a.siteGroupId!))
  );

  async function handleAssignTarget() {
    if (!configEditId || !assignmentPickerValue) return;
    const [type, id] = assignmentPickerValue.split(':');
    try {
      if (type === 'site') {
        await assignConfigMutation.mutateAsync({ bundleId: configEditId, siteId: id });
      } else {
        await assignConfigMutation.mutateAsync({ bundleId: configEditId, siteGroupId: id });
      }
      queryClient.invalidateQueries({ queryKey: ['agents.configs.listAssignments'] });
      assignmentPickerValue = '';
      toast.success('Assignment added');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to assign'));
    }
  }

  async function handleUnassignTarget(siteId?: string | null, siteGroupId?: string | null) {
    try {
      if (siteId) await unassignConfigMutation.mutateAsync({ siteId });
      else if (siteGroupId) await unassignConfigMutation.mutateAsync({ siteGroupId });
      queryClient.invalidateQueries({ queryKey: ['agents.configs.listAssignments'] });
      toast.success('Assignment removed');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to remove assignment'));
    }
  }

  // ── Enrollment tokens ─────────────────────────────────────────────────────

  const revealTokenMutation = createMutation(() => ({
    mutationFn: (siteId: string) => trpc.agents.enrollmentToken.reveal.mutate({ siteId }),
  }));

  const regenerateTokenMutation = createMutation(() => ({
    mutationFn: (siteId: string) => trpc.agents.enrollmentToken.regenerate.mutate({ siteId }),
  }));

  const exportCsvMutation = createMutation(() => ({
    mutationFn: () => trpc.agents.enrollmentToken.exportCsv.mutate(),
  }));

  let revealedTokens = $state<Map<string, string>>(new Map());
  let revealingTokens = $state<Set<string>>(new Set());
  let copiedSite = $state<string | null>(null);

  async function handleRevealToken(siteId: string) {
    if (revealedTokens.has(siteId)) {
      // Toggle off
      const next = new Map(revealedTokens);
      next.delete(siteId);
      revealedTokens = next;
      return;
    }
    revealingTokens = new Set([...revealingTokens, siteId]);
    try {
      const result = await revealTokenMutation.mutateAsync(siteId);
      const next = new Map(revealedTokens);
      next.set(siteId, result.token);
      revealedTokens = next;
      if (result.generated) {
        queryClient.invalidateQueries({ queryKey: ['agents.enrollmentToken.list'] });
      }
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to reveal token'));
    } finally {
      const next = new Set(revealingTokens);
      next.delete(siteId);
      revealingTokens = next;
    }
  }

  async function copyToken(siteId: string, token: string) {
    await navigator.clipboard.writeText(token);
    copiedSite = siteId;
    setTimeout(() => (copiedSite = null), 2000);
  }

  let regenerateSiteId = $state<string | null>(null);
  async function handleRegenerateToken(siteId: string) {
    try {
      const result = await regenerateTokenMutation.mutateAsync(siteId);
      const next = new Map(revealedTokens);
      next.set(siteId, result.token);
      revealedTokens = next;
      queryClient.invalidateQueries({ queryKey: ['agents.enrollmentToken.list'] });
      regenerateSiteId = null;
      toast.success('Token regenerated — update your RMM deployment');
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to regenerate token'));
    }
  }

  let exportingCsv = $state(false);
  async function handleExportCsv() {
    exportingCsv = true;
    try {
      const result = await exportCsvMutation.mutateAsync();
      const header = 'Site Name,Site ID,Token\n';
      const body = result.rows.map((r) => `"${r.siteName}","${r.siteId}","${r.token}"`).join('\n');
      const blob = new Blob([header + body], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mspagent-tokens.csv';
      a.click();
      URL.revokeObjectURL(url);
      queryClient.invalidateQueries({ queryKey: ['agents.enrollmentToken.list'] });
      toast.success(`Exported ${result.rows.length} site tokens`);
    } catch (err) {
      toast.error(toUserMessage(err, 'Export failed'));
    } finally {
      exportingCsv = false;
    }
  }

  // ── App icon upload ───────────────────────────────────────────────────────

  const ICON_MAX_BYTES = 512 * 1024; // 512 KB raw cap

  function handleIconUpload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      toast.error(`Image must be under 512 KB (selected: ${Math.round(file.size / 1024)} KB)`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      configForm.branding.logoUrl = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  // ── Datto RMM variable sync ───────────────────────────────────────────────

  let siteSearch = $state('');
  let activeFilter = $state<'All' | 'Linked' | 'Unlinked' | 'Mismatched' | 'Missing'>('All');
  let checkResults = $state<Map<string, CheckResult>>(new Map());
  let checking = $state<Set<string>>(new Set());
  let pushing = $state<Set<string>>(new Set());
  let checkingAll = $state(false);
  let pushingAll = $state(false);

  const filteredSites = $derived(
    allSites
      .filter((s) => s.name.toLowerCase().includes(siteSearch.toLowerCase()))
      .filter((s) => {
        if (activeFilter === 'Linked') return linkedSiteIds.has(s.id);
        if (activeFilter === 'Unlinked') return !linkedSiteIds.has(s.id);
        if (activeFilter === 'Mismatched') return getVarStatus(s.id)?.status === 'mismatch';
        if (activeFilter === 'Missing') return getVarStatus(s.id)?.status === 'missing';
        return true;
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  );

  function getVarStatus(siteId: string): CheckResult | null {
    const sessionResult = checkResults.get(siteId);
    if (sessionResult) return sessionResult;
    const persisted = persistedStatus.get(siteId);
    if (persisted?.status) return { status: persisted.status, currentValue: null };
    return null;
  }

  function getSiteConfig(siteId: string): { name: string; source: 'site' | 'default' } {
    const siteAssignment = siteAssignmentMap.get(siteId);
    if (siteAssignment) return { name: siteAssignment.bundleName, source: 'site' };
    return { name: defaultConfig?.name ?? 'No default set', source: 'default' };
  }

  function makeCheckEnhance(siteId?: string) {
    return () => {
      if (siteId) checking = new Set([...checking, siteId]);
      else checkingAll = true;

      return async ({ result }: { result: any }) => {
        if (siteId) {
          const next = new Set(checking);
          next.delete(siteId);
          checking = next;
        } else {
          checkingAll = false;
        }

        if (result.type === 'success' && result.data?.checkResult) {
          const nextMap = new Map(checkResults);
          for (const item of result.data.checkResult) {
            nextMap.set(item.siteId, { status: item.status, currentValue: item.currentValue });
          }
          checkResults = nextMap;
          if (!siteId) {
            const ok = result.data.checkResult.filter((i: any) => i.status === 'ok').length;
            toast.success(`Check complete: ${ok}/${result.data.checkResult.length} sites OK`);
          }
        } else if (result.type === 'failure') {
          const raw = result.data?.error;
          logError(raw, 'mspagent:check');
          toast.error(toUserMessage(raw, 'Check failed'));
        }
      };
    };
  }

  function makePushEnhance(siteId?: string) {
    return () => {
      if (siteId) pushing = new Set([...pushing, siteId]);
      else pushingAll = true;

      return async ({ result }: { result: any }) => {
        if (siteId) {
          const next = new Set(pushing);
          next.delete(siteId);
          pushing = next;
        } else {
          pushingAll = false;
        }

        if (result.type === 'success') {
          const { pushed, failed, errors } = result.data ?? {};
          if (failed > 0) {
            logError(errors, 'mspagent:push:partial');
            toast.warning(`Pushed ${pushed}, failed ${failed}`);
          } else {
            toast.success(siteId ? 'Variable pushed' : `Pushed ${pushed} site variable${pushed !== 1 ? 's' : ''}`);
          }
        } else if (result.type === 'failure') {
          const raw = result.data?.error;
          logError(raw, 'mspagent:push');
          toast.error(toUserMessage(raw, 'Push failed'));
        }
      };
    };
  }

  function toggleFormId(id: string) {
    if (configForm.enabledFormIds.includes(id)) {
      configForm.enabledFormIds = configForm.enabledFormIds.filter((f) => f !== id);
    } else {
      configForm.enabledFormIds = [...configForm.enabledFormIds, id];
    }
  }

  const disabledForms = $derived(forms.filter((f) => !configForm.enabledFormIds.includes(f.id)));

  // ── Tab state (URL-driven) ────────────────────────────────────────────────

  const agentTabs = ['configs', 'sites', 'forms', 'webhooks'] as const;
  type AgentTab = (typeof agentTabs)[number];

  function tabFromUrl(): AgentTab {
    const tab = get(page).url.searchParams.get('tab');
    return agentTabs.includes(tab as AgentTab) ? (tab as AgentTab) : 'configs';
  }

  let activeTab = $state<AgentTab>('configs');

  onMount(() => {
    activeTab = tabFromUrl();
  });

  function selectTab(value: string) {
    if (!agentTabs.includes(value as AgentTab)) return;
    activeTab = value as AgentTab;

    const currentPage = get(page);
    if (currentPage.url.searchParams.get('tab') === value) return;

    const url = new URL(currentPage.url);
    url.searchParams.set('tab', value);
    replaceState(url, currentPage.state);
  }

  // ── Webhook secret copy state ─────────────────────────────────────────────

  let webhookSecretVisible = $state(false);
  let copiedWebhookField = $state<'url' | 'secret' | null>(null);

  async function copyWebhookField(field: 'url' | 'secret', value: string) {
    await navigator.clipboard.writeText(value);
    copiedWebhookField = field;
    setTimeout(() => (copiedWebhookField = null), 2000);
  }

  // ── Form delete ───────────────────────────────────────────────────────────

  let deleteFormId = $state<string | null>(null);
  let deletingForm = $state(false);

  const deleteFormMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.forms.delete.mutate({ id }),
  }));

  async function handleDeleteForm() {
    if (!deleteFormId) return;
    deletingForm = true;
    try {
      await deleteFormMut.mutateAsync(deleteFormId);
      queryClient.invalidateQueries({ queryKey: ['forms.list'] });
      toast.success('Form deleted');
      deleteFormId = null;
    } catch (err) {
      toast.error(toUserMessage(err, 'Failed to delete form'));
    } finally {
      deletingForm = false;
    }
  }
</script>

<!-- ── Delete integration confirm ─────────────────────────────────────────── -->
<AlertDialog.Root bind:open={showDeleteConfirm}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete MSPAgent Integration?</AlertDialog.Title>
      <AlertDialog.Description>
        This will remove the MSPAgent integration configuration. This action can be undone within 30
        days.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <form
        method="POST"
        action="?/deleteIntegration"
        use:enhance={() => {
          return async ({ result }) => {
            showDeleteConfirm = false;
            if (result.type === 'redirect') goto(result.location);
          };
        }}
      >
        <AlertDialog.Action
          type="submit"
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          Delete Integration
        </AlertDialog.Action>
      </form>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- ── Delete config confirm ──────────────────────────────────────────────── -->
<AlertDialog.Root
  open={!!deletingConfigId}
  onOpenChange={(open) => { if (!open) deletingConfigId = null; }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete Config?</AlertDialog.Title>
      <AlertDialog.Description>
        Sites and groups assigned to this config will revert to the default config.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={() => deletingConfigId && handleDeleteConfig(deletingConfigId)}
      >
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- ── Regenerate token confirm ───────────────────────────────────────────── -->
<AlertDialog.Root
  open={!!regenerateSiteId}
  onOpenChange={(open) => { if (!open) regenerateSiteId = null; }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Regenerate Enrollment Token?</AlertDialog.Title>
      <AlertDialog.Description>
        This will invalidate the existing token. Any RMM deployments using the old token will need to
        be updated before new devices can enroll.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={() => regenerateSiteId && handleRegenerateToken(regenerateSiteId)}
      >
        Regenerate
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- ── Delete form confirm ─────────────────────────────────────────────────── -->
<AlertDialog.Root
  open={!!deleteFormId}
  onOpenChange={(open) => { if (!open) deleteFormId = null; }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this form?</AlertDialog.Title>
      <AlertDialog.Description>
        Configs that include this form will no longer show it to agents. Existing submissions are not affected.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onclick={handleDeleteForm}
        disabled={deletingForm}
      >
        {deletingForm ? 'Deleting…' : 'Delete'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- ── Integration settings sheet ────────────────────────────────────────── -->
{#if authStore.isAllowed('Integrations.Write')}
  <Sheet.Root bind:open={configSheetOpen}>
    <Sheet.Portal>
      <Sheet.Overlay />
      <Sheet.Content side="right" class="w-105 flex flex-col gap-0 p-0">
        <Sheet.Header class="p-4 border-b">
          <Sheet.Title>Integration Settings</Sheet.Title>
          <Sheet.Description>PSA and DattoRMM variable configuration.</Sheet.Description>
        </Sheet.Header>

        <form
          method="POST"
          action="?/save"
          class="flex flex-col flex-1 overflow-hidden"
          use:enhance={() => {
            savingConfig = true;
            return async ({ result }) => {
              savingConfig = false;
              if (result.type === 'success') {
                configSheetOpen = false;
                toast.success('Settings saved');
              } else if (result.type === 'failure') {
                toast.error(`Save failed: ${(result.data as any)?.error}`);
              }
            };
          }}
        >
          <div class="flex flex-col p-4 flex-1 overflow-y-auto gap-4">
            <div class="flex flex-col gap-1.5">
              <Label for="mspagent-var-name">DattoRMM Site Variable Name</Label>
              <Input
                id="mspagent-var-name"
                name="siteVariableName"
                type="text"
                placeholder="MSPSiteCode"
                value={existingConfig?.siteVariableName ?? ''}
              />
              <p class="text-xs text-muted-foreground">The variable name to sync enrollment tokens to in DattoRMM.</p>
            </div>
          </div>

          <Sheet.Footer class="flex justify-between p-4 border-t gap-2">
            {#if isConfigured}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onclick={() => { configSheetOpen = false; showDeleteConfirm = true; }}
              >
                Delete Integration
              </Button>
            {:else}
              <div></div>
            {/if}
            <Button size="sm" type="submit" disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save'}
            </Button>
          </Sheet.Footer>
        </form>
      </Sheet.Content>
    </Sheet.Portal>
  </Sheet.Root>
{/if}

<!-- ── App Config editor dialog ────────────────────────────────────────────── -->
{#snippet trayPreview()}
  {@const previewName = configForm.branding.appName?.trim() || 'IT Support'}
  {@const previewColor = configForm.branding.primaryColor || '#3b82f6'}
  <div class="flex flex-col w-full rounded-xl border shadow-lg overflow-hidden bg-background text-foreground text-xs select-none">
    <!-- Faux window titlebar -->
    <div class="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/40">
      <span class="size-2 rounded-full bg-destructive/40"></span>
      <span class="size-2 rounded-full bg-warning/40"></span>
      <span class="size-2 rounded-full bg-success/40"></span>
    </div>
    <!-- Header with logo + name -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b" style="background: {previewColor}12">
      <div class="flex size-6 shrink-0 items-center justify-center rounded overflow-hidden" style="background: {previewColor}">
        {#if configForm.branding.logoUrl}
          <img src={configForm.branding.logoUrl} alt="" class="h-full w-full object-contain" />
        {:else}
          <span class="text-[10px] font-bold text-white">{previewName[0]?.toUpperCase() ?? 'A'}</span>
        {/if}
      </div>
      <span class="font-semibold truncate">{previewName}</span>
    </div>
    <!-- Form buttons -->
    <div class="flex flex-col py-1 min-h-16">
      {#if configForm.enabledFormIds.length === 0}
        <div class="px-3 py-6 text-center text-muted-foreground/60 text-xs">
          No forms enabled
        </div>
      {:else}
        {#each configForm.enabledFormIds as formId}
          {@const f = forms.find((x) => x.id === formId)}
          {#if f}
            <div class="flex items-center justify-between w-full px-3 py-2 hover:bg-muted/40 transition-colors text-left gap-2">
              <span class="truncate font-medium" style="color: {previewColor}">{f.name}</span>
              <span class="text-muted-foreground shrink-0">›</span>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
    {#if configForm.tray.showMyTickets}
      <div class="border-t px-3 py-2 font-medium" style="color: {previewColor}">My Tickets</div>
    {/if}
    <div class="border-t px-3 py-2 font-medium">About</div>
  </div>
{/snippet}

{#if canManage}
  <Dialog.Root bind:open={configEditOpen}>
    <Dialog.Content class="max-w-6xl! max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
      <!-- Header with identity chip -->
      <Dialog.Header class="px-6 py-4 border-b shrink-0">
        <div class="flex items-start gap-4">
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-lg border overflow-hidden"
            style="background: {configForm.branding.logoUrl ? 'var(--muted)' : (configForm.branding.primaryColor || '#3b82f6')}"
          >
            {#if configForm.branding.logoUrl}
              <img src={configForm.branding.logoUrl} alt="" class="h-full w-full object-contain" />
            {:else}
              <span class="text-base font-semibold text-white">{configInitial(configForm.name || 'Config')}</span>
            {/if}
          </div>
          <div class="flex flex-col gap-0.5 min-w-0 flex-1">
            <Dialog.Title class="text-base leading-tight">
              {configEditId ? (configForm.name || 'Edit config') : 'New config'}
            </Dialog.Title>
            <Dialog.Description class="text-xs">
              Design the agent app your end users see — branding, forms, and where it's deployed.
            </Dialog.Description>
          </div>
        </div>
      </Dialog.Header>

      <!-- Body: two-pane -->
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] flex-1 min-h-0 overflow-hidden">
        <!-- Left column: tabs + content -->
        <div class="flex flex-col min-h-0 overflow-hidden lg:border-r">
          <Tabs.Root bind:value={configDialogTab} class="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div class="px-6 pt-3 border-b shrink-0">
              <Tabs.List class="w-fit">
                <Tabs.Trigger value="details" class="gap-1.5">
                  <Palette class="size-3.5" /> Appearance
                </Tabs.Trigger>
                <Tabs.Trigger value="forms" class="gap-1.5">
                  <LayoutList class="size-3.5" /> Forms
                  {#if configForm.enabledFormIds.length > 0}
                    <span class="ml-0.5 text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-normal">{configForm.enabledFormIds.length}</span>
                  {/if}
                </Tabs.Trigger>
                <Tabs.Trigger value="assignments" class="gap-1.5">
                  <UserPlus class="size-3.5" /> Assignments
                  {#if configCurrentAssignments.length > 0}
                    <span class="ml-0.5 text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-normal">{configCurrentAssignments.length}</span>
                  {/if}
                </Tabs.Trigger>
              </Tabs.List>
            </div>

            <!-- Appearance tab -->
            <Tabs.Content value="details" class="flex-1 overflow-y-auto min-h-0">
              <div class="flex flex-col px-6 py-6 gap-8">
                <!-- Identity section -->
                <section class="flex flex-col gap-4">
                  <header class="flex flex-col gap-0.5">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Identity</p>
                    <p class="text-xs text-muted-foreground/80">Internal name and summary. Only visible to admins.</p>
                  </header>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1.5">
                      <Label for="cfg-name">Name</Label>
                      <Input id="cfg-name" bind:value={configForm.name} placeholder="Default config" />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <Label for="cfg-desc">Description <span class="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input id="cfg-desc" bind:value={configForm.description} placeholder="Standard branding for most sites" />
                    </div>
                  </div>
                </section>

                <!-- Branding section -->
                <section class="flex flex-col gap-4">
                  <header class="flex flex-col gap-0.5">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Branding</p>
                    <p class="text-xs text-muted-foreground/80">How the agent app appears in the system tray.</p>
                  </header>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1.5">
                      <Label for="cfg-appname">Display name</Label>
                      <Input id="cfg-appname" bind:value={configForm.branding.appName} placeholder="IT Support" />
                      <p class="text-[11px] text-muted-foreground">Shown at the top of the tray popover.</p>
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <Label>Primary color</Label>
                      <div class="flex items-center gap-2 h-9 px-1.5 rounded-md border border-input bg-background">
                        <input
                          type="color"
                          bind:value={configForm.branding.primaryColor}
                          class="size-7 rounded cursor-pointer border border-input bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded"
                        />
                        <Input
                          bind:value={configForm.branding.primaryColor}
                          maxlength={7}
                          class="h-7 border-0 px-1 shadow-none focus-visible:ring-0 font-mono text-xs uppercase"
                        />
                      </div>
                      <p class="text-[11px] text-muted-foreground">Applied to buttons and form labels.</p>
                    </div>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <Label>App icon <span class="text-muted-foreground font-normal">(optional)</span></Label>
                    <div class="flex items-center gap-4 p-3 rounded-md border bg-muted/20">
                      <div
                        class="flex size-14 shrink-0 items-center justify-center rounded-md border overflow-hidden"
                        style="background: {configForm.branding.logoUrl ? 'transparent' : ((configForm.branding.primaryColor || '#3b82f6') + '18')}"
                      >
                        {#if configForm.branding.logoUrl}
                          <img src={configForm.branding.logoUrl} alt="App icon preview" class="h-full w-full object-contain" />
                        {:else}
                          <ImageIcon class="size-5 text-muted-foreground/50" />
                        {/if}
                      </div>
                      <div class="flex flex-col gap-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <label class="cursor-pointer">
                            <input type="file" accept="image/*" class="hidden" onchange={handleIconUpload} />
                            <span class="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors">
                              <Upload class="size-3.5" />
                              {configForm.branding.logoUrl ? 'Replace' : 'Upload'}
                            </span>
                          </label>
                          {#if configForm.branding.logoUrl}
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 text-xs h-8 px-2 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                              onclick={() => (configForm.branding.logoUrl = '')}
                            >
                              <XIcon class="size-3.5" /> Remove
                            </button>
                          {/if}
                        </div>
                        <p class="text-[11px] text-muted-foreground">PNG or WebP, 256×256, under 512 KB.</p>
                      </div>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1.5">
                      <Label for="cfg-email">Support email <span class="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input id="cfg-email" type="email" bind:value={configForm.branding.supportEmail} placeholder="help@msp.com" />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <Label for="cfg-phone">Support phone <span class="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input id="cfg-phone" type="tel" bind:value={configForm.branding.supportPhone} placeholder="555-1234" />
                    </div>
                  </div>
                </section>

                <!-- Tray section -->
                <section class="flex flex-col gap-4">
                  <header class="flex flex-col gap-0.5">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">System tray</p>
                    <p class="text-xs text-muted-foreground/80">Where the agent lives on the end user's machine.</p>
                  </header>

                  <div class="flex items-center justify-between rounded-md border px-4 py-3">
                    <div class="flex flex-col gap-0.5">
                      <span class="text-sm font-medium">Show tray icon</span>
                      <span class="text-xs text-muted-foreground">Pin the agent to the system tray so users can open it anytime.</span>
                    </div>
                    <Switch bind:checked={configForm.tray.show} />
                  </div>

                  {#if configForm.tray.show}
                    <div class="flex flex-col gap-1.5 max-w-sm">
                      <Label for="cfg-tray-label">Tray tooltip <span class="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input id="cfg-tray-label" bind:value={configForm.tray.label} placeholder="IT Support" />
                      <p class="text-[11px] text-muted-foreground">Text shown when hovering the tray icon. Defaults to the display name.</p>
                    </div>
                    <div class="flex items-center justify-between rounded-md border px-4 py-3">
                      <div class="flex flex-col gap-0.5">
                        <span class="text-sm font-medium">Show My Tickets</span>
                        <span class="text-xs text-muted-foreground">Let end users review and reply to their submitted tickets.</span>
                      </div>
                      <Switch bind:checked={configForm.tray.showMyTickets} />
                    </div>
                  {/if}
                </section>

                <!-- PSA Behaviour section -->
                <section class="flex flex-col gap-4">
                  <header class="flex flex-col gap-0.5">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">PSA behaviour</p>
                    <p class="text-xs text-muted-foreground/80">How the agent app interacts with your PSA after end-user actions.</p>
                  </header>

                  <div class="flex flex-col gap-1.5 max-w-sm">
                    <Label for="cfg-reply-status">Ticket status after reply <span class="text-muted-foreground font-normal">(optional)</span></Label>
                    <SingleSelect
                      options={(psaStatusesQuery.data ?? []).map(s => ({ value: String(s.id), label: s.name }))}
                      selected={configForm.ticketReplyStatusId != null ? String(configForm.ticketReplyStatusId) : undefined}
                      placeholder="— no change —"
                      loading={psaStatusesQuery.isLoading}
                      onchange={(v) => { configForm.ticketReplyStatusId = v ? Number(v) : null; }}
                    />
                    <p class="text-[11px] text-muted-foreground">When an end user sends a reply on a ticket, the ticket is moved to this status in the PSA.</p>
                  </div>
                </section>
              </div>
            </Tabs.Content>

            <!-- Forms tab -->
            <Tabs.Content value="forms" class="flex-1 overflow-y-auto min-h-0">
              <div class="flex flex-col px-6 py-6 gap-6">
                <header class="flex items-start justify-between gap-4">
                  <div class="flex flex-col gap-0.5">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tray forms</p>
                    <p class="text-xs text-muted-foreground/80">Drag to reorder. Enabled forms appear as buttons in the tray.</p>
                  </div>
                  <Button size="sm" variant="outline" class="gap-1.5 shrink-0" onclick={() => { configEditOpen = false; goto('/setup/integrations/mspagent/forms'); }}>
                    <Plus class="size-3.5" /> New form
                  </Button>
                </header>

                {#if forms.length === 0}
                  <div class="flex flex-col items-center gap-3 py-12 border rounded-lg text-center">
                    <div class="flex size-10 items-center justify-center rounded-full bg-muted">
                      <LayoutGrid class="size-5 text-muted-foreground" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <p class="text-sm font-medium">No forms yet</p>
                      <p class="text-xs text-muted-foreground">Forms let end users submit tickets from the tray.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" class="gap-2" onclick={() => { configEditOpen = false; goto('/setup/integrations/mspagent/forms'); }}>
                      <Plus class="size-3.5" /> Create your first form
                    </Button>
                  </div>
                {:else}
                  <div class="flex flex-col gap-4">
                    <!-- Enabled -->
                    <div class="flex flex-col gap-1.5">
                      <div class="flex items-center justify-between">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Enabled {configForm.enabledFormIds.length > 0 ? `(${configForm.enabledFormIds.length})` : ''}
                        </p>
                        {#if configForm.enabledFormIds.length > 0}
                          <span class="text-[11px] text-muted-foreground">Top to bottom is the display order.</span>
                        {/if}
                      </div>
                      {#if configForm.enabledFormIds.length > 0}
                        <div class="flex flex-col gap-1">
                          {#each configForm.enabledFormIds as formId (formId)}
                            {@const f = forms.find((x) => x.id === formId)}
                            {#if f}
                              <div
                                role="listitem"
                                draggable="true"
                                ondragstart={() => (draggingFormId = formId)}
                                ondragover={(e) => { e.preventDefault(); dragOverFormId = formId; }}
                                ondrop={() => reorderForm(formId)}
                                ondragend={() => { draggingFormId = null; dragOverFormId = null; }}
                                class="group flex items-center gap-3 px-3 py-2.5 rounded-md border bg-card cursor-grab active:cursor-grabbing transition-all
                                  {dragOverFormId === formId && draggingFormId !== formId ? 'border-primary border-dashed' : 'hover:border-primary/40'}"
                              >
                                <GripVertical class="size-4 text-muted-foreground/60 shrink-0" />
                                <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                                  <span class="text-sm font-medium truncate">{f.name}</span>
                                  {#if f.description}
                                    <span class="text-xs text-muted-foreground truncate">{f.description}</span>
                                  {/if}
                                </div>
                                <button
                                  type="button"
                                  onclick={() => toggleFormId(formId)}
                                  class="shrink-0 size-7 flex items-center justify-center rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  title="Remove from tray"
                                >
                                  <XIcon class="size-3.5" />
                                </button>
                              </div>
                            {/if}
                          {/each}
                        </div>
                      {:else}
                        <div class="flex flex-col items-center gap-1 py-6 border rounded-md border-dashed text-center">
                          <p class="text-sm text-muted-foreground">No forms enabled</p>
                          <p class="text-[11px] text-muted-foreground/70">Add one from the list below.</p>
                        </div>
                      {/if}
                    </div>

                    <!-- Available -->
                    {#if disabledForms.length > 0}
                      <div class="flex flex-col gap-1.5">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Available</p>
                        <div class="flex flex-col gap-1">
                          {#each disabledForms as f}
                            <button
                              type="button"
                              onclick={() => toggleFormId(f.id)}
                              class="flex items-center gap-3 px-3 py-2.5 rounded-md border border-dashed border-border/70 hover:border-primary hover:bg-primary/5 text-left transition-colors"
                            >
                              <div class="flex size-6 shrink-0 items-center justify-center rounded bg-muted/70 group-hover:bg-primary/10">
                                <Plus class="size-3.5 text-muted-foreground" />
                              </div>
                              <div class="flex flex-col gap-0.5 min-w-0">
                                <span class="text-sm font-medium truncate">{f.name}</span>
                                {#if f.description}
                                  <span class="text-xs text-muted-foreground truncate">{f.description}</span>
                                {/if}
                              </div>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            </Tabs.Content>

            <!-- Assignments tab -->
            <Tabs.Content value="assignments" class="flex-1 overflow-y-auto min-h-0">
              <div class="flex flex-col px-6 py-6 gap-6">
                {#if !configEditId}
                  <div class="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                    <div class="flex size-10 items-center justify-center rounded-full bg-muted">
                      <UserPlus class="size-5" />
                    </div>
                    <p class="text-sm">Save this config first, then assign it to sites or groups.</p>
                  </div>
                {:else}
                  {@const isThisDefault = configs.find((c) => c.id === configEditId)?.isDefault}

                  <!-- Default fallback callout -->
                  <div class="flex items-start gap-3 px-4 py-3 rounded-lg border bg-muted/30">
                    <Shield class="size-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div class="flex flex-col gap-0.5 min-w-0">
                      {#if isThisDefault}
                        <p class="text-sm font-medium">This is the default</p>
                        <p class="text-xs text-muted-foreground">All sites and groups without an explicit assignment use this config. No direct assignments needed.</p>
                      {:else}
                        <p class="text-sm font-medium">Overrides the default</p>
                        <p class="text-xs text-muted-foreground">
                          Anything not listed below falls through to
                          <strong>{defaultConfig?.name ?? 'the default config'}</strong>.
                        </p>
                      {/if}
                    </div>
                  </div>

                  {#if !isThisDefault}
                    <!-- Header + add button -->
                    <div class="flex items-center justify-between gap-4">
                      <div class="flex flex-col gap-0.5">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Direct assignments {configCurrentAssignments.length > 0 ? `(${configCurrentAssignments.length})` : ''}
                        </p>
                        <p class="text-xs text-muted-foreground/80">Sites and groups that use this config instead of the default.</p>
                      </div>

                      <Popover.Root bind:open={assignmentPickerOpen}>
                        <Popover.Trigger>
                          {#snippet child({ props })}
                            <Button size="sm" class="gap-1.5 shrink-0" {...props}>
                              <Plus class="size-3.5" /> Add
                            </Button>
                          {/snippet}
                        </Popover.Trigger>
                        <Popover.Content align="end" class="p-0 w-72">
                          <Command.Root>
                            <Command.Input placeholder="Search sites and groups..." />
                            <Command.List>
                              <Command.Empty>Nothing found.</Command.Empty>
                              {@const availSites = allSites.filter((s) => !assignedSiteIds.has(s.id))}
                              {@const availGroups = siteGroups.filter((g) => !assignedGroupIds.has(g.id))}
                              {#if availSites.length > 0}
                                <Command.Group heading="Sites">
                                  {#each availSites as site (site.id)}
                                    <Command.Item value={'site:' + site.name} onSelect={() => assignItem('site', site.id)}>
                                      <Building2 class="size-3.5 mr-2 text-muted-foreground" />
                                      <span class="truncate">{site.name}</span>
                                    </Command.Item>
                                  {/each}
                                </Command.Group>
                              {/if}
                              {#if availGroups.length > 0}
                                <Command.Group heading="Site groups">
                                  {#each availGroups as group (group.id)}
                                    <Command.Item value={'group:' + group.name} onSelect={() => assignItem('group', group.id)}>
                                      <Users class="size-3.5 mr-2 text-muted-foreground" />
                                      <span class="truncate">{group.name}</span>
                                    </Command.Item>
                                  {/each}
                                </Command.Group>
                              {/if}
                            </Command.List>
                          </Command.Root>
                        </Popover.Content>
                      </Popover.Root>
                    </div>

                    {#if configCurrentAssignments.length === 0}
                      <div class="flex flex-col items-center gap-2 py-10 rounded-lg border border-dashed text-center">
                        <p class="text-sm text-muted-foreground">Nothing assigned directly</p>
                        <p class="text-[11px] text-muted-foreground/70">Assigned sites and groups will show up here.</p>
                      </div>
                    {:else}
                      <div class="flex flex-col divide-y rounded-lg border overflow-hidden">
                        {#each configCurrentAssignments as assignment (assignment.id)}
                          <div class="flex items-center justify-between px-4 py-3 hover:bg-muted/30">
                            <div class="flex items-center gap-3 min-w-0">
                              <div class="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                                {#if assignment.siteGroupId}
                                  <Users class="size-4 text-muted-foreground" />
                                {:else}
                                  <Building2 class="size-4 text-muted-foreground" />
                                {/if}
                              </div>
                              <div class="flex flex-col min-w-0">
                                <span class="text-sm font-medium truncate">
                                  {assignment.siteGroupId ? (assignment.siteGroupName ?? 'Unknown group') : (assignment.siteName ?? 'Unknown site')}
                                </span>
                                <span class="text-[11px] text-muted-foreground">
                                  {assignment.siteGroupId ? 'Site group' : 'Site'}
                                </span>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="h-7 text-xs text-muted-foreground hover:text-destructive shrink-0"
                              onclick={() => handleUnassignTarget(assignment.siteId, assignment.siteGroupId)}
                            >
                              Remove
                            </Button>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                {/if}
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>

        <!-- Right column: sticky live preview -->
        <aside class="hidden lg:flex flex-col gap-3 p-6 bg-muted/25 min-h-0 overflow-y-auto">
          <div class="flex items-center justify-between">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live preview</p>
            <span class="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span class="size-1.5 rounded-full bg-success"></span> Updates as you type
            </span>
          </div>
          {@render trayPreview()}
          <p class="text-[11px] text-muted-foreground leading-relaxed">
            This is what end users see when they open the agent from their system tray.
          </p>
        </aside>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-6 py-4 border-t shrink-0 gap-4">
        <p class="text-[11px] text-muted-foreground">
          {#if configEditId}
            {#if configs.find((c) => c.id === configEditId)?.isDefault}
              Changes push to every unassigned site.
            {:else}
              Changes apply the next time assigned devices check in.
            {/if}
          {:else}
            You can assign sites after saving.
          {/if}
        </p>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" onclick={() => (configEditOpen = false)}>Cancel</Button>
          <Button size="sm" onclick={handleSaveConfig} disabled={savingConfigEdit || !configForm.name.trim()}>
            {savingConfigEdit ? 'Saving...' : (configEditId ? 'Save changes' : 'Create config')}
          </Button>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<!-- ── Page layout ────────────────────────────────────────────────────────── -->
<div class="flex flex-col size-full p-4 gap-4 overflow-hidden">
  <div class="flex items-start justify-between shrink-0">
    <IntegrationHeader {integration} active={isConfigured} loading={integrationQuery.isLoading} />
    <Button variant="outline" size="sm" onclick={() => (configSheetOpen = true)} class="gap-2">
      <Settings class="size-4" />
      Integration Settings
    </Button>
  </div>

  {#if isLoading}
    <Loader />
  {:else if isConfigured}
    <Tabs.Root value={activeTab} onValueChange={selectTab} class="flex flex-col flex-1 min-h-0 gap-0">
      <Tabs.List class="shrink-0 w-fit">
        <Tabs.Trigger value="configs">App Configs</Tabs.Trigger>
        <Tabs.Trigger value="sites">Sites</Tabs.Trigger>
        <Tabs.Trigger value="forms">
          Forms
          {#if forms.length > 0}
            <span class="ml-1.5 text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 font-normal">{forms.length}</span>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="webhooks">Webhooks</Tabs.Trigger>
      </Tabs.List>

      <!-- ── App Configs tab ─────────────────────────────────────────────── -->
      <Tabs.Content value="configs" class="flex flex-col flex-1 min-h-0 mt-4 gap-4">
        <div class="flex items-start justify-between shrink-0 gap-4">
          <div class="flex flex-col gap-0.5 min-w-0">
            <h2 class="text-sm font-semibold">App configs</h2>
            <p class="text-xs text-muted-foreground">
              Each config is a branded version of the MSPAgent tray app. Assign one to a site or group; anything unassigned uses the default.
            </p>
          </div>
          {#if canManage && configs.length > 0}
            <Button size="sm" onclick={openNewConfig} class="gap-2 shrink-0">
              <Plus class="size-4" />
              New config
            </Button>
          {/if}
        </div>

        {#if configsQuery.isLoading}
          <Loader />
        {:else if configs.length === 0}
          <div class="flex flex-col items-center justify-center flex-1 gap-4 rounded-lg border border-dashed bg-muted/10 py-16">
            <div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Palette class="size-6 text-primary" />
            </div>
            <div class="flex flex-col items-center gap-1 max-w-xs text-center">
              <span class="text-sm font-semibold">Design your first agent</span>
              <span class="text-xs text-muted-foreground">A config controls how the MSPAgent tray app looks and which forms it offers. Start with a default and add overrides per site or group.</span>
            </div>
            {#if canManage}
              <Button size="sm" onclick={openNewConfig} class="gap-2 mt-2">
                <Plus class="size-4" />
                Create default config
              </Button>
            {/if}
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto pr-1">
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {#each configs as config (config.id)}
                {@const data = (config.data ?? {}) as { branding?: { appName?: string; primaryColor?: string; logoUrl?: string }; enabledFormIds?: string[] }}
                {@const color = data.branding?.primaryColor || '#3b82f6'}
                {@const displayName = data.branding?.appName?.trim() || 'IT Support'}
                {@const logo = data.branding?.logoUrl}
                {@const formCount = data.enabledFormIds?.length ?? 0}
                <div class="group relative flex flex-col rounded-lg border bg-card overflow-hidden hover:border-primary/40 hover:shadow-md transition-all">
                  <!-- Brand accent bar -->
                  <div class="h-1 w-full shrink-0" style="background: {color}"></div>

                  <!-- Card body — click surface -->
                  <button
                    type="button"
                    class="flex items-start gap-3 p-4 text-left w-full min-w-0 focus:outline-none focus-visible:bg-muted/40"
                    onclick={() => openEditConfig(config)}
                  >
                    <div
                      class="flex size-11 shrink-0 items-center justify-center rounded-md border overflow-hidden"
                      style="background: {logo ? 'transparent' : color}"
                    >
                      {#if logo}
                        <img src={logo} alt="" class="h-full w-full object-contain" />
                      {:else}
                        <span class="text-base font-semibold text-white">{configInitial(displayName)}</span>
                      {/if}
                    </div>
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="font-medium text-sm truncate">{config.name}</span>
                        {#if config.isDefault}
                          <Badge variant="outline" class="text-[10px] h-4 px-1.5 gap-0.5 bg-primary/10 text-primary border-primary/30 shrink-0">
                            <Star class="size-2.5 fill-current" /> Default
                          </Badge>
                        {/if}
                      </div>
                      <span class="text-xs text-muted-foreground truncate">
                        {displayName}
                      </span>
                      {#if config.description}
                        <span class="text-[11px] text-muted-foreground/70 truncate mt-1">{config.description}</span>
                      {/if}
                    </div>
                  </button>

                  <!-- Footer with counts -->
                  <div class="flex items-center gap-3 px-4 py-2.5 border-t bg-muted/20 text-[11px] text-muted-foreground">
                    <span class="flex items-center gap-1.5" title="Direct site assignments">
                      <Building2 class="size-3" />
                      {config.siteCount}
                    </span>
                    <span class="flex items-center gap-1.5" title="Direct group assignments">
                      <Users class="size-3" />
                      {config.groupCount}
                    </span>
                    <span class="flex items-center gap-1.5" title="Enabled tray forms">
                      <LayoutList class="size-3" />
                      {formCount}
                    </span>
                    {#if config.isDefault && config.siteCount === 0 && config.groupCount === 0}
                      <span class="ml-auto text-muted-foreground/70">Applies to everything unassigned</span>
                    {:else if config.siteCount === 0 && config.groupCount === 0}
                      <span class="ml-auto text-muted-foreground/70">Unused</span>
                    {/if}
                  </div>

                  <!-- Actions menu -->
                  {#if canManage}
                    <div
                      class="absolute top-2.5 right-2.5 z-10"
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e) => e.stopPropagation()}
                      role="presentation"
                    >
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                          {#snippet child({ props })}
                            <Button variant="ghost" size="icon" class="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 bg-background/80 backdrop-blur-sm hover:bg-background border" {...props}>
                              <MoreHorizontal class="size-3.5" />
                            </Button>
                          {/snippet}
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="end">
                          <DropdownMenu.Item onclick={() => openEditConfig(config)}>
                            <Pencil class="size-3.5 mr-2" /> Edit
                          </DropdownMenu.Item>
                          <DropdownMenu.Item onclick={() => handleDuplicateConfig(config.id)}>
                            <CopyIcon class="size-3.5 mr-2" /> Duplicate
                          </DropdownMenu.Item>
                          {#if !config.isDefault}
                            <DropdownMenu.Item onclick={() => handleSetDefault(config.id)}>
                              <Star class="size-3.5 mr-2" /> Set as default
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator />
                            {#if canDelete}
                              <DropdownMenu.Item
                                class="text-destructive focus:text-destructive"
                                onclick={() => (deletingConfigId = config.id)}
                              >
                                <Trash2 class="size-3.5 mr-2" /> Delete
                              </DropdownMenu.Item>
                            {/if}
                          {/if}
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </Tabs.Content>

      <!-- ── Sites tab ───────────────────────────────────────────────────── -->
      <Tabs.Content value="sites" class="flex flex-col flex-1 min-h-0 mt-4 gap-3">
        <div class="flex gap-2 items-center shrink-0 flex-wrap">
          <Input
            type="text"
            placeholder="Search sites..."
            bind:value={siteSearch}
            class="w-64"
          />
          <div class="flex gap-1.5 shrink-0">
            {#each ['All', 'Linked', 'Unlinked', 'Mismatched', 'Missing'] as filter}
              <button
                type="button"
                aria-pressed={activeFilter === filter}
                class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
                  {activeFilter === filter
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-foreground/30'}"
                onclick={() => (activeFilter = filter as typeof activeFilter)}
              >
                {filter}
              </button>
            {/each}
          </div>
          <div class="flex gap-2 ml-auto shrink-0">
            {#if canManage}
              <Button
                size="sm"
                variant="outline"
                onclick={handleExportCsv}
                disabled={exportingCsv}
                class="gap-2"
              >
                <Download class="size-4" />
                {exportingCsv ? 'Exporting...' : 'Export Tokens'}
              </Button>
            {/if}
            <form method="POST" action="?/checkVars" use:enhance={makeCheckEnhance()}>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={checkingAll || allLinkedSiteIds.length === 0}
                class="gap-2"
              >
                <CircleDot class="size-4" />
                {checkingAll ? 'Checking...' : 'Check All'}
              </Button>
            </form>
            {#if authStore.isAllowed('Integrations.Write')}
              <AlertDialog.Root>
                <AlertDialog.Trigger>
                  {#snippet child({ props })}
                    <Button
                      type="button"
                      size="sm"
                      disabled={pushingAll || allLinkedSiteIds.length === 0}
                      {...props}
                    >
                      {pushingAll ? 'Pushing...' : 'Push All'}
                    </Button>
                  {/snippet}
                </AlertDialog.Trigger>
                <AlertDialog.Content>
                  <AlertDialog.Header>
                    <AlertDialog.Title>Push Variables to All Sites?</AlertDialog.Title>
                    <AlertDialog.Description>
                      This will push to all {allLinkedSiteIds.length} linked DattoRMM site{allLinkedSiteIds.length !== 1 ? 's' : ''}.
                    </AlertDialog.Description>
                  </AlertDialog.Header>
                  <AlertDialog.Footer>
                    <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                    <form method="POST" action="?/pushVars" use:enhance={makePushEnhance()}>
                      <AlertDialog.Action type="submit" disabled={pushingAll}>Push All</AlertDialog.Action>
                    </form>
                  </AlertDialog.Footer>
                </AlertDialog.Content>
              </AlertDialog.Root>
            {/if}
          </div>
        </div>

        <div class="flex-1 overflow-hidden flex flex-col min-h-0">
          {#if filteredSites.length === 0}
            <div class="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Building2 class="size-8 opacity-40" />
              <span class="text-sm">No sites found</span>
            </div>
          {:else}
            <div class="flex-1 overflow-y-auto">
              <div class="flex flex-col divide-y">
                {#each filteredSites as site (site.id)}
                  {@const dattoLink = dattoLinks.find((l) => l.siteId === site.id)}
                  {@const isLinked = !!dattoLink}
                  {@const isPushing = pushing.has(site.id)}
                  {@const isChecking = checking.has(site.id)}
                  {@const varStatus = getVarStatus(site.id)}
                  {@const hasToken = tokenBySite.has(site.id)}
                  {@const revealedToken = revealedTokens.get(site.id)}
                  {@const isRevealing = revealingTokens.has(site.id)}
                  <div class="flex justify-between px-2 py-3 items-start hover:bg-muted/30 gap-4">
                    <div class="flex flex-col gap-1.5 min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-medium text-sm">{site.name}</span>
                        {#if isLinked}
                          <Badge class="text-xs shrink-0 bg-primary/15 text-primary border-primary/30" variant="outline">
                            LINKED
                          </Badge>
                        {:else}
                          <Badge class="text-xs shrink-0 bg-muted-foreground/15 text-muted-foreground border-muted-foreground/30" variant="outline">
                            NOT LINKED
                          </Badge>
                        {/if}
                      </div>

                      <!-- Token row -->
                      {#if canManage}
                        <div class="flex items-center gap-2">
                          <KeyRound class="size-3 shrink-0 text-muted-foreground" />
                          {#if revealedToken}
                            <code class="text-xs font-mono bg-muted px-1.5 py-0.5 rounded select-all max-w-xs truncate">
                              {revealedToken}
                            </code>
                            <button
                              onclick={() => copyToken(site.id, revealedToken)}
                              class="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                              title="Copy token"
                            >
                              {#if copiedSite === site.id}
                                <Check class="size-3.5 text-emerald-500" />
                              {:else}
                                <Copy class="size-3.5" />
                              {/if}
                            </button>
                          {:else if hasToken}
                            <span class="text-xs font-mono text-muted-foreground">••••••••••••••••</span>
                          {:else}
                            <span class="text-xs text-muted-foreground/50">No token</span>
                          {/if}
                          <button
                            onclick={() => handleRevealToken(site.id)}
                            disabled={isRevealing}
                            class="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            title={revealedToken ? 'Hide token' : hasToken ? 'Reveal token' : 'Generate and reveal token'}
                          >
                            {#if isRevealing}
                              <span class="text-xs animate-pulse">...</span>
                            {:else if revealedToken}
                              <EyeOff class="size-3.5" />
                            {:else}
                              <Eye class="size-3.5" />
                            {/if}
                          </button>
                        </div>
                      {/if}

                      <!-- Datto status row -->
                      {#if isLinked && dattoLink}
                        <div class="flex items-center gap-2 text-xs text-muted-foreground">
                          <span class="truncate">{dattoLink.name ?? dattoLink.externalId}</span>
                          {#if isChecking}
                            <span class="animate-pulse">Checking...</span>
                          {:else if varStatus?.status === 'ok'}
                            <span class="inline-flex items-center gap-1 text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                              <CircleCheck class="size-3" /> OK
                            </span>
                          {:else if varStatus?.status === 'mismatch'}
                            <span class="inline-flex items-center gap-1 text-amber-500 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                              <CircleX class="size-3" /> Mismatch
                            </span>
                          {:else if varStatus?.status === 'missing'}
                            <span class="inline-flex items-center gap-1 text-destructive bg-destructive/10 border border-destructive/30 px-1.5 py-0.5 rounded-full">
                              <CircleX class="size-3" /> Missing
                            </span>
                          {/if}
                        </div>
                      {:else}
                        <span class="text-xs text-muted-foreground/40">No DattoRMM link</span>
                      {/if}
                    </div>

                    <!-- Actions -->
                    <div class="flex items-center gap-1.5 shrink-0">
                      {#if isLinked && dattoLink}
                        <form method="POST" action="?/checkVars" use:enhance={makeCheckEnhance(site.id)}>
                          <input type="hidden" name="siteId" value={site.id} />
                          <Button type="submit" size="sm" variant="ghost" disabled={isChecking || checkingAll} class="gap-1.5 text-muted-foreground">
                            <CircleDot class="size-3.5" />
                            {isChecking ? '...' : 'Check'}
                          </Button>
                        </form>
                        {#if authStore.isAllowed('Integrations.Write')}
                          <form method="POST" action="?/pushVars" use:enhance={makePushEnhance(site.id)}>
                            <input type="hidden" name="siteId" value={site.id} />
                            <Button type="submit" size="sm" variant="outline" disabled={isPushing || pushingAll}>
                              {isPushing ? '...' : 'Push'}
                            </Button>
                          </form>
                        {/if}
                      {/if}
                      {#if canManage}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="gap-1.5 text-muted-foreground"
                          onclick={() => (regenerateSiteId = site.id)}
                          title="Regenerate enrollment token"
                        >
                          <KeyRound class="size-3.5" />
                          Regen
                        </Button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </Tabs.Content>

      <!-- ── Forms tab ────────────────────────────────────────────────────── -->
      <Tabs.Content value="forms" class="flex flex-col flex-1 min-h-0 mt-4 gap-3">
        <div class="flex items-center justify-between shrink-0">
          <p class="text-sm text-muted-foreground">
            Forms collect support requests and can securely launch packages. Enable individual forms per config under App Configs.
          </p>
          {#if canManage}
            <Button size="sm" onclick={() => goto('/setup/integrations/mspagent/forms')} class="gap-2 shrink-0">
              <Plus class="size-4" />
              New Form
            </Button>
          {/if}
        </div>

        {#if formsQuery.isLoading}
          <Loader />
        {:else if forms.length === 0}
          <div class="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <LayoutGrid class="size-5" />
            </div>
            <div class="flex flex-col items-center gap-1 text-center">
              <span class="text-sm font-medium">No forms yet</span>
              <span class="text-xs">Create forms agents can use to let end users submit support tickets.</span>
            </div>
            {#if canManage}
              <Button size="sm" onclick={() => goto('/setup/integrations/mspagent/forms')} class="gap-2">
                <Plus class="size-4" />
                Create your first form
              </Button>
            {/if}
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto">
            <div class="flex flex-col divide-y rounded border">
              {#each forms as form (form.id)}
                <div class="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
                      <LayoutGrid class="size-3.5 text-muted-foreground" />
                    </div>
                    <div class="flex flex-col gap-0.5 min-w-0">
                      <span class="text-sm font-medium truncate">{form.name}</span>
                      {#if form.packageId}
                        <span class="inline-flex w-fit items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          <Zap class="size-2.5" />
                          {form.packageName ?? 'Automation linked'}
                        </span>
                      {/if}
                      {#if form.description}
                        <span class="text-xs text-muted-foreground truncate">{form.description}</span>
                      {/if}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-xs text-muted-foreground hidden sm:block">
                      Updated {new Date(form.updatedAt).toLocaleDateString()}
                    </span>
                    {#if canManage}
                      <Button
                        size="sm"
                        variant="outline"
                        class="gap-1.5 h-8"
                        onclick={() => goto('/setup/integrations/mspagent/forms?id=' + form.id)}
                      >
                        <Pencil class="size-3.5" />
                        Edit
                      </Button>
                    {/if}
                    {#if canDelete}
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onclick={() => (deleteFormId = form.id)}
                        title="Delete form"
                      >
                        <Trash2 class="size-3.5" />
                      </Button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </Tabs.Content>

      <!-- ── Webhooks tab ──────────────────────────────────────────────────── -->
      <Tabs.Content value="webhooks" class="flex flex-col flex-1 min-h-0 mt-4 gap-4 overflow-y-auto">
        <div class="flex flex-col gap-0.5 shrink-0">
          <h2 class="text-sm font-semibold">Webhooks</h2>
          <p class="text-xs text-muted-foreground">
            Configure your PSA to notify agents when a technician adds a note, so end users see replies instantly.
          </p>
        </div>

        {#if !canManage}
          <p class="text-sm text-muted-foreground">Agents.Write permission required to view webhook secrets.</p>
        {:else if webhookSecretQuery.isLoading}
          <Loader />
        {:else if !webhookSecretQuery.data}
          <div class="flex items-start gap-3 px-4 py-3 rounded-lg border bg-muted/30 max-w-xl">
            <TriangleAlert class="size-4 text-warning shrink-0 mt-0.5" />
            <p class="text-sm text-muted-foreground">
              Webhook signing is not configured. Set <code class="font-mono text-xs bg-muted px-1 py-0.5 rounded">AGENTS_INTERNAL_SECRET</code> and <code class="font-mono text-xs bg-muted px-1 py-0.5 rounded">AGENTS_INTERNAL_URL</code> in your agents backend environment.
            </p>
          </div>
        {:else}
          {@const wh = webhookSecretQuery.data}
          <div class="flex flex-col gap-6 max-w-xl">
            <!-- HaloPSA section -->
            <section class="flex flex-col gap-4 rounded-lg border p-5">
              <div class="flex flex-col gap-0.5">
                <p class="text-sm font-semibold">HaloPSA</p>
                <p class="text-xs text-muted-foreground">
                  In HaloPSA, go to <strong>Configuration → Integrations → Webhooks</strong>, create a new webhook on the Action event, and use the values below.
                </p>
              </div>

              <!-- Webhook URL -->
              <div class="flex flex-col gap-1.5">
                <Label>Webhook URL</Label>
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-md border truncate select-all">
                    {wh.url}
                  </code>
                  <button
                    onclick={() => copyWebhookField('url', wh.url)}
                    class="shrink-0 flex items-center justify-center size-8 rounded-md border hover:bg-muted transition-colors"
                    title="Copy URL"
                  >
                    {#if copiedWebhookField === 'url'}
                      <Check class="size-3.5 text-emerald-500" />
                    {:else}
                      <Copy class="size-3.5 text-muted-foreground" />
                    {/if}
                  </button>
                </div>
              </div>

              <!-- Secret header -->
              <div class="flex flex-col gap-1.5">
                <Label>Custom header</Label>
                <div class="grid grid-cols-[1fr_1.5fr_auto] gap-2 items-center">
                  <code class="text-xs font-mono bg-muted px-3 py-2 rounded-md border truncate">X-Internal-Secret</code>
                  <div class="flex items-center gap-1 bg-muted px-3 py-2 rounded-md border overflow-hidden">
                    <code class="text-xs font-mono flex-1 truncate select-all">
                      {webhookSecretVisible ? wh.secret : '••••••••••••••••••••••••••••••••'}
                    </code>
                    <button
                      onclick={() => (webhookSecretVisible = !webhookSecretVisible)}
                      class="shrink-0 text-muted-foreground hover:text-foreground transition-colors ml-1"
                      title={webhookSecretVisible ? 'Hide' : 'Reveal'}
                    >
                      {#if webhookSecretVisible}
                        <EyeOff class="size-3.5" />
                      {:else}
                        <Eye class="size-3.5" />
                      {/if}
                    </button>
                  </div>
                  <button
                    onclick={() => copyWebhookField('secret', wh.secret)}
                    class="shrink-0 flex items-center justify-center size-8 rounded-md border hover:bg-muted transition-colors"
                    title="Copy secret"
                  >
                    {#if copiedWebhookField === 'secret'}
                      <Check class="size-3.5 text-emerald-500" />
                    {:else}
                      <Copy class="size-3.5 text-muted-foreground" />
                    {/if}
                  </button>
                </div>
                <p class="text-[11px] text-muted-foreground">This secret is unique to your organisation. Add it as a custom header in HaloPSA's webhook configuration.</p>
              </div>
            </section>
          </div>
        {/if}
      </Tabs.Content>

    </Tabs.Root>

  {:else}
    <div class="flex flex-col size-full justify-center items-center">
      <div class="flex items-center gap-3 px-4 py-3 w-fit rounded bg-warning/10 text-warning border border-warning/30">
        <TriangleAlert class="size-4" />
        <span class="text-sm">
          MSPAgent is not configured. Click <strong>Integration Settings</strong> to set up.
        </span>
      </div>
    </div>
  {/if}
</div>
