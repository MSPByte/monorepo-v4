<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Plus, Save, Trash2, Undo2, X } from '@lucide/svelte';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import MetaRow from '$lib/components/panel/meta-row.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import ConfirmDialog from '$lib/components/fields/confirm-dialog.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';

  import FrameworkBriefing from './_components/framework-briefing.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id ?? '');

  const frameworkQuery = createQuery(() => ({
    queryKey: ['frameworks.byId', id],
    queryFn: () => trpc.frameworks.byId.query({ id })
  }));
  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query()
  }));
  const policiesQuery = createQuery(() => ({
    queryKey: ['policies.list'],
    queryFn: () => trpc.policies.list.query()
  }));
  const assignmentsQuery = createQuery(() => ({
    queryKey: ['policies.listAssignments', { policySetId: id }],
    queryFn: () => trpc.policies.listAssignments.query({ policySetId: id })
  }));
  const assignmentOptionsQuery = createQuery(() => ({
    queryKey: ['policies.assignmentOptions'],
    queryFn: () => trpc.policies.assignmentOptions.query()
  }));
  const findingsQuery = createQuery(() => ({
    queryKey: ['findings.list', { policySetId: id }],
    queryFn: () => trpc.findings.list.query({ policySetId: id })
  }));

  const siteName = (siteId: string) =>
    sitesQuery.data?.find((site) => site.id === siteId)?.name ?? siteId;

  // Policies not yet in this framework
  const addablePolicyOptions = $derived.by(() => {
    const framework = frameworkQuery.data;
    const all = policiesQuery.data ?? [];
    const current = new Set(framework?.policies ?? []);
    return all
      .filter((p) => !current.has(p.id))
      .map((p) => ({ value: p.id, label: p.name }));
  });

  // --- Identity edit state --------------------------------------------------
  let loadedIdentityFor = $state('');
  let nameDraft = $state('');
  let descriptionDraft = $state('');
  let categoryDraft = $state('');
  let enabledDraft = $state(true);
  let savingIdentity = $state(false);

  // --- Policy membership state ----------------------------------------------
  let addingPolicyId = $state('');
  let savingMembership = $state(false);
  let removingPolicyId = $state<string | null>(null);

  // --- Mapping form state ---------------------------------------------------
  let scopeType = $state<'global' | 'site' | 'site_group' | 'integration_link'>('global');
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
    { value: 'integration_link', label: 'Integration link' }
  ];

  const scopeShort: Record<string, string> = {
    global: 'GLOBAL',
    site: 'SITE',
    site_group: 'SITE·GROUP',
    integration_link: 'INTEGRATION'
  };

  const targetOptions = $derived.by(() => {
    const data = assignmentOptionsQuery.data;
    if (!data) return [];
    if (scopeType === 'site') return data.sites.map((s) => ({ value: s.id, label: s.name }));
    if (scopeType === 'site_group')
      return data.siteGroups.map((g) => ({ value: g.id, label: g.name }));
    if (scopeType === 'integration_link')
      return data.links.map((l) => ({
        value: l.id,
        label: `${l.name ?? l.id} (${l.integrationId})`
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
      loadedIdentityFor = framework.id;
    }
  });

  const identityDirty = $derived.by(() => {
    const framework = frameworkQuery.data;
    if (!framework) return false;
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
      queryClient.invalidateQueries({ queryKey: ['frameworks.list'] })
    ]);
  }

  async function refreshAssignments() {
    await queryClient.invalidateQueries({
      queryKey: ['policies.listAssignments', { policySetId: id }]
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
    if (!framework) return;
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
        enabled: enabledDraft
      });
      await refreshFramework();
      toast.success('Framework updated');
    } catch (error) {
      showErrorToast(error, 'Failed to update framework.');
    } finally {
      savingIdentity = false;
    }
  }

  async function addPolicy() {
    const framework = frameworkQuery.data;
    if (!framework || !addingPolicyId) return;
    savingMembership = true;
    try {
      const next = [...(framework.policies ?? []), addingPolicyId];
      await trpc.frameworks.setPolicies.mutate({ policySetId: id, policyIds: next });
      addingPolicyId = '';
      await refreshFramework();
      await queryClient.invalidateQueries({ queryKey: ['findings.list', { policySetId: id }] });
      toast.success('Policy added');
    } catch (error) {
      showErrorToast(error, 'Failed to add policy.');
    } finally {
      savingMembership = false;
    }
  }

  async function removePolicy(policyId: string) {
    const framework = frameworkQuery.data;
    if (!framework) return;
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
    if (scopeType !== 'global' && !targetId) {
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
        parameters: {}
      });
      targetId = '';
      scopeType = 'global';
      assignmentEnabled = true;
      await refreshAssignments();
      toast.success('Mapping added');
    } catch (error) {
      showErrorToast(error, 'Failed to add mapping.');
    } finally {
      savingAssignment = false;
    }
  }

  async function deleteAssignment(assignmentId: string) {
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
    deletingFramework = true;
    try {
      await trpc.frameworks.delete.mutate({ id });
      toast.success('Framework deleted');
      await goto('/frameworks');
    } catch (error) {
      showErrorToast(error, 'Failed to delete framework.');
      deletingFramework = false;
    }
  }

  function scopeDot(kind: string): string {
    if (kind === 'global') return 'bg-primary';
    if (kind === 'site') return 'bg-primary/70';
    if (kind === 'site_group') return 'bg-primary/50';
    if (kind === 'integration_link') return 'bg-primary/30';
    return 'bg-muted-foreground';
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
</script>

{#if frameworkQuery.data}
  {@const framework = frameworkQuery.data}
  {@const assignments = assignmentsQuery.data ?? []}
  {@const findings = findingsQuery.data ?? []}
  <FadeIn class="size-full overflow-auto">
    <FrameworkBriefing
      id={framework.id}
      name={framework.name}
      description={framework.description}
      category={framework.category}
      source={framework.source}
      providerName={framework.providerName}
      enabled={framework.enabled}
      policyCount={framework.policyCount}
      mappingCount={assignments.length}
      createdAt={framework.createdAt}
      updatedAt={framework.updatedAt}
    />

    <div class="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
      <!-- Top legend strip -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-card px-3 py-2"
      >
        <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          POLICY BUNDLE
          {#if framework.updatedAt}
            <span class="ml-2 text-foreground/70">·</span>
            <span class="ml-2">updated {formatRelativeDate(framework.updatedAt)}</span>
          {/if}
        </div>
        <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {framework.policyCount} polic{framework.policyCount === 1 ? 'y' : 'ies'} ·
          {assignments.length} mapping{assignments.length === 1 ? '' : 's'} ·
          {findings.length} open finding{findings.length === 1 ? '' : 's'}
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        <!-- LEFT COLUMN -->
        <div class="space-y-4">
          <SectionPanel code="01" title="IDENTITY">
            {#snippet aside()}
              {identityDirty ? 'unsaved changes' : 'editable'}
            {/snippet}
            <div class="space-y-4 text-sm">
              <div class="grid gap-4 md:grid-cols-2">
                <label class="space-y-1.5">
                  <span
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Name
                  </span>
                  <Input bind:value={nameDraft} placeholder="Framework name" />
                </label>
                <label class="space-y-1.5">
                  <span
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Category
                  </span>
                  <Input bind:value={categoryDraft} placeholder="e.g. Compliance, Baseline" />
                </label>
              </div>

              <label class="block space-y-1.5">
                <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Description
                </span>
                <Textarea
                  bind:value={descriptionDraft}
                  placeholder="What does this bundle enforce, and where does it apply?"
                  rows={3}
                />
              </label>

              <div
                class="flex items-center justify-between gap-3 border border-border/60 bg-muted/20 px-3 py-2"
              >
                <div>
                  <div
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Enabled
                  </div>
                  <div class="text-sm">
                    {enabledDraft
                      ? 'Contained policies evaluate against mapped scopes'
                      : 'Bundle is off — mappings and policies will not run'}
                  </div>
                </div>
                <Switch bind:checked={enabledDraft} />
              </div>

              {#if identityDirty}
                <div
                  class="flex items-center justify-between gap-3 border-t border-border/50 pt-3"
                >
                  <span
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    changes will be recorded to the audit log
                  </span>
                  <div class="flex items-center gap-2">
                    <Button variant="outline" onclick={discardIdentity} disabled={savingIdentity}>
                      <Undo2 class="size-4" /> Discard
                    </Button>
                    <Button onclick={saveIdentity} disabled={savingIdentity}>
                      <Save class="size-4" /> Save changes
                    </Button>
                  </div>
                </div>
              {/if}
            </div>
          </SectionPanel>

          <SectionPanel code="02" title="CONTAINED POLICIES">
            {#snippet aside()}
              {framework.containedPolicies?.length ?? 0} in bundle
            {/snippet}
            <div class="space-y-3 text-sm">
              <!-- Add policy row -->
              <div class="flex gap-2">
                <div class="min-w-0 flex-1">
                  <SingleSelect
                    options={addablePolicyOptions}
                    bind:selected={addingPolicyId}
                    placeholder="Add a policy to this bundle"
                  />
                </div>
                <Button
                  onclick={addPolicy}
                  disabled={!addingPolicyId || savingMembership}
                >
                  <Plus class="size-4" /> Add
                </Button>
              </div>

              <!-- Policy list -->
              <div>
                {#each framework.containedPolicies ?? [] as policy}
                  <div
                    class="grid gap-3 border-b border-border/40 py-2 last:border-b-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center"
                  >
                    <a
                      href={`/policies/${policy.id}`}
                      class="min-w-0 transition-colors hover:text-foreground/80"
                    >
                      <div class="truncate">{policy.name}</div>
                      <div
                        class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                      >
                        {policy.category ?? 'operational'} · scope {prettyText(policy.scope)}
                      </div>
                    </a>
                    <div class="min-w-0 truncate text-sm text-muted-foreground">
                      {policy.expectation ?? '—'}
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5 lg:justify-end">
                      <FindingSeverityBadge severity={policy.severity} />
                      <a
                        href={`/policies/${policy.id}`}
                        class="text-muted-foreground hover:text-foreground"
                        title="View policy"
                      >
                        <ArrowUpRight class="size-3" />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove from framework"
                        onclick={() => removePolicy(policy.id)}
                        disabled={removingPolicyId === policy.id || savingMembership}
                      >
                        <X class="size-4" />
                      </Button>
                    </div>
                  </div>
                {:else}
                  <p
                    class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
                  >
                    no policies in this bundle — add one above
                  </p>
                {/each}
              </div>
            </div>
          </SectionPanel>

          <SectionPanel code="03" title="OPEN FINDINGS">
            {#snippet aside()}
              <a
                href={`/findings?policySetId=${framework.id}`}
                class="inline-flex items-center gap-1 hover:text-foreground"
              >
                view all <ArrowUpRight class="size-3" />
              </a>
            {/snippet}
            <div>
              {#each findings as finding}
                <a
                  href={`/findings/${finding.id}`}
                  class="grid gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center"
                >
                  <div class="min-w-0">
                    <div class="truncate">{finding.title}</div>
                    {#if finding.evidenceSummary}
                      <div
                        class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                      >
                        {finding.evidenceSummary}
                      </div>
                    {/if}
                  </div>
                  <div class="min-w-0 text-sm text-muted-foreground">
                    <div class="truncate font-mono text-[10.5px] uppercase tracking-wider">
                      {finding.policyName ?? '—'}
                    </div>
                    {#if finding.lastSeenAt}
                      <div class="font-mono text-[10.5px] uppercase tracking-wider">
                        last seen {formatRelativeDate(finding.lastSeenAt)}
                      </div>
                    {/if}
                  </div>
                  <div class="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
                    <FindingSeverityBadge severity={finding.severity} />
                    <FindingStatusBadge status={finding.status} />
                    <ArrowUpRight class="size-3 text-muted-foreground" />
                  </div>
                </a>
              {:else}
                <p
                  class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
                >
                  no open findings
                </p>
              {/each}
            </div>
          </SectionPanel>
        </div>

        <!-- RIGHT COLUMN -->
        <aside class="space-y-4">
          <SectionPanel code="@" title="BUNDLE FACTS">
            <dl>
              <MetaRow label="Source" value={prettyText(framework.source)} />
              <MetaRow label="Category" value={framework.category} />
              <MetaRow label="Provider" value={framework.providerName} />
              <MetaRow label="Version" value={framework.version} mono />
              <MetaRow
                label="Created"
                value={framework.createdAt ? formatRelativeDate(framework.createdAt) : null}
                mono
              />
              <MetaRow
                label="Updated"
                value={framework.updatedAt ? formatRelativeDate(framework.updatedAt) : null}
                mono
              />
              <MetaRow label="ID" value={framework.id} mono />
            </dl>
          </SectionPanel>

          <SectionPanel code="#" title="MAPPINGS">
            {#snippet aside()}
              {assignments.length} active
            {/snippet}
            <div class="space-y-3 text-sm">
              <div class="space-y-2 border border-border/60 bg-muted/20 p-3">
                <div
                  class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  Add mapping
                </div>
                <label class="grid gap-1 text-sm">
                  <span
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Scope
                  </span>
                  <SingleSelect
                    options={scopeOptions}
                    bind:selected={scopeType}
                    onchange={() => (targetId = '')}
                  />
                </label>
                {#if scopeType !== 'global'}
                  <label class="grid gap-1 text-sm">
                    <span
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Target
                    </span>
                    <SingleSelect
                      options={targetOptions}
                      bind:selected={targetId}
                      placeholder="Choose target"
                    />
                  </label>
                {/if}
                <div
                  class="flex items-center justify-between gap-3 border-t border-border/50 pt-2"
                >
                  <label class="flex items-center gap-2 text-sm">
                    <Switch bind:checked={assignmentEnabled} />
                    <span>Enabled on save</span>
                  </label>
                  <Button onclick={saveAssignment} disabled={savingAssignment}>
                    <Plus class="size-4" /> Add mapping
                  </Button>
                </div>
              </div>

              <div>
                {#each assignments as assignment}
                  <div
                    class="flex items-center justify-between gap-3 border-b border-border/40 py-2 last:border-b-0"
                  >
                    <div class="flex min-w-0 items-baseline gap-2">
                      <span
                        class={`size-1.5 shrink-0 translate-y-px rounded-full ${scopeDot(assignment.scopeType)}`}
                      ></span>
                      <div class="min-w-0">
                        <div class="truncate text-sm">{assignmentLabel(assignment)}</div>
                        <div
                          class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                        >
                          {scopeShort[assignment.scopeType] ?? assignment.scopeType}
                          {#if assignment.updatedAt}
                            · updated {formatRelativeDate(assignment.updatedAt)}
                          {/if}
                        </div>
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <span
                        class={`inline-flex items-center rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.14em] ${
                          assignment.enabled
                            ? 'border-foreground/15 bg-foreground/4 text-foreground/90'
                            : 'border-border/60 bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        {assignment.enabled ? 'ON' : 'OFF'}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove mapping"
                        onclick={() => deleteAssignment(assignment.id)}
                        disabled={deletingAssignmentId === assignment.id}
                      >
                        <Trash2 class="size-4" />
                      </Button>
                    </div>
                  </div>
                {:else}
                  <p
                    class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
                  >
                    no mappings — this bundle applies nowhere
                  </p>
                {/each}
              </div>
            </div>
          </SectionPanel>

          {#if framework.sitesAffected.length}
            <SectionPanel code="↳" title="SITES AFFECTED">
              {#snippet aside()}
                {framework.sitesAffected.length} site{framework.sitesAffected.length === 1
                  ? ''
                  : 's'}
              {/snippet}
              <div class="flex flex-wrap gap-1.5">
                {#each framework.sitesAffected as siteId}
                  <SourceBadge source={siteName(siteId)} />
                {/each}
              </div>
            </SectionPanel>
          {/if}

          {#if framework.source === 'custom'}
            <SectionPanel code="!" title="DANGER ZONE">
              <div class="space-y-2">
                <p class="text-sm text-muted-foreground">
                  Deleting this framework removes all its mappings. Open findings are not closed automatically.
                </p>
                <ConfirmDialog
                  title="Delete framework"
                  description={'This will permanently delete "' + framework.name + '" and all its scope mappings. Open findings linked to its policies will remain until their next evaluation cycle.'}
                  confirmLabel="Delete"
                  destructive
                  onconfirm={deleteFramework}
                >
                  {#snippet trigger(props)}
                    <Button
                      variant="destructive"
                      class="w-full"
                      disabled={deletingFramework}
                      {...props}
                    >
                      <Trash2 class="size-4" /> Delete framework
                    </Button>
                  {/snippet}
                </ConfirmDialog>
              </div>
            </SectionPanel>
          {/if}
        </aside>
      </div>
    </div>
  </FadeIn>
{:else}
  <Loader />
{/if}
