<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Plus, Trash2 } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import FindingCard from '$lib/components/domain/finding-card.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import SourceBadge from '$lib/components/domain/source-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id ?? '');
  const policyQuery = createQuery(() => ({ queryKey: ['policies.byId', id], queryFn: () => trpc.policies.byId.query({ id }) }));
  const findingsQuery = createQuery(() => ({ queryKey: ['findings.list', { policyId: id }], queryFn: () => trpc.findings.list.query({ policyId: id }) }));
  const assignmentsQuery = createQuery(() => ({
    queryKey: ['policies.listAssignments', { policyId: id }],
    queryFn: () => trpc.policies.listAssignments.query({ policyId: id })
  }));
  const assignmentOptionsQuery = createQuery(() => ({
    queryKey: ['policies.assignmentOptions'],
    queryFn: () => trpc.policies.assignmentOptions.query()
  }));

  let scopeType = $state<'global' | 'site' | 'site_group' | 'integration_link'>('global');
  let targetId = $state('');
  let includeChildren = $state(true);
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

  async function refreshAssignments() {
    await queryClient.invalidateQueries({ queryKey: ['policies.listAssignments', { policyId: id }] });
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

{#if policyQuery.data}
  {@const policy = policyQuery.data}
  <div class="size-full overflow-auto">
    <EntityHeader eyebrow="Policy" title={policy.name} subtitle={policy.description} sources={[policy.source, policy.scope]} />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <div class="grid gap-4 md:grid-cols-4">
          <MetricCard label="Open Findings" value={findingsQuery.data?.length ?? policy.openFindingCount} />
          <MetricCard label="Severity" value={policy.severity} />
          <MetricCard label="Category" value={policy.category} />
          <MetricCard label="Enabled" value={policy.enabled ? 'Yes' : 'No'} />
        </div>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <div><FindingSeverityBadge severity={policy.severity} /></div>
            <Card.Title>Expectation</Card.Title>
          </Card.Header>
          <Card.Content class="text-sm text-muted-foreground">{policy.expectation}</Card.Content>
        </Card.Root>

        <section class="space-y-3">
          <h2 class="text-sm font-medium">Example Findings</h2>
          {#each findingsQuery.data ?? policy.exampleFindings ?? [] as finding}
            <FindingCard {finding} />
          {/each}
        </section>
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Framework Membership</Card.Title></Card.Header>
          <Card.Content class="flex flex-wrap gap-2">
            {#each policy.frameworkMembership as framework}
              <SourceBadge source={framework} />
            {/each}
          </Card.Content>
        </Card.Root>
        <Card.Root class="rounded-lg">
          <Card.Header><Card.Title>Evaluation</Card.Title></Card.Header>
          <Card.Content class="text-sm text-muted-foreground">
            Last evaluated {formatRelativeDate(policy.lastEvaluation)}
          </Card.Content>
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Assignments</Card.Title>
            <Card.Description>Mappings for this policy only.</Card.Description>
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
              {#if scopeType === 'site'}
                <label class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium">
                  <Switch bind:checked={includeChildren} /> Include child sites
                </label>
              {/if}
              <Button onclick={saveAssignment} disabled={savingAssignment} class="gap-2">
                <Plus class="size-4" />
                Add Mapping
              </Button>
            </div>

            <div class="grid gap-2">
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
            </div>
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  </div>
{:else}
  <div class="p-6 text-sm text-muted-foreground">Loading policy...</div>
{/if}
