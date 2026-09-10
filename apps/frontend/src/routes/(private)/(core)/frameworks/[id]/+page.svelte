<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    Plus,
    Save,
    Trash2,
    Undo2,
    X,
    ArrowLeft,
    Layers,
    CircleCheck,
    ListChecks,
    MapPin,
    Settings,
  } from '@lucide/svelte';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import UnsavedChanges from '../_components/unsaved-changes.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import ConfirmDialog from '$lib/components/fields/confirm-dialog.svelte';

  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id ?? '');
  const canManage = $derived(authStore.isAllowed('Frameworks.Write'));
  const canMap = $derived(authStore.isAllowed('Policies.Write'));
  const canReadPolicies = $derived(authStore.isAllowed('Policies.Read'));
  const canReadFindings = $derived(authStore.isAllowed('Findings.Read'));
  const tab = $derived(
    ['policies', 'mappings', 'findings', 'settings'].includes(
      page.url.searchParams.get('tab') ?? ''
    )
      ? page.url.searchParams.get('tab')!
      : 'policies'
  );
  function changeTab(value: string) {
    if (value === tab) return;
    if (value === 'settings' && tab !== 'settings') returnTab = tab;
    const url = new URL(page.url);
    url.searchParams.set('tab', value);
    void goto(url, { noScroll: true, keepFocus: true });
  }
  let returnTab = $state('policies');
  let policySearch = $state('');
  let policySheetOpen = $state(false);
  let mappingSheetOpen = $state(false);
  const frameworkQuery = createQuery(() => ({
    queryKey: ['frameworks.byId', id],
    queryFn: () => trpc.frameworks.byId.query({ id }),
  }));
  const policiesQuery = createQuery(() => ({
    queryKey: ['policies.list'],
    queryFn: () => trpc.policies.list.query(),
    enabled: canReadPolicies && canManage && !!frameworkQuery.data && tab === 'policies',
  }));
  const assignmentsQuery = createQuery(() => ({
    queryKey: ['policies.listAssignments', { policySetId: id }],
    queryFn: () => trpc.policies.listAssignments.query({ policySetId: id }),
    enabled: canReadPolicies && !!frameworkQuery.data,
  }));
  const assignmentOptionsQuery = createQuery(() => ({
    queryKey: ['policies.assignmentOptions'],
    queryFn: () => trpc.policies.assignmentOptions.query(),
    enabled: canReadPolicies && canMap && mappingSheetOpen && !!frameworkQuery.data,
  }));
  const findingsQuery = createQuery(() => ({
    queryKey: ['findings.list', { policySetId: id }],
    queryFn: () => trpc.findings.list.query({ policySetId: id }),
    enabled: canReadFindings && tab === 'findings' && !!frameworkQuery.data,
  }));

  const visiblePolicies = $derived(
    (frameworkQuery.data?.containedPolicies ?? []).filter((policy) =>
      `${policy.name} ${policy.category ?? ''}`
        .toLowerCase()
        .includes(policySearch.trim().toLowerCase())
    )
  );
  const assignments = $derived(assignmentsQuery.data ?? []);
  const activeMappings = $derived(assignments.filter((assignment) => assignment.enabled).length);
  const findings = $derived(
    (findingsQuery.data ?? []).filter((finding) =>
      ['open', 'acknowledged', 'regressed'].includes(finding.status)
    )
  );

  // Policies not yet in this framework
  const addablePolicyOptions = $derived.by(() => {
    const framework = frameworkQuery.data;
    const all = policiesQuery.data ?? [];
    const current = new Set(framework?.policies ?? []);
    return all
      .filter((p) => !current.has(p.id))
      .map((p) => ({ value: p.id, label: p.name, subLabel: p.description || undefined }));
  });

  // --- Identity edit state --------------------------------------------------
  let loadedIdentityFor = $state('');
  let nameDraft = $state('');
  let descriptionDraft = $state('');
  let categoryDraft = $state('');
  let enabledDraft = $state(true);
  let savingIdentity = $state(false);

  // --- Policy membership state ----------------------------------------------
  let addingPolicyIds = $state<string[]>([]);
  let savingMembership = $state(false);
  let removingPolicyId = $state<string | null>(null);

  // --- Mapping form state ---------------------------------------------------
  let scopeType = $state<'global' | 'site' | 'site_group' | 'integration_link'>('site');
  let targetId = $state('');
  let assignmentEnabled = $state(true);
  let savingAssignment = $state(false);
  let deletingAssignmentId = $state<string | null>(null);

  // --- Delete state ---------------------------------------------------------
  let deletingFramework = $state(false);

  const scopeOptions = [
    { value: 'global', label: 'Global — every site' },
    { value: 'site', label: 'Site' },
    { value: 'site_group', label: 'Site group' },
    { value: 'integration_link', label: 'Integration link' },
  ];

  const targetOptions = $derived.by(() => {
    const data = assignmentOptionsQuery.data;
    if (!data) return [];
    if (scopeType === 'site') return data.sites.map((s) => ({ value: s.id, label: s.name }));
    if (scopeType === 'site_group')
      return data.siteGroups.map((g) => ({ value: g.id, label: g.name }));
    if (scopeType === 'integration_link')
      return data.links.map((l) => ({
        value: l.id,
        label: `${l.name ?? l.id} (${l.integrationId})`,
      }));
    return [];
  });

  // --- Hydrate drafts when framework loads ---------------------------------
  $effect(() => {
    const framework = frameworkQuery.data;
    if (!framework) return;
    if (loadedIdentityFor !== framework.id) {
      nameDraft = framework.name;
      descriptionDraft = framework.description ?? '';
      categoryDraft = framework.category ?? '';
      enabledDraft = framework.enabled;
      addingPolicyIds = [];
      policySearch = '';
      scopeType = 'site';
      targetId = '';
      assignmentEnabled = true;
      loadedIdentityFor = framework.id;
    }
  });

  const identityDirty = $derived.by(() => {
    const framework = frameworkQuery.data;
    if (!framework || loadedIdentityFor !== framework.id) return false;
    return (
      nameDraft.trim() !== framework.name ||
      descriptionDraft !== (framework.description ?? '') ||
      categoryDraft !== (framework.category ?? '') ||
      enabledDraft !== framework.enabled
    );
  });

  async function refreshFramework() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['frameworks.byId', id] }),
      queryClient.invalidateQueries({ queryKey: ['frameworks.list'] }),
      queryClient.invalidateQueries({ queryKey: ['frameworks.tableData'] }),
    ]);
  }

  async function refreshAssignments() {
    await queryClient.invalidateQueries({
      queryKey: ['policies.listAssignments', { policySetId: id }],
    });
  }

  function discardIdentity() {
    const framework = frameworkQuery.data;
    if (!framework) return;
    nameDraft = framework.name;
    descriptionDraft = framework.description ?? '';
    categoryDraft = framework.category ?? '';
    enabledDraft = framework.enabled;
  }

  async function saveIdentity() {
    const framework = frameworkQuery.data;
    if (!framework || savingIdentity || !canManage) return;
    const name = nameDraft.trim();
    if (!name) {
      toast.error('Framework name cannot be empty');
      return;
    }
    savingIdentity = true;
    try {
      await trpc.frameworks.update.mutate({
        id: framework.id,
        name,
        description: descriptionDraft.trim() ? descriptionDraft.trim() : null,
        category: categoryDraft.trim() ? categoryDraft.trim() : null,
        providerId: framework.providerId,
        enabled: enabledDraft,
      });
      await refreshFramework();
      discardIdentity();
      toast.success('Framework updated');
    } catch (error) {
      showErrorToast(error, 'Failed to update framework.');
    } finally {
      savingIdentity = false;
    }
  }

  async function addPolicy() {
    const framework = frameworkQuery.data;
    if (!framework || !addingPolicyIds.length || savingMembership || removingPolicyId || !canManage)
      return;
    savingMembership = true;
    try {
      const next = [...new Set([...(framework.policies ?? []), ...addingPolicyIds])];
      await trpc.frameworks.setPolicies.mutate({ policySetId: id, policyIds: next });
      addingPolicyIds = [];
      await refreshFramework();
      await queryClient.invalidateQueries({ queryKey: ['findings.list', { policySetId: id }] });
      policySheetOpen = false;
      toast.success('Policies added');
    } catch (error) {
      showErrorToast(error, 'Failed to add policy.');
    } finally {
      savingMembership = false;
    }
  }

  async function removePolicy(policyId: string) {
    const framework = frameworkQuery.data;
    if (!framework || savingMembership || removingPolicyId || !canManage) return;
    removingPolicyId = policyId;
    try {
      const next = (framework.policies ?? []).filter((pid) => pid !== policyId);
      await trpc.frameworks.setPolicies.mutate({ policySetId: id, policyIds: next });
      await refreshFramework();
      await queryClient.invalidateQueries({ queryKey: ['findings.list', { policySetId: id }] });
      toast.success('Policy removed');
    } catch (error) {
      showErrorToast(error, 'Failed to remove policy.');
    } finally {
      removingPolicyId = null;
    }
  }

  async function saveAssignment() {
    if (
      savingAssignment ||
      !canMap ||
      !canReadPolicies ||
      assignmentsQuery.isError ||
      !assignmentsQuery.data ||
      duplicateMapping
    )
      return;
    if (scopeType !== 'global' && !targetOptions.some((option) => option.value === targetId)) {
      toast.error('Choose an assignment target');
      return;
    }
    savingAssignment = true;
    try {
      await trpc.policies.createAssignment.mutate({
        subjectType: 'policy_set',
        policyId: null,
        policySetId: id,
        scopeType,
        siteId: scopeType === 'site' ? targetId : null,
        siteGroupId: scopeType === 'site_group' ? targetId : null,
        linkId: scopeType === 'integration_link' ? targetId : null,
        enabled: assignmentEnabled,
        parameters: {},
      });
      targetId = '';
      scopeType = 'site';
      assignmentEnabled = true;
      await refreshAssignments();
      mappingSheetOpen = false;
      toast.success('Mapping added');
    } catch (error) {
      showErrorToast(error, 'Failed to add mapping.');
    } finally {
      savingAssignment = false;
    }
  }

  async function deleteAssignment(assignmentId: string) {
    if (deletingAssignmentId || savingAssignment || !canMap) return;
    deletingAssignmentId = assignmentId;
    try {
      await trpc.policies.deleteAssignment.mutate({ id: assignmentId });
      await refreshAssignments();
      toast.success('Mapping removed');
    } catch {
      toast.error('Failed to remove mapping');
    } finally {
      deletingAssignmentId = null;
    }
  }

  async function deleteFramework() {
    if (deletingFramework || !canManage) return;
    deletingFramework = true;
    try {
      await trpc.frameworks.delete.mutate({ id });
      addingPolicyIds = [];
      scopeType = 'site';
      targetId = '';
      assignmentEnabled = true;
      discardIdentity();
      await queryClient.invalidateQueries({ queryKey: ['frameworks.tableData'] });
      toast.success('Framework deleted');
      await goto('/frameworks');
    } catch (error) {
      showErrorToast(error, 'Failed to delete framework.');
      deletingFramework = false;
    }
  }

  function assignmentLabel(assignment: {
    scopeType: string;
    siteName: string | null;
    siteGroupName: string | null;
    linkName: string | null;
  }): string {
    if (assignment.scopeType === 'global') return 'Every site';
    return (
      assignment.siteName ?? assignment.siteGroupName ?? assignment.linkName ?? 'Unnamed target'
    );
  }

  const duplicateMapping = $derived(
    assignments.some(
      (assignment) =>
        assignment.scopeType === scopeType &&
        (scopeType === 'global' ||
          (scopeType === 'site'
            ? assignment.siteId
            : scopeType === 'site_group'
              ? assignment.siteGroupId
              : assignment.linkId) === targetId)
    )
  );
  const membershipBusy = $derived(savingMembership || removingPolicyId !== null);
</script>

{#snippet policyPicker()}
  <Sheet.Root bind:open={policySheetOpen}>
    <Sheet.Trigger
      >{#snippet child({ props })}<Button {...props}
          ><Plus class="size-4" />Add policies{#if addingPolicyIds.length}<span class="opacity-70"
              >({addingPolicyIds.length})</span
            >{/if}</Button
        >{/snippet}</Sheet.Trigger
    >
    <Sheet.Content
      class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      onInteractOutside={(event) => {
        if (membershipBusy) event.preventDefault();
      }}
      onEscapeKeydown={(event) => {
        if (membershipBusy) event.preventDefault();
      }}
    >
      <Sheet.Header class="border-b p-6"
        ><Sheet.Title>Add policies</Sheet.Title><Sheet.Description
          >Select existing checks for {frameworkQuery.data?.name}. Policies can be shared across
          frameworks.</Sheet.Description
        ></Sheet.Header
      >
      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        {#if policiesQuery.isError}<div class="mb-5 text-sm" role="alert">
            Available policies couldn’t be loaded. <Button
              size="sm"
              variant="link"
              onclick={() => policiesQuery.refetch()}>Try again</Button
            >
          </div>
        {:else}<div class="space-y-4">
            <div class="grid gap-4">
              <div class="min-w-0 flex-1">
                <MultiSelect
                  aria-label="Policies to add"
                  options={addablePolicyOptions}
                  bind:selected={addingPolicyIds}
                  placeholder={policiesQuery.isPending
                    ? 'Loading policies…'
                    : 'Choose policies to add…'}
                  searchPlaceholder="Search available policies…"
                  loading={policiesQuery.isPending}
                  disabled={membershipBusy ||
                    policiesQuery.isPending ||
                    !addablePolicyOptions.length}
                />
              </div>
            </div>
            <p class="mt-2 text-xs leading-6 text-muted-foreground">
              {!policiesQuery.isPending && !addablePolicyOptions.length
                ? policiesQuery.data?.length
                  ? 'All available policies are already in this framework.'
                  : 'No policies are available yet. Add a policy in the policy library first.'
                : 'Select several policies and add them together.'}
            </p>
          </div>{/if}

        {#if addingPolicyIds.length}<div class="mt-6">
            <h3 class="mb-2 text-xs font-medium">Selected policies</h3>
            <ul class="divide-y rounded-lg border px-3">
              {#each addablePolicyOptions.filter( (option) => addingPolicyIds.includes(option.value) ) as option}<li
                  class="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span>{option.label}</span><Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Deselect ${option.label}`}
                    disabled={membershipBusy}
                    onclick={() =>
                      (addingPolicyIds = addingPolicyIds.filter((id) => id !== option.value))}
                    ><X class="size-3.5" /></Button
                  >
                </li>{/each}
            </ul>
          </div>{/if}
      </div>
      <Sheet.Footer class="flex-row items-center justify-between gap-3 border-t p-4"
        ><span class="text-xs text-muted-foreground">{addingPolicyIds.length} selected</span>
        <div class="ml-auto flex gap-2">
          <Sheet.Close
            >{#snippet child({ props })}<Button
                {...props}
                variant="outline"
                disabled={membershipBusy}>Close</Button
              >{/snippet}</Sheet.Close
          ><Button onclick={addPolicy} disabled={!addingPolicyIds.length || membershipBusy}
            >{savingMembership
              ? 'Adding…'
              : `Add${addingPolicyIds.length ? ` ${addingPolicyIds.length}` : ''}`}<Plus
              class="size-4"
            /></Button
          >
        </div></Sheet.Footer
      >
    </Sheet.Content>
  </Sheet.Root>
{/snippet}
{#snippet mappingPicker()}
  <Sheet.Root bind:open={mappingSheetOpen}>
    <Sheet.Trigger
      >{#snippet child({ props })}<Button {...props}><Plus class="size-4" />Add mapping</Button
        >{/snippet}</Sheet.Trigger
    >
    <Sheet.Content
      class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      onInteractOutside={(event) => {
        if (savingAssignment) event.preventDefault();
      }}
      onEscapeKeydown={(event) => {
        if (savingAssignment) event.preventDefault();
      }}
    >
      <Sheet.Header class="border-b p-6"
        ><Sheet.Title>Add mapping</Sheet.Title><Sheet.Description
          >Choose where {frameworkQuery.data?.name} applies. Each mapping includes all its policies.</Sheet.Description
        ></Sheet.Header
      >
      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        <div class="framework-form">
          <div class="framework-field">
            <span>Scope</span><SingleSelect
              options={scopeOptions}
              bind:selected={scopeType}
              allowClear={false}
              aria-label="Mapping scope"
              disabled={savingAssignment}
              onchange={() => (targetId = '')}
            />
          </div>
          {#if scopeType !== 'global'}<div class="framework-field">
              <span>Target</span><SingleSelect
                options={targetOptions}
                bind:selected={targetId}
                aria-label="Mapping target"
                placeholder="Choose target…"
                loading={assignmentOptionsQuery.isPending}
                disabled={savingAssignment ||
                  assignmentOptionsQuery.isPending ||
                  assignmentOptionsQuery.isError}
              />{#if assignmentOptionsQuery.isError}<small role="alert"
                  >Targets couldn’t be loaded. <Button
                    variant="link"
                    size="xs"
                    onclick={() => assignmentOptionsQuery.refetch()}>Try again</Button
                  ></small
                >{:else if assignmentOptionsQuery.isSuccess && !targetOptions.length}<small
                  >No targets are available for this scope. Choose another scope or configure a
                  target first.</small
                >{/if}
            </div>{:else}<p
              class="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-6"
            >
              This mapping applies to every site, including sites added in the future.
            </p>{/if}
          <div class="framework-toggle">
            <div>
              <strong id="mapping-enabled-label">Enable mapping</strong>
              <p>Apply it as soon as it is saved.</p>
            </div>
            <Switch
              bind:checked={assignmentEnabled}
              aria-labelledby="mapping-enabled-label"
              disabled={savingAssignment}
            />
          </div>
          {#if duplicateMapping}<p class="text-xs leading-6 text-muted-foreground" role="status">
              A mapping already exists for this target. Remove the existing mapping before replacing
              it.
            </p>{/if}
        </div>
      </div>
      <Sheet.Footer class="flex-row items-center justify-between gap-3 border-t p-4"
        ><div class="ml-auto flex gap-2">
          <Sheet.Close
            >{#snippet child({ props })}<Button
                {...props}
                variant="outline"
                disabled={savingAssignment}>Close</Button
              >{/snippet}</Sheet.Close
          ><Button
            onclick={saveAssignment}
            disabled={savingAssignment ||
              !!deletingAssignmentId ||
              assignmentsQuery.isPending ||
              assignmentsQuery.isError ||
              duplicateMapping ||
              (scopeType !== 'global' &&
                (!targetOptions.some((option) => option.value === targetId) ||
                  assignmentOptionsQuery.isError))}
            ><Plus class="size-4" />{savingAssignment ? 'Adding mapping…' : 'Add mapping'}</Button
          >
        </div></Sheet.Footer
      >
    </Sheet.Content>
  </Sheet.Root>
{/snippet}

{#snippet frameworkSettings()}
  <Sheet.Root
    open={tab === 'settings'}
    onOpenChange={(open) => {
      if (!open) changeTab(returnTab);
    }}
  >
    <Sheet.Content
      class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      showCloseButton={!savingIdentity}
      onInteractOutside={(event) => {
        if (savingIdentity) event.preventDefault();
      }}
      onEscapeKeydown={(event) => {
        if (savingIdentity) event.preventDefault();
      }}
    >
      <Sheet.Header class="border-b p-6"
        ><Sheet.Title>Framework settings</Sheet.Title><Sheet.Description
          >{canManage
            ? 'Update the details and evaluation status of this framework.'
            : 'You have view access to this framework.'}</Sheet.Description
        ></Sheet.Header
      >
      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        {#if frameworkQuery.data}{@const framework = frameworkQuery.data}
          <form
            id="framework-settings"
            class="framework-form"
            onsubmit={(event) => {
              event.preventDefault();
              void saveIdentity();
            }}
          >
            <fieldset
              disabled={!canManage || savingIdentity || deletingFramework}
              class="grid gap-5"
            >
              <label class="framework-field"
                >Name<Input bind:value={nameDraft} required placeholder="Framework name" /></label
              ><label class="framework-field"
                >Category<Input
                  bind:value={categoryDraft}
                  placeholder="e.g. Security, Compliance, Baseline"
                /></label
              ><label class="framework-field"
                >Description<Textarea
                  bind:value={descriptionDraft}
                  rows={4}
                  placeholder="What does this framework check, and who is it for?"
                /></label
              >
              <div class="framework-toggle">
                <div>
                  <strong id="framework-enabled-label">Enable framework</strong>
                  <p>
                    {enabledDraft
                      ? 'Enabled policies can evaluate against enabled mappings.'
                      : 'This framework is disabled. Its policies and mappings are kept for later use.'}
                  </p>
                </div>
                <Switch bind:checked={enabledDraft} aria-labelledby="framework-enabled-label" />
              </div>
            </fieldset>
          </form>
          <div class="mt-6 space-y-5">
            <section class="border-t pt-5">
              <div class="framework-panel-header"><h2>About this framework</h2></div>
              <dl class="framework-meta">
                <div>
                  <dt>Source</dt>
                  <dd>{prettyText(framework.source)}</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd>{framework.providerName || 'Not specified'}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{framework.version || '—'}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatRelativeDate(framework.createdAt)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatRelativeDate(framework.updatedAt)}</dd>
                </div>
              </dl>
            </section>
            {#if canManage && framework.source === 'custom'}<section class="border-t pt-5">
                <h2>Delete framework</h2>
                <p class="framework-description mb-4">
                  Permanently remove this framework and its mappings. The policies themselves remain
                  in your library.
                </p>
                <ConfirmDialog
                  title="Delete framework?"
                  description={`Permanently delete “${framework.name}” and all its mappings? This cannot be undone. Its policies will remain; existing findings are not closed automatically.`}
                  confirmLabel="Delete framework"
                  destructive
                  onconfirm={deleteFramework}
                  >{#snippet trigger(props)}<Button
                      {...props}
                      variant="destructive"
                      disabled={deletingFramework ||
                        savingIdentity ||
                        membershipBusy ||
                        savingAssignment}
                      ><Trash2 class="size-4" />{deletingFramework
                        ? 'Deleting…'
                        : 'Delete framework'}</Button
                    >{/snippet}</ConfirmDialog
                >
              </section>{/if}
          </div>{/if}
      </div>
      <Sheet.Footer class="border-t p-4">
        {#if canManage}<div
            class="flex w-full flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
          >
            <span role="status"
              >{savingIdentity
                ? 'Saving changes…'
                : identityDirty
                  ? 'You have unsaved changes'
                  : 'All changes saved'}</span
            >
            <div class="flex gap-2">
              <Button
                variant="outline"
                onclick={discardIdentity}
                disabled={!identityDirty || savingIdentity}><Undo2 class="size-4" />Discard</Button
              ><Button
                type="submit"
                form="framework-settings"
                disabled={!identityDirty || !nameDraft.trim() || savingIdentity}
                ><Save class="size-4" />{savingIdentity ? 'Saving…' : 'Save changes'}</Button
              >
            </div>
          </div>{/if}</Sheet.Footer
      >
    </Sheet.Content>
  </Sheet.Root>
{/snippet}

<svelte:head><title>{frameworkQuery.data?.name ?? 'Framework'} · MSPByte</title></svelte:head>
<UnsavedChanges
  dirty={identityDirty ||
    addingPolicyIds.length > 0 ||
    scopeType !== 'site' ||
    !!targetId ||
    !assignmentEnabled}
  busy={savingIdentity || membershipBusy || savingAssignment || !!deletingAssignmentId}
/>
<div class="size-full overflow-auto">
  <div class="framework-page framework-detail">
    <a
      href="/frameworks"
      class="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
      ><ArrowLeft class="size-3.5" />Framework library</a
    >
    {#if frameworkQuery.isError}
      <div class="framework-state" role="alert">
        <h1 class="text-xl font-semibold">Framework unavailable</h1>
        <p>
          This framework may have been removed, or you may not have access. Try again or return to
          the library.
        </p>
        <Button variant="outline" onclick={() => frameworkQuery.refetch()}>Try again</Button>
      </div>
    {:else if !frameworkQuery.data}
      <div class="framework-state" role="status">
        <Layers class="size-6 text-primary" />
        <p>Loading framework…</p>
      </div>
    {:else}
      {@const framework = frameworkQuery.data}
      <header class="framework-heading framework-detail-heading">
        <div>
          <p class="framework-eyebrow">{framework.category || 'Policy framework'}</p>
          <h1>{framework.name}</h1>
          {#if framework.description}<p class="framework-description">
              {framework.description}
            </p>{/if}
          <div
            class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
          >
            <span class="inline-flex items-center gap-1.5"
              ><ListChecks class="size-3.5" />{framework.policyCount}
              {framework.policyCount === 1 ? 'policy' : 'policies'}</span
            >
            <button
              class="inline-flex items-center gap-1.5 hover:text-primary"
              onclick={() => changeTab('mappings')}
              ><MapPin class="size-3.5" />{!canReadPolicies
                ? 'Review mappings'
                : assignmentsQuery.isError
                  ? 'Mappings unavailable'
                  : assignmentsQuery.isPending
                    ? 'Loading mappings…'
                    : `${activeMappings} enabled ${activeMappings === 1 ? 'mapping' : 'mappings'}`}</button
            >
            <span>Updated {formatRelativeDate(framework.updatedAt)}</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant={framework.enabled ? 'secondary' : 'outline'}
            >{framework.enabled ? 'Enabled' : 'Disabled'}</Badge
          >
          <Button variant="outline" size="sm" onclick={() => changeTab('settings')}
            ><Settings class="size-3.5" />Framework settings{#if identityDirty}<span
                class="size-1.5 rounded-full bg-warning"
                aria-label="Unsaved changes"
              ></span>{/if}</Button
          >
        </div>
      </header>
      {#if !framework.policyCount || !framework.enabled || (canReadPolicies && assignmentsQuery.isSuccess && !activeMappings)}
        <div
          class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 text-xs"
        >
          <span
            >{!framework.policyCount
              ? 'This framework has no policies yet.'
              : !framework.enabled
                ? 'This framework is disabled.'
                : 'No enabled mappings. This framework isn’t assigned to a scope yet.'}</span
          >
          <Button
            variant="link"
            size="xs"
            class="h-auto p-0"
            onclick={() => {
              if (!framework.policyCount) {
                changeTab('policies');
                if (canManage && canReadPolicies) policySheetOpen = true;
              } else if (!framework.enabled) changeTab('settings');
              else {
                changeTab('mappings');
                if (canMap) mappingSheetOpen = true;
              }
            }}
            >{!framework.policyCount
              ? 'Add policies'
              : !framework.enabled
                ? 'Review settings'
                : 'Add mapping'}<ArrowUpRight class="size-3" /></Button
          >
        </div>
      {/if}
      <Tabs.Root value={tab === 'settings' ? 'policies' : tab} onValueChange={changeTab}>
        <div class="framework-tabs">
          <Tabs.List variant="line" class="h-auto min-w-max gap-4 border-b bg-transparent p-0">
            <Tabs.Trigger
              value="policies"
              class="rounded-none px-1 py-3 data-[state=active]:text-primary"
              >Policies <span class="ml-1 text-xs text-muted-foreground"
                >{framework.policyCount}</span
              ></Tabs.Trigger
            >
            <Tabs.Trigger
              value="mappings"
              class="rounded-none px-1 py-3 data-[state=active]:text-primary"
              >Mappings {#if canReadPolicies && assignmentsQuery.isSuccess}<span
                  class="ml-1 text-xs text-muted-foreground">{assignments.length}</span
                >{/if}</Tabs.Trigger
            >
            <Tabs.Trigger
              value="findings"
              class="rounded-none px-1 py-3 data-[state=active]:text-primary">Findings</Tabs.Trigger
            >
          </Tabs.List>
        </div>
        <Tabs.Content value="policies">
          <div class="min-w-0">
            <section class="framework-list-panel">
              <div class="framework-panel-header">
                <div>
                  <h2>Policies in this framework</h2>
                  <p>Checks included in this standard. Changes to membership save immediately.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  {#if framework.containedPolicies.length}
                    <Input
                      aria-label="Search policies in framework"
                      placeholder="Search policies in this framework…"
                      bind:value={policySearch}
                      class="w-full sm:w-64"
                    />
                  {/if}{#if canManage && canReadPolicies}{@render policyPicker()}{/if}
                </div>
              </div>
              {#if framework.containedPolicies.length}
                <div class="framework-records">
                  {#each visiblePolicies as policy (policy.id)}
                    <div class="framework-row">
                      <div class="min-w-0 flex-1">
                        <a class="framework-row-title" href={`/policies/${policy.id}`}
                          >{policy.name}</a
                        >
                        <p>
                          {policy.category || 'Uncategorized'} · {prettyText(
                            policy.scope
                          )}{!policy.enabled ? ' · Disabled' : ''}
                        </p>
                        {#if policy.expectation}<p class="line-clamp-2">
                            {policy.expectation}
                          </p>{/if}
                      </div>
                      <div class="flex items-center gap-2">
                        <FindingSeverityBadge
                          severity={policy.severity}
                        />{#if canManage}<ConfirmDialog
                            title="Remove policy from framework?"
                            description={`Remove “${policy.name}” from this framework? The policy itself will remain available in your policy library.`}
                            confirmLabel="Remove policy"
                            onconfirm={() => removePolicy(policy.id)}
                            >{#snippet trigger(props)}<Button
                                {...props}
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${policy.name}`}
                                disabled={membershipBusy}><X class="size-4" /></Button
                              >{/snippet}</ConfirmDialog
                          >{/if}<a
                          href={`/policies/${policy.id}`}
                          aria-label={`Open ${policy.name}`}
                          class="p-2 text-muted-foreground"><ArrowUpRight class="size-4" /></a
                        >
                      </div>
                    </div>
                  {:else}<div class="framework-state">
                      <h3>No matching policies</h3>
                      <p>Try a different name or category.</p>
                      <Button variant="outline" onclick={() => (policySearch = '')}
                        >Clear search</Button
                      >
                    </div>{/each}
                </div>
              {:else}<div class="framework-state">
                  <span class="framework-icon"><ListChecks class="size-5" /></span>
                  <h3>Choose the checks for this standard</h3>
                  <p>
                    {canManage && canReadPolicies
                      ? 'Use Add policies to choose existing checks. A policy can be reused across frameworks.'
                      : 'A team member with framework management access can add policies here.'}
                  </p>
                  {#if canReadPolicies}<Button variant="outline" href="/policies"
                      >Browse policy library<ArrowUpRight class="size-4" /></Button
                    >{/if}
                </div>{/if}
            </section>
          </div>
        </Tabs.Content>
        <Tabs.Content value="mappings">
          {#if !canReadPolicies}<div class="framework-state">
              <h2>Mapping access required</h2>
              <p>You need permission to read policies to view framework mappings.</p>
            </div>
          {:else}<div class="min-w-0">
              <section class="framework-list-panel">
                <div class="framework-panel-header">
                  <div>
                    <h2>Where this framework applies</h2>
                    <p>
                      {assignmentsQuery.isSuccess
                        ? `${activeMappings} enabled of ${assignments.length} mappings. `
                        : ''}A mapping connects every policy in this framework to a scope.
                    </p>
                  </div>
                  {#if canMap}{@render mappingPicker()}{/if}
                </div>
                <div class="framework-records">
                  {#if assignmentsQuery.isError}<div class="framework-state" role="alert">
                      <h3>Mappings couldn’t be loaded</h3>
                      <p>Try again before making changes.</p>
                      <Button variant="outline" onclick={() => assignmentsQuery.refetch()}
                        >Try again</Button
                      >
                    </div>
                  {:else if assignmentsQuery.isPending}<p
                      class="text-sm text-muted-foreground"
                      role="status"
                    >
                      Loading mappings…
                    </p>
                  {:else}{#each assignments as assignment (assignment.id)}<div
                        class="framework-row"
                      >
                        <div class="flex min-w-0 items-center gap-3">
                          <span class="framework-icon"><MapPin class="size-4" /></span>
                          <div class="min-w-0">
                            <div class="framework-row-title">{assignmentLabel(assignment)}</div>
                            <p>
                              {prettyText(assignment.scopeType)}{assignment.updatedAt
                                ? ` · Updated ${formatRelativeDate(assignment.updatedAt)}`
                                : ''}
                            </p>
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          <Badge variant={assignment.enabled ? 'secondary' : 'outline'}
                            >{assignment.enabled ? 'Enabled' : 'Disabled'}</Badge
                          >{#if canMap}<ConfirmDialog
                              title="Remove mapping?"
                              description={`This framework will no longer apply through the mapping to ${assignmentLabel(assignment)}. Other mappings will remain.`}
                              confirmLabel="Remove mapping"
                              destructive
                              onconfirm={() => deleteAssignment(assignment.id)}
                              >{#snippet trigger(props)}<Button
                                  {...props}
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Remove mapping to ${assignmentLabel(assignment)}`}
                                  disabled={!!deletingAssignmentId || savingAssignment}
                                  ><Trash2 class="size-4" /></Button
                                >{/snippet}</ConfirmDialog
                            >{/if}
                        </div>
                      </div>{:else}<div class="framework-state">
                        <span class="framework-icon"><MapPin class="size-5" /></span>
                        <h3>No mappings yet</h3>
                        <p>
                          Add a mapping to apply this framework to a site, a group of sites, an
                          integration, or every site.
                        </p>
                      </div>{/each}{/if}
                </div>
              </section>
            </div>{/if}
        </Tabs.Content>
        <Tabs.Content value="findings"
          ><section class="framework-list-panel">
            <div class="framework-panel-header">
              <div>
                <h2>Recent open findings</h2>
                <p>
                  Recent open, acknowledged, and regressed findings for policies in this framework.
                  Open the findings workspace for a complete review.
                </p>
              </div>
              {#if canReadFindings}<Button href="/findings" variant="outline" size="sm"
                  >Findings workspace<ArrowUpRight class="size-4" /></Button
                >{/if}
            </div>
            <div class="framework-records">
              {#if !canReadFindings}<div class="framework-state">
                  <h3>Finding access required</h3>
                  <p>You need permission to read findings to view results here.</p>
                </div>
              {:else if findingsQuery.isError}<div class="framework-state" role="alert">
                  <h3>Findings couldn’t be loaded</h3>
                  <p>Try again to check the latest results.</p>
                  <Button variant="outline" onclick={() => findingsQuery.refetch()}
                    >Try again</Button
                  >
                </div>
              {:else if findingsQuery.isPending}<p
                  class="text-sm text-muted-foreground"
                  role="status"
                >
                  Loading findings…
                </p>
              {:else}{#each findings as finding (finding.id)}<a
                    class="framework-row"
                    href={`/findings/${finding.id}`}
                    ><div class="min-w-0 flex-1">
                      <div class="framework-row-title">{finding.title}</div>
                      <p>
                        {finding.policyName || 'Policy'} · {finding.siteName ||
                          'Site unavailable'}{finding.lastSeenAt
                          ? ` · Last seen ${formatRelativeDate(finding.lastSeenAt)}`
                          : ''}
                      </p>
                      {#if finding.evidenceSummary}<p class="line-clamp-2">
                          {finding.evidenceSummary}
                        </p>{/if}
                    </div>
                    <div class="flex items-center gap-2">
                      <FindingSeverityBadge severity={finding.severity} /><FindingStatusBadge
                        status={finding.status}
                      /><ArrowUpRight class="size-4 text-muted-foreground" />
                    </div></a
                  >{:else}<div class="framework-state">
                    <span class="framework-icon"><CircleCheck class="size-5" /></span>
                    <h3>No open findings in this preview</h3>
                    <p>
                      Check the findings workspace for the full history. An empty preview doesn’t
                      confirm that every policy has been evaluated.
                    </p>
                  </div>{/each}{/if}
            </div>
          </section></Tabs.Content
        >
      </Tabs.Root>
      {@render frameworkSettings()}
    {/if}
  </div>
</div>
