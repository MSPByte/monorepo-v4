<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Pencil, Plus, Save, Trash2 } from '@lucide/svelte';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import MetaRow from '$lib/components/panel/meta-row.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  import Button from '$lib/components/ui/button/button.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';

  import PolicyBriefing from './_components/policy-briefing.svelte';

  type ScopeType = 'global' | 'site' | 'site_group' | 'integration_link';
  type PolicyDefinition = Record<string, unknown>;

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id ?? '');

  const policyQuery = createQuery(() => ({
    queryKey: ['policies.byId', id],
    queryFn: () => trpc.policies.byId.query({ id }),
  }));
  const findingsQuery = createQuery(() => ({
    queryKey: ['findings.list', { policyId: id }],
    queryFn: () => trpc.findings.list.query({ policyId: id }),
  }));
  const assignmentsQuery = createQuery(() => ({
    queryKey: ['policies.listAssignments', { policyId: id }],
    queryFn: () => trpc.policies.listAssignments.query({ policyId: id }),
  }));
  const assignmentOptionsQuery = createQuery(() => ({
    queryKey: ['policies.assignmentOptions'],
    queryFn: () => trpc.policies.assignmentOptions.query(),
  }));
  const frameworksQuery = createQuery(() => ({
    queryKey: ['frameworks.list'],
    queryFn: () => trpc.frameworks.list.query(),
  }));
  const dependencyOptionsQuery = createQuery(() => ({
    queryKey: ['policies.dependencyOptions'],
    queryFn: () => trpc.policies.dependencyOptions.query(),
  }));

  let loadedFrameworkMembershipFor = $state('');
  let selectedFrameworkIds = $state<string[]>([]);
  let savingFrameworks = $state(false);
  let loadedDependenciesFor = $state('');
  let selectedChildPolicyIds = $state<string[]>([]);
  let savingDependencies = $state(false);
  let scopeType = $state<ScopeType>('global');
  let targetId = $state('');
  let assignmentEnabled = $state(true);
  let savingAssignment = $state(false);
  let deletingAssignmentId = $state<string | null>(null);
  let showRawDefinition = $state(false);

  const scopeOptions = [
    { value: 'global', label: 'Global — every site' },
    { value: 'site', label: 'Site' },
    { value: 'site_group', label: 'Site group' },
    { value: 'integration_link', label: 'Integration link' },
  ];
  const scopeShort: Record<string, string> = {
    global: 'GLOBAL',
    site: 'SITE',
    site_group: 'SITE·GROUP',
    integration_link: 'INTEGRATION',
  };

  const targetOptions = $derived.by(() => {
    const data = assignmentOptionsQuery.data;
    if (!data) return [];
    if (scopeType === 'site')
      return data.sites.map((site) => ({ value: site.id, label: site.name }));
    if (scopeType === 'site_group')
      return data.siteGroups.map((group) => ({ value: group.id, label: group.name }));
    if (scopeType === 'integration_link') {
      return data.links.map((link) => ({
        value: link.id,
        label: `${link.name ?? link.id} (${link.integrationId})`,
      }));
    }
    return [];
  });
  const frameworkOptions = $derived(
    (frameworksQuery.data ?? []).map((framework) => ({
      value: framework.id,
      label: framework.name,
    }))
  );
  const childPolicyOptions = $derived.by(() => {
    const policy = policyQuery.data;
    return (dependencyOptionsQuery.data ?? [])
      .filter((candidate) => candidate.id !== policy?.id)
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.name,
      }));
  });

  const membershipDirty = $derived.by(() => {
    const policy = policyQuery.data;
    if (!policy) return false;
    const prev = (policy.frameworks ?? []).map((framework) => framework.id).sort();
    const next = [...selectedFrameworkIds].sort();
    if (prev.length !== next.length) return true;
    return prev.some((value, index) => value !== next[index]);
  });
  const dependenciesDirty = $derived.by(() => {
    const policy = policyQuery.data;
    if (!policy) return false;
    const prev = (policy.dependencyChildren ?? []).map((child) => child.policyId).sort();
    const next = [...selectedChildPolicyIds].sort();
    if (prev.length !== next.length) return true;
    return prev.some((value, index) => value !== next[index]);
  });

  $effect(() => {
    const policy = policyQuery.data;
    if (policy && loadedFrameworkMembershipFor !== policy.id) {
      selectedFrameworkIds = (policy.frameworks ?? []).map((framework) => framework.id);
      loadedFrameworkMembershipFor = policy.id;
    }
  });
  $effect(() => {
    const policy = policyQuery.data;
    if (policy && loadedDependenciesFor !== policy.id) {
      selectedChildPolicyIds = (policy.dependencyChildren ?? []).map((child) => child.policyId);
      loadedDependenciesFor = policy.id;
    }
  });

  function isRecord(value: unknown): value is PolicyDefinition {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function definitionKindLabel(kind: unknown) {
    if (kind === 'rowExpectation') return 'Every matching row must pass';
    if (kind === 'tableThreshold') return 'Matching row count threshold';
    return typeof kind === 'string' && kind ? kind : 'Structured policy';
  }

  function conditionLabel(condition: unknown) {
    if (!condition || typeof condition !== 'object') return null;
    const record = condition as Record<string, unknown>;
    const value = 'value' in record ? ` ${String(record.value)}` : '';
    return `${String(record.field ?? 'field')} ${String(record.op ?? 'matches')}${value}`;
  }

  function policyOrigin(policy: unknown) {
    if (!isRecord(policy)) return 'custom';
    return String(policy.origin ?? policy.source ?? 'custom');
  }

  function assignmentTarget(assignment: {
    scopeType: string;
    siteName?: string | null;
    siteGroupName?: string | null;
    linkName?: string | null;
  }) {
    if (assignment.scopeType === 'global') return 'Every site';
    return (
      assignment.siteName ?? assignment.siteGroupName ?? assignment.linkName ?? 'Unnamed target'
    );
  }

  function scopeDot(kind: string): string {
    if (kind === 'global') return 'bg-primary';
    if (kind === 'site') return 'bg-primary/70';
    if (kind === 'site_group') return 'bg-primary/50';
    if (kind === 'integration_link') return 'bg-primary/30';
    return 'bg-muted-foreground';
  }

  function relationshipBadge(kind: string): string {
    return kind === 'blocks' ? 'BLOCKS' : kind.toUpperCase();
  }

  async function refreshPolicy() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['policies.byId', id] }),
      queryClient.invalidateQueries({ queryKey: ['policies.list'] }),
      queryClient.invalidateQueries({ queryKey: ['policies.tableData'] }),
    ]);
  }

  async function refreshAssignments() {
    await queryClient.invalidateQueries({
      queryKey: ['policies.listAssignments', { policyId: id }],
    });
  }

  function discardMembership() {
    const policy = policyQuery.data;
    if (!policy) return;
    selectedFrameworkIds = (policy.frameworks ?? []).map((framework) => framework.id);
  }

  function discardDependencies() {
    const policy = policyQuery.data;
    if (!policy) return;
    selectedChildPolicyIds = (policy.dependencyChildren ?? []).map((child) => child.policyId);
  }

  async function saveFrameworkMembership() {
    savingFrameworks = true;
    try {
      await trpc.policies.setFrameworkMembership.mutate({
        policyId: id,
        policySetIds: selectedFrameworkIds,
      });
      await refreshPolicy();
      await queryClient.invalidateQueries({ queryKey: ['frameworks.list'] });
      toast.success('Framework membership saved');
    } catch (error) {
      showErrorToast(error, 'Failed to save framework membership.');
    } finally {
      savingFrameworks = false;
    }
  }

  async function saveDependencies() {
    savingDependencies = true;
    try {
      await trpc.policies.setChildPolicyDependencies.mutate({
        parentPolicyId: id,
        childPolicyIds: selectedChildPolicyIds,
        relationshipType: 'blocks',
      });
      await refreshPolicy();
      await queryClient.invalidateQueries({ queryKey: ['policies.dependencyOptions'] });
      toast.success('Child policy relationships saved');
    } catch (error) {
      showErrorToast(error, 'Failed to save child policy relationships.');
    } finally {
      savingDependencies = false;
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
        subjectType: 'policy',
        policyId: id,
        policySetId: null,
        scopeType,
        siteId: scopeType === 'site' ? targetId : null,
        siteGroupId: scopeType === 'site_group' ? targetId : null,
        linkId: scopeType === 'integration_link' ? targetId : null,
        enabled: assignmentEnabled,
        parameters: {},
      });
      targetId = '';
      scopeType = 'global';
      assignmentEnabled = true;
      await refreshAssignments();
      toast.success('Assignment created');
    } catch (error) {
      showErrorToast(error, 'Failed to create assignment.');
    } finally {
      savingAssignment = false;
    }
  }

  async function deleteAssignment(idToDelete: string) {
    deletingAssignmentId = idToDelete;
    try {
      await trpc.policies.deleteAssignment.mutate({ id: idToDelete });
      await refreshAssignments();
      toast.success('Assignment removed');
    } catch (error) {
      showErrorToast(error, 'Failed to remove assignment.');
    } finally {
      deletingAssignmentId = null;
    }
  }
</script>

{#if policyQuery.data}
  {@const policy = policyQuery.data}
  {@const definition = isRecord(policy.definition) ? policy.definition : {}}
  {@const expectations = Array.isArray(definition?.expectations) ? definition.expectations : []}
  {@const filters =
    definition?.filter &&
    typeof definition.filter === 'object' &&
    Array.isArray((definition.filter as Record<string, unknown>).conditions)
      ? (definition.filter as { conditions: unknown[] }).conditions
      : []}
  {@const assignments = assignmentsQuery.data ?? []}
  {@const findings = findingsQuery.data ?? policy.exampleFindings ?? []}
  {@const openFindingCount = findings.length || policy.openFindingCount}
  <FadeIn class="size-full overflow-auto">
    <PolicyBriefing
      name={policy.name}
      description={policy.description}
      category={policy.category}
      scope={policy.scope}
      dataSource={policy.dataSource ?? policy.source}
      origin={policyOrigin(policy)}
      enabled={policy.enabled}
      severity={policy.severity}
      {openFindingCount}
      frameworkCount={(policy.frameworks ?? []).length}
      assignmentCount={assignments.length}
      lastEvaluation={policy.lastEvaluation}
      updatedAt={policy.lastEvaluation}
    />

    <div class="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
      <!-- Top legend strip -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-card px-3 py-2"
      >
        <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          POLICY DEFINITION
          {#if policy.lastEvaluation}
            <span class="ml-2 text-foreground/70">·</span>
            <span class="ml-2">evaluated {formatRelativeDate(policy.lastEvaluation)}</span>
          {/if}
        </div>
        <a
          href={`/policies/builder?id=${encodeURIComponent(policy.id)}`}
          class="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <Pencil class="size-3" /> edit in builder
        </a>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
        <!-- LEFT COLUMN -->
        <div class="space-y-4">
          <SectionPanel code="01" title="EVALUATION">
            {#snippet aside()}
              {definitionKindLabel(definition?.kind)}
            {/snippet}
            <div class="space-y-4 text-sm">
              <div class="grid gap-3 md:grid-cols-3">
                <div>
                  <div
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Table
                  </div>
                  <div class="mt-0.5 truncate font-mono text-[13px] tabular-nums">
                    {String(definition?.table ?? '—')}
                  </div>
                </div>
                <div>
                  <div
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Resource
                  </div>
                  <div class="mt-0.5 truncate">
                    {prettyText(String(definition?.resourceType ?? policy.scope))}
                  </div>
                </div>
                {#if definition?.threshold !== undefined}
                  <div>
                    <div
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Threshold
                    </div>
                    <div class="mt-0.5 font-mono text-[13px] tabular-nums">
                      {String(definition.threshold)}
                    </div>
                  </div>
                {/if}
              </div>

              <div>
                <div
                  class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  Row expectations
                </div>
                <div class="grid gap-1.5">
                  {#each expectations as condition}
                    <div
                      class="border border-border/60 bg-muted/20 px-2.5 py-1.5 font-mono text-[11.5px] tabular-nums"
                    >
                      {conditionLabel(condition)}
                    </div>
                  {:else}
                    <p
                      class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
                    >
                      no row expectations defined
                    </p>
                  {/each}
                </div>
              </div>

              <div>
                <div
                  class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  Candidate filters
                </div>
                <div class="grid gap-1.5">
                  {#each filters as condition}
                    <div
                      class="border border-border/60 bg-muted/20 px-2.5 py-1.5 font-mono text-[11.5px] tabular-nums"
                    >
                      {conditionLabel(condition)}
                    </div>
                  {:else}
                    <p
                      class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
                    >
                      all scoped rows are evaluated
                    </p>
                  {/each}
                </div>
              </div>

              <div class="grid gap-3 border-t border-border/50 pt-3 md:grid-cols-2">
                <div>
                  <div
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Finding title
                  </div>
                  <div class="mt-0.5 truncate text-sm">
                    {String(definition?.title ?? '—')}
                  </div>
                </div>
                <div>
                  <div
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    Summary template
                  </div>
                  <div class="mt-0.5 truncate text-sm">
                    {String(definition?.summary ?? '—')}
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
                <button
                  type="button"
                  class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onclick={() => (showRawDefinition = !showRawDefinition)}
                >
                  {showRawDefinition ? '− hide' : '+ show'} raw definition JSON
                </button>
              </div>
              {#if showRawDefinition}
                <pre
                  class="max-h-[420px] overflow-auto border border-border/60 bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(
                    definition,
                    null,
                    2
                  )}</pre>
              {/if}
            </div>
          </SectionPanel>

          <SectionPanel code="02" title="FRAMEWORK MEMBERSHIP">
            {#snippet aside()}
              {(policy.frameworks ?? []).length} in
            {/snippet}
            <div class="space-y-3 text-sm">
              <div class="grid gap-2">
                <span
                  class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  Frameworks that include this policy
                </span>
                <MultiSelect
                  options={frameworkOptions}
                  bind:selected={selectedFrameworkIds}
                  placeholder="Add frameworks"
                  maxDisplay={3}
                />
                {#if membershipDirty}
                  <div
                    class="flex items-center justify-between gap-3 border-t border-border/50 pt-2"
                  >
                    <span
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      {selectedFrameworkIds.length} selected · audit-logged on save
                    </span>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onclick={discardMembership}
                        disabled={savingFrameworks}
                      >
                        Discard
                      </Button>
                      <Button onclick={saveFrameworkMembership} disabled={savingFrameworks}>
                        <Save class="size-4" /> Save
                      </Button>
                    </div>
                  </div>
                {/if}
              </div>

              <div>
                {#each policy.frameworks ?? [] as framework}
                  <a
                    href={`/frameworks/${framework.id}`}
                    class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <div class="min-w-0">
                      <div class="truncate">{framework.name}</div>
                      {#if framework.description}
                        <div
                          class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                        >
                          {framework.description}
                        </div>
                      {/if}
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <span
                        class={`inline-flex items-center rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.14em] ${
                          framework.enabled
                            ? 'border-foreground/15 bg-foreground/4 text-foreground/90'
                            : 'border-border/60 bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        {framework.enabled ? 'ON' : 'OFF'}
                      </span>
                      <ArrowUpRight class="size-3 text-muted-foreground" />
                    </div>
                  </a>
                {:else}
                  <p
                    class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
                  >
                    not included in any framework
                  </p>
                {/each}
              </div>
            </div>
          </SectionPanel>

          <SectionPanel code="03" title="DEPENDENCIES">
            {#snippet aside()}
              {(policy.dependencyChildren ?? []).length} child · {(policy.dependencyParents ?? []).length} parent
            {/snippet}
            <div class="space-y-4 text-sm">
              <div class="space-y-2 border border-border/60 bg-muted/20 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Parent-managed child policies
                    </div>
                    <p class="mt-1 text-sm text-muted-foreground">
                      When this policy is failing, selected child policies stop creating new findings until the parent is healthy again.
                    </p>
                  </div>
                  <span class="rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/90">
                    BLOCKS
                  </span>
                </div>

                <MultiSelect
                  options={childPolicyOptions}
                  bind:selected={selectedChildPolicyIds}
                  placeholder="Add child policies"
                  maxDisplay={3}
                />

                {#if dependenciesDirty}
                  <div class="flex items-center justify-between gap-3 border-t border-border/50 pt-2">
                    <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {selectedChildPolicyIds.length} child policies selected
                    </span>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onclick={discardDependencies}
                        disabled={savingDependencies}
                      >
                        Discard
                      </Button>
                      <Button onclick={saveDependencies} disabled={savingDependencies}>
                        <Save class="size-4" /> Save
                      </Button>
                    </div>
                  </div>
                {/if}
              </div>

              <div class="space-y-1">
                {#each policy.dependencyChildren ?? [] as child}
                  <a
                    href={`/policies/${child.policyId}`}
                    class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <div class="min-w-0">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="truncate">{child.name}</span>
                        <span class="rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/90">
                          {relationshipBadge(child.relationshipType)}
                        </span>
                      </div>
                      <div class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                        {prettyText(child.category ?? 'Operational')} · {child.openFindingCount} open
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <FindingSeverityBadge severity={child.severity} />
                      <ArrowUpRight class="size-3 text-muted-foreground" />
                    </div>
                  </a>
                {:else}
                  <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                    no child policies linked
                  </p>
                {/each}
              </div>

              {#if (policy.dependencyParents ?? []).length > 0}
                <div class="border-t border-border/50 pt-3">
                  <div class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Managed by parent policies
                  </div>
                  <div class="space-y-1">
                    {#each policy.dependencyParents ?? [] as parent}
                      <a
                        href={`/policies/${parent.policyId}`}
                        class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
                      >
                        <div class="min-w-0">
                          <div class="truncate">{parent.name}</div>
                          <div class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                            remove from parent policy · {parent.openFindingCount} open
                          </div>
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                          <FindingSeverityBadge severity={parent.severity} />
                          <ArrowUpRight class="size-3 text-muted-foreground" />
                        </div>
                      </a>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          </SectionPanel>

          <SectionPanel code="04" title="OPEN FINDINGS">
            {#snippet aside()}
              <a
                href={`/findings?policyId=${policy.id}`}
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
          <SectionPanel code="@" title="POLICY FACTS">
            <dl>
              <MetaRow label="Category" value={policy.category ? prettyText(policy.category) : 'Operational'} />
              <MetaRow label="Target" value={prettyText(policy.scope)} />
              <MetaRow label="Data source" value={policy.dataSource ?? policy.source} />
              <MetaRow label="Origin" value={policyOrigin(policy)} />
              <MetaRow
                label="Evaluated"
                value={policy.lastEvaluation ? formatRelativeDate(policy.lastEvaluation) : null}
                mono
              />
            </dl>
          </SectionPanel>

          {#if policy.recommendation}
            <SectionPanel code="!" title="RECOMMENDATION">
              <p class="text-sm leading-relaxed text-foreground/90">{policy.recommendation}</p>
            </SectionPanel>
          {/if}

          <SectionPanel code="#" title="ASSIGNMENTS">
            {#snippet aside()}
              {assignments.length} active
            {/snippet}
            <div class="space-y-3 text-sm">
              <div class="space-y-2 border border-border/60 bg-muted/20 p-3">
                <div
                  class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  Add assignment
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
                    <Plus class="size-4" /> Add
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
                        <div class="truncate text-sm">{assignmentTarget(assignment)}</div>
                        <div
                          class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                        >
                          {scopeShort[assignment.scopeType] ?? assignment.scopeType}
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
                        title="Remove assignment"
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
                    no assignments — this policy evaluates nowhere
                  </p>
                {/each}
              </div>
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  </FadeIn>
{:else}
  <Loader />
{/if}
