<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Plus, Save, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id ?? '');

  const frameworkQuery = createQuery(() => ({
    queryKey: ['frameworks.byId', id],
    queryFn: () => trpc.frameworks.byId.query({ id }),
  }));
  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
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

  const siteName = (siteId: string) => sitesQuery.data?.find((site) => site.id === siteId)?.name ?? siteId;
  const policyOptions = $derived((policiesQuery.data ?? []).map((policy) => ({ value: policy.id, label: policy.name })));

  let loadedMembershipFor = $state('');
  let selectedPolicyIds = $state<string[]>([]);
  let savingMembership = $state(false);
  let scopeType = $state<'global' | 'site' | 'site_group' | 'integration_link'>('global');
  let targetId = $state('');
  let assignmentEnabled = $state(true);
  let savingAssignment = $state(false);
  let deletingAssignmentId = $state<string | null>(null);
  const scopeOptions = [
    { value: 'global', label: 'Global' },
    { value: 'site', label: 'Site' },
    { value: 'site_group', label: 'Site group' },
    { value: 'integration_link', label: 'Integration link' }
  ];

  const targetOptions = $derived.by(() => {
    const data = assignmentOptionsQuery.data;
    if (!data) return [];
    if (scopeType === 'site') return data.sites.map((site) => ({ value: site.id, label: site.name }));
    if (scopeType === 'site_group') return data.siteGroups.map((group) => ({ value: group.id, label: group.name }));
    if (scopeType === 'integration_link') {
      return data.links.map((link) => ({ value: link.id, label: `${link.name ?? link.id} (${link.integrationId})` }));
    }
    return [];
  });

  $effect(() => {
    const framework = frameworkQuery.data;
    if (framework && loadedMembershipFor !== framework.id) {
      selectedPolicyIds = [...(framework.policies ?? [])];
      loadedMembershipFor = framework.id;
    }
  });

  async function refreshFramework() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['frameworks.byId', id] }),
      queryClient.invalidateQueries({ queryKey: ['frameworks.list'] })
    ]);
  }

  async function refreshAssignments() {
    await queryClient.invalidateQueries({ queryKey: ['policies.listAssignments', { policySetId: id }] });
  }

  async function saveMembership() {
    savingMembership = true;
    try {
      await trpc.frameworks.setPolicies.mutate({ policySetId: id, policyIds: selectedPolicyIds });
      await refreshFramework();
      toast.success('Framework policies updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update framework policies');
    } finally {
      savingMembership = false;
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

{#if frameworkQuery.data}
  {@const framework = frameworkQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader
      eyebrow="Framework"
      title={framework.name}
      subtitle={framework.description}
      sources={['Policy bundle']}
    />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-4">
          <MetricCard label="Pass Rate" value={`${framework.passRate}%`} />
          <MetricCard label="Policies" value={framework.policyCount} />
          <MetricCard label="Open Findings" value={framework.openFindings} />
          <MetricCard label="Enabled" value={framework.enabled ? 'Yes' : 'No'} />
        </div>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Contained Policies</Card.Title>
            <Card.Description>Policies in this standard or baseline.</Card.Description>
          </Card.Header>
          <Card.Content class="space-y-3 text-sm">
            <div class="grid gap-2 rounded-md border p-3">
              <MultiSelect options={policyOptions} bind:selected={selectedPolicyIds} placeholder="Select policies" />
              <div>
                <Button onclick={saveMembership} disabled={savingMembership} class="gap-2">
                  <Save class="size-4" />
                  Save Policies
                </Button>
              </div>
            </div>
            {#each framework.containedPolicies ?? [] as policy}
              <a href={`/policies/${policy.id}`} class="block rounded-md border p-3 hover:bg-accent/40">
                <div class="font-medium">{policy.name}</div>
                <div class="text-xs text-muted-foreground">{policy.expectation}</div>
              </a>
            {/each}
          </Card.Content>
        </Card.Root>

        <section class="space-y-3">
          <h2 class="text-sm font-medium">Recent Failures</h2>
          {#each framework.recentFailures ?? [] as finding}
            <FindingCard {finding} policyName={finding.policyId} />
          {/each}
        </section>
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Coverage</Card.Title>
          </Card.Header>
          <Card.Content class="text-sm text-muted-foreground">
            Last evaluated {formatRelativeDate(framework.lastEvaluation)}
          </Card.Content>
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Assignments</Card.Title>
            <Card.Description>Mappings for this framework only.</Card.Description>
          </Card.Header>
          <Card.Content class="space-y-3">
            <div class="grid gap-2">
              <label class="grid gap-1 text-sm font-medium">Scope
                <SingleSelect options={scopeOptions} bind:selected={scopeType} onchange={() => (targetId = '')} />
              </label>
              {#if scopeType !== 'global'}
                <label class="grid gap-1 text-sm font-medium">Target
                  <SingleSelect options={targetOptions} bind:selected={targetId} placeholder="Choose target" />
                </label>
              {/if}
              <label class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium">
                <Switch bind:checked={assignmentEnabled} /> Enabled
              </label>
              <Button onclick={saveAssignment} disabled={savingAssignment} class="gap-2">
                <Plus class="size-4" />
                Add Mapping
              </Button>
            </div>

            {#each assignmentsQuery.data ?? [] as assignment}
              <div class="flex items-center justify-between gap-2 rounded-md border p-2">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium">
                    {assignment.scopeType === 'global' ? 'Global' : assignment.siteName ?? assignment.siteGroupName ?? assignment.linkName ?? assignment.scopeType}
                  </div>
                  <div class="text-xs text-muted-foreground">{assignment.scopeType}</div>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant={assignment.enabled ? 'default' : 'secondary'}>{assignment.enabled ? 'Enabled' : 'Off'}</Badge>
                  <Button variant="ghost" size="icon" onclick={() => deleteAssignment(assignment.id)} disabled={deletingAssignmentId === assignment.id}>
                    <Trash2 class="size-4" />
                  </Button>
                </div>
              </div>
            {:else}
              <div class="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No mappings yet.</div>
            {/each}
          </Card.Content>
        </Card.Root>

        {#if framework.sitesAffected.length}
          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Sites Affected</Card.Title>
            </Card.Header>
            <Card.Content class="flex flex-wrap gap-2">
              {#each framework.sitesAffected as siteId}
                <SourceBadge source={siteName(siteId)} />
              {/each}
            </Card.Content>
          </Card.Root>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading framework...</div>
{/if}
