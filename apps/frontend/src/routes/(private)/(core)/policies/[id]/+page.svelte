<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ArrowLeft, Pencil, Plus, Save, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { cn } from '$lib/utils';
  import { formatRelativeDate } from '$lib/utils/format';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  type Tab = 'overview' | 'internals' | 'frameworks' | 'assignments' | 'findings';
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

  let activeTab = $state<Tab>('overview');
  let loadedFrameworkMembershipFor = $state('');
  let selectedFrameworkIds = $state<string[]>([]);
  let savingFrameworks = $state(false);
  let scopeType = $state<ScopeType>('global');
  let targetId = $state('');
  let includeChildren = $state(true);
  let assignmentEnabled = $state(true);
  let savingAssignment = $state(false);
  let deletingAssignmentId = $state<string | null>(null);

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'internals', label: 'Internals' },
    { value: 'frameworks', label: 'Frameworks' },
    { value: 'assignments', label: 'Assignments' },
    { value: 'findings', label: 'Findings' },
  ];
  const scopeOptions = [
    { value: 'global', label: 'Global' },
    { value: 'site', label: 'Site' },
    { value: 'site_group', label: 'Site group' },
    { value: 'integration_link', label: 'Integration link' },
  ];

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
  $effect(() => {
    const policy = policyQuery.data;
    if (policy && loadedFrameworkMembershipFor !== policy.id) {
      selectedFrameworkIds = (policy.frameworks ?? []).map((framework) => framework.id);
      loadedFrameworkMembershipFor = policy.id;
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
    if (assignment.scopeType === 'global') return 'Global';
    return (
      assignment.siteName ?? assignment.siteGroupName ?? assignment.linkName ?? assignment.scopeType
    );
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
      toast.error(error instanceof Error ? error.message : 'Failed to save framework membership');
    } finally {
      savingFrameworks = false;
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
        includeChildSites: includeChildren,
        enabled: assignmentEnabled,
        parameters: {},
      });
      targetId = '';
      await refreshAssignments();
      toast.success('Assignment created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create assignment');
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
    } catch {
      toast.error('Failed to remove assignment');
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
  <FadeIn class="flex size-full flex-col overflow-hidden">
    <div class="border-b bg-background/80 px-6 py-5">
      <div class="mx-auto flex max-w-7xl flex-col gap-4">
        <Button
          href="/policies"
          variant="ghost"
          size="sm"
          class="w-fit gap-2 px-0 hover:bg-transparent"
        >
          <ArrowLeft class="size-4" />
          Policies
        </Button>
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0 space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Policy
              </div>
              <Badge variant={policy.enabled ? 'default' : 'secondary'}
                >{policy.enabled ? 'Enabled' : 'Disabled'}</Badge
              >
              <FindingSeverityBadge severity={policy.severity} />
            </div>
            <h1 class="text-2xl font-semibold tracking-normal">{policy.name}</h1>
            {#if policy.description}
              <p class="max-w-3xl text-sm text-muted-foreground">{policy.description}</p>
            {/if}
            <div class="flex flex-wrap gap-2">
              <SourceBadge source={policy.dataSource ?? policy.source} />
              <SourceBadge source={policy.scope} />
              {#if policy.category}
                <SourceBadge source={policy.category} />
              {/if}
            </div>
          </div>
          <Button
            href={`/policies/builder?id=${encodeURIComponent(policy.id)}`}
            class="w-fit gap-2"
          >
            <Pencil class="size-4" />
            Edit Policy
          </Button>
        </div>
      </div>
    </div>

    <div class="flex w-full justify-between border-b">
      <div class="flex shrink-0 items-center gap-0 px-4">
        {#each tabs as tab}
          <button
            type="button"
            class={cn(
              'border-b-2 px-3 py-2.5 text-sm font-medium transition-colors -mb-px',
              activeTab === tab.value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            onclick={() => (activeTab = tab.value)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex-1 overflow-auto p-6">
      <div class="mx-auto max-w-7xl">
        {#if activeTab === 'overview'}
          <div class="space-y-6">
            <div class="grid gap-4 md:grid-cols-3">
              <MetricCard
                label="Open Findings"
                value={findingsQuery.data?.length ?? policy.openFindingCount}
              />
              <MetricCard label="Frameworks" value={(policy.frameworks ?? []).length} />
              <MetricCard label="Assignments" value={assignmentsQuery.data?.length ?? 0} />
            </div>

            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <Card.Root>
                <Card.Header>
                  <Card.Title>Policy Details</Card.Title>
                  <Card.Description>Metadata and guidance stored with this policy.</Card.Description
                  >
                </Card.Header>
                <Card.Content class="space-y-4 text-sm">
                  <div class="grid gap-3 md:grid-cols-2">
                    <div>
                      <div class="text-xs text-muted-foreground">Category</div>
                      <div class="font-medium">{policy.category || 'Operational'}</div>
                    </div>
                    <div>
                      <div class="text-xs text-muted-foreground">Target</div>
                      <div class="font-medium">{policy.scope}</div>
                    </div>
                    <div>
                      <div class="text-xs text-muted-foreground">Data source</div>
                      <div class="font-medium">{policy.dataSource ?? policy.source}</div>
                    </div>
                    <div>
                      <div class="text-xs text-muted-foreground">Origin</div>
                      <div class="font-medium">{policyOrigin(policy)}</div>
                    </div>
                    <div>
                      <div class="text-xs text-muted-foreground">Last evaluated</div>
                      <div class="font-medium">{formatRelativeDate(policy.lastEvaluation)}</div>
                    </div>
                  </div>
                  {#if policy.recommendation}
                    <div>
                      <div class="mb-1 text-xs text-muted-foreground">Recommendation</div>
                      <div class="rounded-md border bg-muted/30 p-3 text-sm">
                        {policy.recommendation}
                      </div>
                    </div>
                  {/if}
                  <Button
                    href={`/policies/builder?id=${encodeURIComponent(policy.id)}`}
                    variant="outline"
                    class="w-fit gap-2"
                  >
                    <Pencil class="size-4" />
                    Edit in Builder
                  </Button>
                </Card.Content>
              </Card.Root>

              <Card.Root>
                <Card.Header>
                  <Card.Title>Evaluation Summary</Card.Title>
                  <Card.Description>{definitionKindLabel(definition?.kind)}</Card.Description>
                </Card.Header>
                <Card.Content class="space-y-4 text-sm">
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <div class="text-xs text-muted-foreground">Table</div>
                      <div class="font-medium">{String(definition?.table ?? 'Not set')}</div>
                    </div>
                    <div>
                      <div class="text-xs text-muted-foreground">Resource</div>
                      <div class="font-medium">
                        {String(definition?.resourceType ?? policy.scope)}
                      </div>
                    </div>
                    {#if definition?.threshold !== undefined}
                      <div>
                        <div class="text-xs text-muted-foreground">Threshold</div>
                        <div class="font-medium">{String(definition.threshold)}</div>
                      </div>
                    {/if}
                  </div>
                  <div>
                    <div class="mb-2 text-xs font-medium text-muted-foreground">Rules</div>
                    <div class="grid gap-2">
                      {#each expectations as condition}
                        <div class="rounded-md border px-3 py-2 text-xs">
                          {conditionLabel(condition)}
                        </div>
                      {:else}
                        <div
                          class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground"
                        >
                          This policy does not define row expectation rules.
                        </div>
                      {/each}
                    </div>
                  </div>
                </Card.Content>
              </Card.Root>
            </div>
          </div>
        {:else if activeTab === 'internals'}
          <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card.Root>
              <Card.Header>
                <Card.Title>Definition JSON</Card.Title>
                <Card.Description
                  >The stored policy definition consumed by the policy worker.</Card.Description
                >
              </Card.Header>
              <Card.Content class="space-y-3">
                <pre
                  class="max-h-[620px] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(
                    definition,
                    null,
                    2
                  )}</pre>
                <Button
                  href={`/policies/builder?id=${encodeURIComponent(policy.id)}`}
                  variant="outline"
                  class="w-fit gap-2"
                >
                  <Pencil class="size-4" />
                  Edit in Builder
                </Button>
              </Card.Content>
            </Card.Root>

            <Card.Root>
              <Card.Header>
                <Card.Title>Readable Internals</Card.Title>
                <Card.Description
                  >Key parts of the definition without opening raw JSON.</Card.Description
                >
              </Card.Header>
              <Card.Content class="space-y-4 text-sm">
                <div>
                  <div class="text-xs text-muted-foreground">Evaluation type</div>
                  <div class="font-medium">{definitionKindLabel(definition?.kind)}</div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground">Candidate filters</div>
                  <div class="mt-2 grid gap-2">
                    {#each filters as condition}
                      <div class="rounded-md border px-3 py-2 text-xs">
                        {conditionLabel(condition)}
                      </div>
                    {:else}
                      <div
                        class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground"
                      >
                        All scoped rows are evaluated.
                      </div>
                    {/each}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground">Finding title</div>
                  <div class="mt-1 rounded-md border bg-muted/30 p-2 text-xs">
                    {String(definition?.title ?? 'Not set')}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-muted-foreground">Summary template</div>
                  <div class="mt-1 rounded-md border bg-muted/30 p-2 text-xs">
                    {String(definition?.summary ?? 'Not set')}
                  </div>
                </div>
              </Card.Content>
            </Card.Root>
          </div>
        {:else if activeTab === 'frameworks'}
          <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card.Root>
              <Card.Header>
                <Card.Title>Framework Membership</Card.Title>
                <Card.Description>Standards or baselines that include this policy.</Card.Description
                >
              </Card.Header>
              <Card.Content class="space-y-4">
                <div class="grid gap-2 rounded-md border p-3">
                  <MultiSelect
                    options={frameworkOptions}
                    bind:selected={selectedFrameworkIds}
                    placeholder="Select frameworks"
                    maxDisplay={2}
                  />
                  <div>
                    <Button
                      onclick={saveFrameworkMembership}
                      disabled={savingFrameworks}
                      class="gap-2"
                    >
                      <Save class="size-4" />
                      Save Frameworks
                    </Button>
                  </div>
                </div>

                <div class="grid gap-2">
                  {#each policy.frameworks ?? [] as framework}
                    <a
                      href={`/frameworks/${framework.id}`}
                      class="block rounded-md border p-3 hover:bg-accent/40"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                          <div class="truncate text-sm font-medium">{framework.name}</div>
                          {#if framework.description}
                            <div class="truncate text-xs text-muted-foreground">
                              {framework.description}
                            </div>
                          {/if}
                        </div>
                        <Badge variant={framework.enabled ? 'default' : 'secondary'}
                          >{framework.enabled ? 'Enabled' : 'Disabled'}</Badge
                        >
                      </div>
                    </a>
                  {:else}
                    <div
                      class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
                    >
                      This policy is not assigned to any frameworks.
                    </div>
                  {/each}
                </div>
              </Card.Content>
            </Card.Root>

            <Card.Root>
              <Card.Header>
                <Card.Title>Why It Matters</Card.Title>
              </Card.Header>
              <Card.Content class="text-sm text-muted-foreground">
                Framework membership controls which compliance bundles include this policy.
                Assignments still determine where the policy is evaluated.
              </Card.Content>
            </Card.Root>
          </div>
        {:else if activeTab === 'assignments'}
          <div class="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
            <Card.Root>
              <Card.Header>
                <Card.Title>Add Assignment</Card.Title>
                <Card.Description>Choose where this policy should evaluate.</Card.Description>
              </Card.Header>
              <Card.Content class="grid gap-3">
                <label class="grid gap-1 text-sm font-medium"
                  >Scope
                  <SingleSelect
                    options={scopeOptions}
                    bind:selected={scopeType}
                    onchange={() => (targetId = '')}
                  />
                </label>
                {#if scopeType !== 'global'}
                  <label class="grid gap-1 text-sm font-medium"
                    >Target
                    <SingleSelect
                      options={targetOptions}
                      bind:selected={targetId}
                      placeholder="Choose target"
                    />
                  </label>
                {/if}
                <label
                  class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium"
                >
                  <Switch bind:checked={assignmentEnabled} /> Assignment enabled
                </label>
                {#if scopeType === 'site'}
                  <label
                    class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium"
                  >
                    <Switch bind:checked={includeChildren} /> Include child sites
                  </label>
                {/if}
                <Button onclick={saveAssignment} disabled={savingAssignment} class="gap-2">
                  <Plus class="size-4" />
                  Add Assignment
                </Button>
              </Card.Content>
            </Card.Root>

            <Card.Root>
              <Card.Header>
                <Card.Title>Current Assignments</Card.Title>
                <Card.Description
                  >{assignmentsQuery.data?.length ?? 0} mappings for this policy.</Card.Description
                >
              </Card.Header>
              <Card.Content class="grid gap-2">
                {#each assignmentsQuery.data ?? [] as assignment}
                  <div
                    class="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                  >
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium">{assignmentTarget(assignment)}</div>
                      <div class="mt-1 flex flex-wrap gap-2">
                        <Badge variant="outline">{assignment.scopeType}</Badge>
                        {#if assignment.scopeType === 'site'}
                          <Badge variant="secondary"
                            >{assignment.includeChildSites
                              ? 'Includes child sites'
                              : 'Direct site only'}</Badge
                          >
                        {/if}
                        <Badge variant={assignment.enabled ? 'default' : 'secondary'}
                          >{assignment.enabled ? 'Enabled' : 'Disabled'}</Badge
                        >
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onclick={() => deleteAssignment(assignment.id)}
                      disabled={deletingAssignmentId === assignment.id}
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                {:else}
                  <div
                    class="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
                  >
                    No assignments yet. Add one to evaluate this policy against a scope.
                  </div>
                {/each}
              </Card.Content>
            </Card.Root>
          </div>
        {:else if activeTab === 'findings'}
          <div class="space-y-3">
            {#each findingsQuery.data ?? policy.exampleFindings ?? [] as finding}
              <FindingCard {finding} />
            {:else}
              <div
                class="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
              >
                No findings have been recorded for this policy.
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </FadeIn>
{:else}
  <Loader />
{/if}
