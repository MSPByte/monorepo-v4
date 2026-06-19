<script lang="ts">
  import * as Card from '$lib/components/ui/card/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { Plus, ShieldCheck, Pencil, Trash2, Globe } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type {
    ComplianceFramework as Framework,
    ComplianceFrameworkCheck as Check,
  } from '@mspbyte/drizzle';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';
  import FrameworkSheet from './_framework-sheet.svelte';
  import CheckDialog from './_check-dialog.svelte';

  type Link = inferRouterOutputs<AppRouter>['integrationLinks']['list'][number];

  const severityClass: Record<string, string> = {
    critical: 'bg-destructive/15 text-destructive border-destructive/30',
    high: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
    medium: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
    low: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
    info: 'bg-muted/50 text-muted-foreground',
  };

  let { links }: { links: Link[] } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();
  const integration = INTEGRATIONS['microsoft-365'];

  const frameworksQuery = createQuery(() => ({
    queryKey: ['compliance.listFrameworks', 'microsoft-365'],
    queryFn: () => trpc.compliance.listFrameworks.query({ integrationId: 'microsoft-365' }),
  }));

  const tenantLinks = $derived(
    [...links]
      .filter((l) => !l.siteId)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  );

  let selectedFrameworkId = $state<string | null>(null);
  let frameworkSheetOpen = $state(false);
  let frameworkSheetMode = $state<'create' | 'edit'>('create');
  let editingFramework = $state<Framework | null>(null);
  let checkDialogOpen = $state(false);
  let checkDialogMode = $state<'create' | 'edit'>('create');
  let editingCheck = $state<Check | null>(null);
  let detailTab = $state<'checks' | 'assignments'>('checks');
  let checksSearch = $state('');
  let overrideSearch = $state('');
  let addOverrideSelected = $state<string | undefined>(undefined);
  let deleteFrameworkTarget = $state<Framework | null>(null);
  let deleteCheckTarget = $state<Check | null>(null);

  const frameworks = $derived(frameworksQuery.data ?? []);
  const selectedFramework = $derived(frameworks.find((f) => f.id === selectedFrameworkId) ?? null);

  const checksQuery = createQuery<Check[]>(() => ({
    queryKey: ['compliance.listChecks', selectedFrameworkId],
    queryFn: (): Promise<Check[]> =>
      selectedFrameworkId
        ? (trpc.compliance.listChecks.query({ frameworkId: selectedFrameworkId }) as Promise<Check[]>)
        : Promise.resolve([]),
    enabled: !!selectedFrameworkId,
  }));

  const assignmentsQuery = createQuery(() => ({
    queryKey: ['compliance.listAssignments', 'microsoft-365'],
    queryFn: () => trpc.compliance.listAssignments.query({ integrationId: 'microsoft-365' }),
  }));

  const deleteFrameworkMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.compliance.deleteFramework.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listFrameworks'] });
    },
  }));

  const deleteCheckMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.compliance.deleteCheck.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listChecks'] });
    },
  }));

  const toggleAssignmentMut = createMutation(() => ({
    mutationFn: (frameworkId: string) =>
      trpc.compliance.toggleAssignment.mutate({ frameworkId, integrationId: 'microsoft-365' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listAssignments'] });
    },
  }));

  const addAssignmentMut = createMutation(() => ({
    mutationFn: (input: { frameworkId: string; linkId: string }) =>
      trpc.compliance.addAssignment.mutate({
        frameworkId: input.frameworkId,
        integrationId: 'microsoft-365',
        linkId: input.linkId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listAssignments'] });
    },
  }));

  const removeAssignmentMut = createMutation(() => ({
    mutationFn: (input: { frameworkId: string; linkId: string }) =>
      trpc.compliance.removeAssignment.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listAssignments'] });
    },
  }));

  const assignments = $derived(assignmentsQuery.data ?? []);

  const selectedFrameworkChecks = $derived(
    [...(checksQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  );

  const filteredChecks = $derived(
    selectedFrameworkChecks.filter((c) =>
      c.name.toLowerCase().includes(checksSearch.toLowerCase())
    )
  );

  const isDefaultAssigned = $derived((frameworkId: string) =>
    assignments.some((a) => a.frameworkId === frameworkId && !a.linkId)
  );

  const isDefaultEnabled = $derived(
    assignments.some((a) => a.frameworkId === selectedFrameworkId && !a.linkId)
  );

  const overrideLinkIds = $derived(
    new Set(
      assignments
        .filter((a) => a.frameworkId === selectedFrameworkId && !!a.linkId)
        .map((a) => a.linkId!)
    )
  );

  const overrideLinks = $derived(tenantLinks.filter((l) => overrideLinkIds.has(l.id)));
  const availableToAdd = $derived(tenantLinks.filter((l) => !overrideLinkIds.has(l.id)));

  const filteredOverrideLinks = $derived(
    overrideLinks.filter((l) =>
      (l.name ?? l.externalId ?? '').toLowerCase().includes(overrideSearch.toLowerCase())
    )
  );

  $effect(() => {
    if (selectedFrameworkId) {
      detailTab = 'checks';
      checksSearch = '';
      overrideSearch = '';
      addOverrideSelected = undefined;
    }
  });

  function openCreateFramework() {
    frameworkSheetMode = 'create';
    editingFramework = null;
    frameworkSheetOpen = true;
  }

  function openEditFramework(fw: Framework) {
    frameworkSheetMode = 'edit';
    editingFramework = fw;
    frameworkSheetOpen = true;
  }

  function openAddCheck() {
    checkDialogMode = 'create';
    editingCheck = null;
    checkDialogOpen = true;
  }

  function openEditCheck(check: Check) {
    checkDialogMode = 'edit';
    editingCheck = check;
    checkDialogOpen = true;
  }

  async function deleteFramework(fw: Framework) {
    try {
      await deleteFrameworkMut.mutateAsync(fw.id);
      if (selectedFrameworkId === fw.id) selectedFrameworkId = null;
      toast.info('Framework deleted');
    } catch {
      toast.error('Failed to delete framework');
    } finally {
      deleteFrameworkTarget = null;
    }
  }

  async function deleteCheck(check: Check) {
    try {
      await deleteCheckMut.mutateAsync(check.id);
      toast.info('Check deleted');
    } catch {
      toast.error('Failed to delete check');
    } finally {
      deleteCheckTarget = null;
    }
  }

  async function toggleDefaultAssignment(frameworkId: string) {
    try {
      await toggleAssignmentMut.mutateAsync(frameworkId);
    } catch {
      toast.error('Failed to toggle assignment');
    }
  }

  async function addOverride(linkId: string) {
    if (!selectedFrameworkId) return;
    try {
      await addAssignmentMut.mutateAsync({ frameworkId: selectedFrameworkId, linkId });
      addOverrideSelected = undefined;
    } catch {
      toast.error('Failed to add override');
    }
  }

  async function removeOverride(linkId: string) {
    if (!selectedFrameworkId) return;
    try {
      await removeAssignmentMut.mutateAsync({ frameworkId: selectedFrameworkId, linkId });
    } catch {
      toast.error('Failed to remove override');
    }
  }

  function formatCheckType(id: string) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
</script>

<!-- Delete Framework Confirm -->
<AlertDialog.Root
  open={!!deleteFrameworkTarget}
  onOpenChange={(open) => { if (!open) deleteFrameworkTarget = null; }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete Framework?</AlertDialog.Title>
      <AlertDialog.Description>
        This will permanently delete "{deleteFrameworkTarget?.name}" and all its checks.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => deleteFrameworkTarget && deleteFramework(deleteFrameworkTarget)}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- Delete Check Confirm -->
<AlertDialog.Root
  open={!!deleteCheckTarget}
  onOpenChange={(open) => { if (!open) deleteCheckTarget = null; }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete Check?</AlertDialog.Title>
      <AlertDialog.Description>
        This will permanently delete "{deleteCheckTarget?.name}".
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => deleteCheckTarget && deleteCheck(deleteCheckTarget)}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<FrameworkSheet bind:open={frameworkSheetOpen} mode={frameworkSheetMode} framework={editingFramework} />

{#if selectedFramework}
  <CheckDialog
    bind:open={checkDialogOpen}
    mode={checkDialogMode}
    check={editingCheck}
    frameworkId={selectedFramework.id}
    {integration}
  />
{/if}

<div class="flex flex-col size-full gap-4 overflow-hidden">
  <div class="flex items-center justify-between shrink-0">
    <span class="text-sm text-muted-foreground">
      Manage compliance frameworks and their checks for Microsoft 365.
    </span>
    <Button
      size="sm"
      onclick={openCreateFramework}
      class="gap-1.5"
      disabled={!authStore.isAllowed('Integrations.Write')}
    >
      <Plus class="size-4" /> New Framework
    </Button>
  </div>

  <div class="flex-1 flex gap-4 overflow-hidden min-h-0">
    <!-- Framework list -->
    <div class="w-72 shrink-0 flex flex-col overflow-hidden gap-2">
      <div class="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
        {#if frameworks.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <ShieldCheck class="size-8 opacity-40" />
            <span class="text-sm">No frameworks yet</span>
          </div>
        {:else}
          {#each frameworks as fw (fw.id)}
            {@const isDefault = isDefaultAssigned(fw.id)}
            <button
              class="text-left w-full"
              onclick={() => (selectedFrameworkId = selectedFrameworkId === fw.id ? null : fw.id)}
            >
              <Card.Root
                class="p-3 cursor-pointer hover:border-primary/50 transition-colors {selectedFrameworkId === fw.id ? 'border-primary bg-primary/10' : 'bg-card/70'}"
              >
                <div class="flex flex-col gap-2">
                  <div class="flex items-start justify-between gap-2">
                    <span class="font-medium text-sm leading-tight">{fw.name}</span>
                    {#if isDefault}
                      <Badge variant="outline" class="text-xs bg-primary/15 text-primary border-primary/30">
                        Default
                      </Badge>
                    {/if}
                  </div>
                </div>
              </Card.Root>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Detail panel -->
    {#if selectedFramework}
      <div class="flex-1 flex flex-col overflow-hidden border rounded bg-card/70">
        <div class="flex items-start justify-between px-4 py-3 border-b shrink-0">
          <div class="flex flex-col gap-0.5">
            <h2 class="font-semibold">{selectedFramework.name}</h2>
            {#if selectedFramework.description}
              <span class="text-xs text-muted-foreground">{selectedFramework.description}</span>
            {/if}
          </div>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              onclick={() => openEditFramework(selectedFramework)}
              class="p-1.5! h-fit rounded text-muted-foreground hover:text-primary"
            >
              <Pencil class="size-4" />
            </Button>
            <Button
              variant="ghost"
              disabled={!authStore.isAllowed('Integrations.Write')}
              onclick={() => (deleteFrameworkTarget = selectedFramework)}
              class="p-1.5! h-fit rounded text-muted-foreground hover:text-destructive hover:bg-destructive/20!"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </div>

        <Tabs.Root bind:value={detailTab} class="flex flex-col flex-1 overflow-hidden gap-0">
          <Tabs.List class="shrink-0 mx-4 mt-3 w-fit">
            <Tabs.Trigger value="checks">Checks</Tabs.Trigger>
            <Tabs.Trigger value="assignments">Assignments</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="checks" class="flex-1 overflow-y-auto p-4 mt-0 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <Input class="flex-1" bind:value={checksSearch} placeholder="Search checks..." />
              <Button
                variant="outline"
                size="sm"
                onclick={openAddCheck}
                class="gap-1 shrink-0"
                disabled={!authStore.isAllowed('Integrations.Write')}
              >
                <Plus class="size-3" /> Add Check
              </Button>
            </div>
            {#if selectedFrameworkChecks.length === 0}
              <div class="flex flex-col items-center py-6 gap-1 text-muted-foreground">
                <ShieldCheck class="size-6 opacity-40" />
                <span class="text-sm">No checks defined</span>
              </div>
            {:else if filteredChecks.length === 0}
              <div class="flex flex-col items-center py-6 gap-1 text-muted-foreground">
                <span class="text-sm">No checks match your search</span>
              </div>
            {:else}
              <div class="flex flex-col gap-2">
                {#each filteredChecks as check (check.id)}
                  <div class="flex items-center gap-3 p-3 rounded border bg-muted/20">
                    <div class="flex-1 flex flex-col gap-0.5 min-w-0">
                      <span class="text-sm font-medium truncate">{check.name}</span>
                      <span class="text-xs text-muted-foreground">
                        {formatCheckType(check.checkTypeId ?? '')}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      class="text-xs shrink-0 {severityClass[check.severity] ?? ''}"
                    >
                      {check.severity.charAt(0).toUpperCase() + check.severity.slice(1)}
                    </Badge>
                    <Button
                      variant="ghost"
                      onclick={() => openEditCheck(check)}
                      class="p-1.5! h-fit rounded text-muted-foreground hover:text-primary"
                    >
                      <Pencil class="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                      onclick={() => (deleteCheckTarget = check)}
                      class="p-1.5! h-fit rounded text-muted-foreground hover:text-destructive hover:bg-destructive/20!"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                {/each}
              </div>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="assignments" class="flex-1 overflow-y-auto p-4 mt-0 flex flex-col gap-3">
            <div class="flex items-center justify-between p-3 rounded border bg-muted/20">
              <div class="flex flex-col gap-0.5">
                <span class="text-sm font-medium">Integration Default</span>
                <span class="text-xs text-muted-foreground">Apply to all tenants by default</span>
              </div>
              <Switch
                disabled={!authStore.isAllowed('Integrations.Write')}
                checked={isDefaultEnabled}
                onCheckedChange={() => toggleDefaultAssignment(selectedFramework.id)}
              />
            </div>

            <div class="w-full border-t my-1"></div>

            <div class="flex flex-col gap-0.5">
              <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {isDefaultEnabled ? 'Excluded Tenants' : 'Included Tenants'}
              </span>
              <span class="text-xs text-muted-foreground">
                {isDefaultEnabled
                  ? 'These tenants will NOT have this framework applied.'
                  : 'Only these tenants will have this framework applied.'}
              </span>
            </div>

            {#if authStore.isAllowed('Integrations.Write') && availableToAdd.length > 0}
              <SingleSelect
                bind:selected={addOverrideSelected}
                placeholder={isDefaultEnabled ? 'Exclude a tenant...' : 'Include a tenant...'}
                options={availableToAdd.map((l) => ({
                  value: l.id,
                  label: l.name ?? l.externalId ?? l.id,
                }))}
                onchange={(linkId) => { if (linkId) addOverride(linkId); }}
              />
            {/if}

            {#if overrideLinks.length > 0}
              <Input bind:value={overrideSearch} placeholder="Filter tenants..." />
            {/if}

            {#if overrideLinks.length === 0}
              <div class="flex flex-col items-center py-4 gap-1 text-muted-foreground">
                <Globe class="size-5 opacity-40" />
                <span class="text-sm">
                  {isDefaultEnabled ? 'No exclusions — all tenants included' : 'No tenants included'}
                </span>
              </div>
            {:else}
              <div class="flex flex-col gap-2">
                {#each filteredOverrideLinks as link (link.id)}
                  <div class="flex items-center justify-between p-3 rounded border bg-muted/20">
                    <div class="flex items-center gap-2">
                      <Globe class="size-3.5 text-muted-foreground" />
                      <span class="text-sm">{link.name ?? link.externalId}</span>
                    </div>
                    <Button
                      variant="ghost"
                      disabled={!authStore.isAllowed('Integrations.Write')}
                      onclick={() => removeOverride(link.id)}
                      class="p-1.5! h-fit rounded text-muted-foreground hover:text-destructive hover:bg-destructive/20!"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </div>
                {/each}
              </div>
            {/if}
          </Tabs.Content>
        </Tabs.Root>
      </div>
    {:else}
      <div class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="flex flex-col items-center gap-2">
          <ShieldCheck class="size-8 opacity-40" />
          <span class="text-sm">Select a framework to view details</span>
        </div>
      </div>
    {/if}
  </div>
</div>
