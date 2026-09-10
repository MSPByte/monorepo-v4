<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import {
    ArrowUpRight,
    LoaderCircle,
    Pencil,
    Plus,
    Trash2,
    ArrowLeft,
    Building2,
    Link2,
  } from '@lucide/svelte';

  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
    type SignalStripApi,
    type TableView,
  } from '$lib/components/data-table';
  import { relativeDateColumn } from '$lib/components/data-table/column-defs';
  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { ActionLabels, formatActionLabel } from '@mspbyte/shared';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id ?? '');

  const canWrite = $derived(authStore.isAllowed('Sites.Write'));
  let addOpen = $state(false);

  const groupQuery = createQuery(() => ({
    queryKey: ['siteGroups.byId', id],
    queryFn: () => trpc.siteGroups.byId.query({ id }),
    enabled: !!id,
  }));

  const membersQuery = createQuery(() => ({
    queryKey: ['siteGroups.members', id],
    queryFn: () => trpc.siteGroups.members.query({ id }),
    enabled: !!id,
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    enabled: canWrite && addOpen,
  }));
  const tenantLinksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list.groupMembers'],
    queryFn: () => trpc.integrationLinks.list.query({ status: 'active' }),
    enabled: canWrite && addOpen,
  }));

  const activityQuery = createQuery(() => ({
    queryKey: ['siteGroups.recentActivity', id],
    queryFn: () => trpc.siteGroups.recentActivity.query({ id, limit: 50 }),
    enabled: !!id,
  }));

  const memberSiteIds = $derived(new Set((membersQuery.data?.sites ?? []).map((m) => m.id)));
  const memberLinkIds = $derived(new Set((membersQuery.data?.links ?? []).map((m) => m.id)));
  const availableSiteOptions = $derived(
    (sitesQuery.data ?? [])
      .filter((s) => !memberSiteIds.has(s.id))
      .map((s) => ({ value: s.id, label: s.name }))
  );
  const availableTenantLinkOptions = $derived(
    (tenantLinksQuery.data ?? [])
      .filter((link) => INTEGRATIONS[link.integrationId as ProviderId]?.scope === 'tenant')
      .filter((link) => !memberLinkIds.has(link.id))
      .map((link) => ({
        value: link.id,
        label: link.name ?? link.externalId ?? link.id,
        subLabel: INTEGRATIONS[link.integrationId as ProviderId]?.name ?? link.integrationId,
      }))
  );

  let memberRefreshKey = $state(0);
  async function invalidateGroup() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['siteGroups.byId', id] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.members', id] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.recentActivity', id] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.list'] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.tableData'] }),
    ]);
    memberRefreshKey++;
  }

  // Rename dialog
  let renameOpen = $state(false);
  let renameName = $state('');
  let renameDescription = $state('');

  $effect(() => {
    if (renameOpen && groupQuery.data) {
      renameName = groupQuery.data.name;
      renameDescription = groupQuery.data.description ?? '';
    }
  });

  const rename = createMutation(() => ({
    mutationFn: () =>
      trpc.siteGroups.update.mutate({
        id,
        name: renameName.trim(),
        description: renameDescription.trim() || null,
      }),
    onSuccess: () => {
      renameOpen = false;
      toast.success('Group saved');
      invalidateGroup();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const canSaveRename = $derived.by(() => {
    if (!canWrite || rename.isPending) return false;
    const trimmed = renameName.trim();
    if (!trimmed) return false;
    const g = groupQuery.data;
    if (!g) return false;
    return trimmed !== g.name || renameDescription.trim() !== (g.description ?? '');
  });

  // Delete dialog
  let deleteOpen = $state(false);
  let deleteConfirm = $state('');
  $effect(() => {
    if (!deleteOpen) deleteConfirm = '';
  });

  const remove = createMutation(() => ({
    mutationFn: () => trpc.siteGroups.delete.mutate({ id }),
    onSuccess: () => {
      deleteOpen = false;
      toast.success('Group deleted');
      queryClient.invalidateQueries({ queryKey: ['siteGroups.list'] });
      queryClient.invalidateQueries({ queryKey: ['siteGroups.tableData'] });
      goto('/groups');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  const canConfirmDelete = $derived(
    canWrite && deleteConfirm === (groupQuery.data?.name ?? '') && !remove.isPending
  );

  // Add members dialog
  let selectedSiteIds = $state<string[]>([]);
  let selectedLinkIds = $state<string[]>([]);
  let adding = $state(false);
  $effect(() => {
    if (!addOpen) {
      selectedSiteIds = [];
      selectedLinkIds = [];
    }
  });

  let addError = $state('');
  async function addMembers() {
    if (!canWrite || adding || !membersQuery.data || membersQuery.isError) return;
    const ids = selectedSiteIds.filter((sid) => !memberSiteIds.has(sid));
    const linkIds = selectedLinkIds.filter((lid) => !memberLinkIds.has(lid));
    if (!ids.length && !linkIds.length) return;
    adding = true;
    addError = '';
    try {
      const results = await Promise.allSettled([
        ...ids.map((siteId) => trpc.siteGroups.addMember.mutate({ siteGroupId: id, siteId })),
        ...linkIds.map((integrationLinkId) =>
          trpc.siteGroups.addLinkMember.mutate({ siteGroupId: id, integrationLinkId })
        ),
      ]);
      selectedSiteIds = ids.filter((_, index) => results[index].status === 'rejected');
      selectedLinkIds = linkIds.filter(
        (_, index) => results[ids.length + index].status === 'rejected'
      );
      const failed = selectedSiteIds.length + selectedLinkIds.length;
      const succeeded = results.length - failed;
      await invalidateGroup();
      if (succeeded)
        toast.success(`${succeeded} ${succeeded === 1 ? 'member added' : 'members added'}`);
      if (failed)
        addError = `${failed} ${failed === 1 ? 'member could' : 'members could'} not be added. Your remaining selections are kept. Try again.`;
      else addOpen = false;
    } finally {
      adding = false;
    }
  }

  type Member = {
    id: string;
    name: string;
    description: string;
    kind: 'site' | 'link';
    addedAt: string;
  };
  const members = $derived<Member[]>(
    [
      ...(membersQuery.data?.sites ?? []).map((member) => ({
        ...member,
        description: member.description ?? '',
        kind: 'site' as const,
      })),
      ...(membersQuery.data?.links ?? []).map((member) => ({
        ...member,
        name: member.name ?? member.id,
        description: member.integrationName,
        kind: 'link' as const,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name))
  );
  const memberColumns = $derived<DataTableColumn<Member>[]>([
    { key: 'name', title: 'Member', sortable: true, cell: memberCell, hideable: false },
    {
      key: 'kind',
      title: 'Type',
      cell: typeCell,
      width: '120px',
      exportValue: ({ row }) => (row.kind === 'site' ? 'Site' : 'Tenant link'),
    },
    relativeDateColumn<Member>('addedAt', 'Added to group', { width: '160px' }),
    ...(canWrite
      ? [{ key: 'actions', title: '', cell: removeCell, width: '48px', hideable: false }]
      : []),
  ]);
  const memberViews: TableView<Member>[] = [
    { id: 'sites', label: 'Sites', filters: [{ field: 'kind', operator: 'eq', value: 'site' }] },
    {
      id: 'links',
      label: 'Tenant links',
      filters: [{ field: 'kind', operator: 'eq', value: 'link' }],
    },
  ];
  async function fetchMembers(input: PaginationInput) {
    const result = await membersQuery.refetch();
    if (result.isError) throw result.error;
    const currentMembers: Member[] = [
      ...(result.data?.sites ?? []).map((member) => ({
        ...member,
        description: member.description ?? '',
        kind: 'site' as const,
      })),
      ...(result.data?.links ?? []).map((member) => ({
        ...member,
        name: member.name ?? member.id,
        description: member.integrationName,
        kind: 'link' as const,
      })),
    ];
    const search = input.globalSearch.trim().toLowerCase();
    const filtered = currentMembers.filter(
      (member) =>
        `${member.name} ${member.description}`.toLowerCase().includes(search) &&
        input.filters.every((filter) => filter.field !== 'kind' || member.kind === filter.value)
    );
    const field = input.sortField === 'addedAt' ? 'addedAt' : 'name';
    filtered.sort((a, b) => a[field].localeCompare(b[field]) * (input.sortDir === 'desc' ? -1 : 1));
    return {
      rows: filtered.slice(input.page * input.pageSize, (input.page + 1) * input.pageSize),
      total: filtered.length,
    };
  }
  let memberToRemove = $state<Member | null>(null);
  let removeMemberOpen = $state(false);
  let removingMember = $state(false);
  async function confirmRemoveMember() {
    if (!canWrite || !memberToRemove || removingMember) return;
    removingMember = true;
    try {
      if (memberToRemove.kind === 'site')
        await trpc.siteGroups.removeMember.mutate({ siteGroupId: id, siteId: memberToRemove.id });
      else
        await trpc.siteGroups.removeLinkMember.mutate({
          siteGroupId: id,
          integrationLinkId: memberToRemove.id,
        });
      await invalidateGroup();
      removeMemberOpen = false;
      toast.success('Member removed from group');
    } catch (error) {
      showErrorToast(error, 'Failed to remove member.');
    } finally {
      removingMember = false;
    }
  }

  // Activity: recent 5 in-panel; full log dialog
  let logOpen = $state(false);
  const recentActivity = $derived((activityQuery.data ?? []).slice(0, 5));
  const hasMoreActivity = $derived((activityQuery.data ?? []).length > 5);

  function activityLabel(label: string | null, action: string) {
    const labels: Partial<Record<ActionLabels, string>> = {
      [ActionLabels.SiteGroupCreate]: 'Group created',
      [ActionLabels.SiteGroupUpdate]: 'Group details updated',
      [ActionLabels.SiteGroupDelete]: 'Group deleted',
      [ActionLabels.SiteGroupMemberAdd]: 'Member added',
      [ActionLabels.SiteGroupMemberRemove]: 'Member removed',
    };
    return labels[label as ActionLabels] ?? formatActionLabel(label, action);
  }

  function formatDatetime(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<svelte:head><title>{groupQuery.data?.name ?? 'Group'} · Groups · MSPByte</title></svelte:head>

{#snippet memberCell({ row }: { row: Member })}
  <div class="flex min-w-0 items-center gap-2">
    {#if row.kind === 'site'}<Building2
        class="size-4 shrink-0 text-muted-foreground"
      />{:else}<Link2 class="size-4 shrink-0 text-muted-foreground" />{/if}
    <div class="min-w-0">
      {#if row.kind === 'site'}<a
          href={`/sites/${row.id}`}
          class="inline-flex items-center gap-1 font-medium hover:text-primary hover:underline"
          >{row.name}<ArrowUpRight class="size-3" /></a
        >{:else}<span class="font-medium">{row.name}</span>{/if}
      {#if row.description}<p
          class="mt-1 max-w-sm truncate text-xs text-muted-foreground"
          title={row.description}
        >
          {row.description}
        </p>{/if}
    </div>
  </div>
{/snippet}
{#snippet typeCell({ row }: { row: Member })}<span class="text-xs text-muted-foreground"
    >{row.kind === 'site' ? 'Site' : 'Tenant link'}</span
  >{/snippet}
{#snippet removeCell({ row }: { row: Member })}
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label={`Remove ${row.name} from group`}
    title="Remove from group"
    onclick={() => {
      memberToRemove = row;
      removeMemberOpen = true;
    }}><Trash2 class="size-3.5" /></Button
  >
{/snippet}
{#snippet memberStrip(api: SignalStripApi)}
  <nav
    class="flex shrink-0 items-center gap-5 overflow-x-auto border-b border-border bg-muted/30 px-4"
    aria-label="Member views"
  >
    {#each [{ id: undefined, label: 'All members', count: members.length }, { id: 'sites', label: 'Sites', count: memberSiteIds.size }, { id: 'links', label: 'Tenant links', count: memberLinkIds.size }] as view}
      <button
        class="flex shrink-0 items-center gap-2 border-b-2 py-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring {api.activeViewId ===
        view.id
          ? 'border-primary font-medium text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
        aria-pressed={api.activeViewId === view.id}
        onclick={() => {
          api.clearFilters();
          api.setView(view.id);
        }}>{view.label}<span class="font-mono text-[10px] tabular-nums">{view.count}</span></button
      >
    {/each}
  </nav>
{/snippet}

<div class="flex h-full min-h-0 flex-col overflow-auto">
  <header class="shrink-0 border-b border-border bg-card px-6 py-4">
    <a
      href="/groups"
      class="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      ><ArrowLeft class="size-3.5" />Groups</a
    >
    {#if groupQuery.data}
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <h1 class="break-words text-2xl font-semibold tracking-tight">{groupQuery.data.name}</h1>
          {#if groupQuery.data.description}<p
              class="mt-1 max-w-3xl whitespace-pre-line break-words text-sm text-muted-foreground"
            >
              {groupQuery.data.description}
            </p>{/if}
          <div
            class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground"
          >
            <span
              >Created <time title={formatDatetime(groupQuery.data.createdAt)}
                >{formatRelativeDate(groupQuery.data.createdAt)}</time
              ></span
            ><span
              >Last edited <time title={formatDatetime(groupQuery.data.updatedAt)}
                >{formatRelativeDate(groupQuery.data.updatedAt)}</time
              ></span
            >
          </div>
        </div>
        {#if canWrite}<div class="flex items-center gap-2">
            <Button variant="outline" size="sm" onclick={() => (renameOpen = true)}
              ><Pencil class="size-3.5" />Edit details</Button
            ><Button
              size="sm"
              disabled={!membersQuery.data || membersQuery.isError}
              onclick={() => {
                addError = '';
                addOpen = true;
              }}><Plus class="size-3.5" />Add members</Button
            >
          </div>{/if}
      </div>
    {/if}
  </header>
  {#if groupQuery.isPending}<Loader />
  {:else if groupQuery.isError || !groupQuery.data}<div
      class="flex flex-col items-start gap-3 p-6"
      role="alert"
    >
      <h2 class="text-lg font-semibold">Group unavailable</h2>
      <p class="text-sm text-muted-foreground">
        The group may have been removed, or you may not have access.
      </p>
      <Button variant="outline" onclick={() => groupQuery.refetch()}>Try again</Button>
    </div>
  {:else}
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section
        class="flex min-h-[28rem] min-w-0 flex-col gap-3 xl:min-h-0"
        aria-label="Group members"
      >
        <h2 class="text-sm font-semibold">Members</h2>
        {#if membersQuery.isPending}<Loader />
        {:else if membersQuery.isError}<div
            class="flex items-center gap-3 text-sm text-destructive"
            role="alert"
          >
            Members couldn’t be loaded.<Button
              variant="outline"
              size="sm"
              onclick={() => membersQuery.refetch()}>Try again</Button
            >
          </div>
        {:else if !members.length}<div
            class="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-border bg-card p-6 text-center"
          >
            <Building2 class="size-6 text-muted-foreground" />
            <h3 class="text-base font-medium">No members yet</h3>
            <p class="max-w-sm text-sm text-muted-foreground">
              Add sites or tenant links to include them in this group’s scope.
            </p>
            {#if canWrite}<Button
                size="sm"
                onclick={() => {
                  addError = '';
                  addOpen = true;
                }}><Plus class="size-4" />Add members</Button
              >{/if}
          </div>
        {:else}<DataTable
            fetchData={fetchMembers}
            columns={memberColumns}
            views={memberViews}
            refreshKey={memberRefreshKey}
            enableFilters={false}
            enableViewSelector={false}
            defaultPageSize={25}
            defaultSort={{ field: 'name', dir: 'asc' }}
            signalStrip={memberStrip}
          />{/if}
      </section>
      <aside class="space-y-4 overflow-auto">
        <SectionPanel title="Recent activity">
          {#snippet aside()}{#if hasMoreActivity}<button
                class="hover:text-primary"
                onclick={() => (logOpen = true)}>View log →</button
              >{/if}{/snippet}
          {#if activityQuery.isPending}<p class="text-xs text-muted-foreground" role="status">
              Loading activity…
            </p>
          {:else if activityQuery.isError}<div class="text-xs text-destructive" role="alert">
              Activity couldn’t be loaded. <button
                class="underline"
                onclick={() => activityQuery.refetch()}>Try again</button
              >
            </div>
          {:else if recentActivity.length}<ol class="divide-y divide-border/50">
              {#each recentActivity as event (event.id)}<li class="py-3 first:pt-0 last:pb-0">
                  <p class="text-xs font-medium">
                    {activityLabel(event.actionLabel, event.action)}
                  </p>
                  <div
                    class="mt-1 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span>{event.actorLabel}</span><time title={formatDatetime(event.createdAt)}
                      >{formatRelativeDate(event.createdAt)}</time
                    >
                  </div>
                  {#if event.result !== 'success'}<p class="mt-1 text-xs text-destructive">
                      {event.result}
                    </p>{/if}
                </li>{/each}
            </ol>
          {:else}<p class="text-xs text-muted-foreground">No recorded changes yet.</p>{/if}
        </SectionPanel>
        <SectionPanel title="Membership scope"
          ><p class="text-xs leading-relaxed text-muted-foreground">
            Changes to membership affect policies, packages, and reports scoped to this group.
            Removing a member keeps the site or tenant link available.
          </p></SectionPanel
        >
        {#if canWrite}<Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground hover:text-destructive"
            onclick={() => (deleteOpen = true)}><Trash2 class="size-3.5" />Delete group</Button
          >{/if}
      </aside>
    </div>
  {/if}
</div>

<AlertDialog.Root bind:open={removeMemberOpen}>
  <AlertDialog.Content
    onEscapeKeydown={(event) => {
      if (removingMember) event.preventDefault();
    }}
  >
    <AlertDialog.Header
      ><AlertDialog.Title>Remove member from group?</AlertDialog.Title><AlertDialog.Description
        >Remove {memberToRemove?.name} from {groupQuery.data?.name}? The {memberToRemove?.kind ===
        'site'
          ? 'site'
          : 'tenant link'} will remain available, but assignments scoped to this group may no longer apply
        to it.</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel disabled={removingMember}>Cancel</AlertDialog.Cancel><Button
        variant="destructive"
        disabled={removingMember}
        onclick={confirmRemoveMember}
        >{#if removingMember}<LoaderCircle class="size-4 animate-spin" />Removing…{:else}Remove
          member{/if}</Button
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- Add sites (multi-select) -->
<Dialog.Root bind:open={addOpen}>
  <Dialog.Content
    class="sm:max-w-[520px]"
    showCloseButton={!adding}
    onInteractOutside={(event) => {
      if (adding) event.preventDefault();
    }}
    onEscapeKeydown={(event) => {
      if (adding) event.preventDefault();
    }}
  >
    <Dialog.Header>
      <Dialog.Title>Add members to group</Dialog.Title>
      <Dialog.Description>
        Choose sites, tenant links, or both. Members already in this group are excluded.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      <div class="grid gap-3">
        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">Sites</legend>
          <MultiSelect
            options={availableSiteOptions}
            bind:selected={selectedSiteIds}
            placeholder="Select sites…"
            loading={sitesQuery.isLoading}
            searchPlaceholder="Search sites..."
            maxDisplay={3}
            disabled={adding || sitesQuery.isError || sitesQuery.isLoading}
          />
        </fieldset>
        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">Tenant links</legend>
          <MultiSelect
            options={availableTenantLinkOptions}
            bind:selected={selectedLinkIds}
            placeholder="Select tenant links…"
            loading={tenantLinksQuery.isLoading}
            searchPlaceholder="Search tenant links..."
            maxDisplay={3}
            disabled={adding || tenantLinksQuery.isError || tenantLinksQuery.isLoading}
          />
        </fieldset>
        {#if sitesQuery.isError}<div class="text-sm text-destructive" role="alert">
            Sites couldn’t be loaded. <button class="underline" onclick={() => sitesQuery.refetch()}
              >Try again</button
            >
          </div>{:else if sitesQuery.isSuccess && !availableSiteOptions.length}<p
            class="text-xs text-muted-foreground"
          >
            No additional sites are available to add.
          </p>{/if}
        {#if tenantLinksQuery.isError}<div class="text-sm text-destructive" role="alert">
            Tenant links couldn’t be loaded. <button
              class="underline"
              onclick={() => tenantLinksQuery.refetch()}>Try again</button
            >
          </div>{:else if tenantLinksQuery.isSuccess && !availableTenantLinkOptions.length}<p
            class="text-xs text-muted-foreground"
          >
            No additional active tenant links are available to add.
          </p>{/if}
        {#if addError}<p class="text-sm text-destructive" role="alert">{addError}</p>{/if}
        <p class="text-xs text-muted-foreground" aria-live="polite">
          {selectedSiteIds.length + selectedLinkIds.length} selected
        </p>
      </div>
    </Dialog.Body><Dialog.Footer>
      <Button variant="ghost" disabled={adding} onclick={() => (addOpen = false)}>Cancel</Button>
      <Button
        disabled={adding ||
          membersQuery.isError ||
          !membersQuery.data ||
          selectedSiteIds.length + selectedLinkIds.length === 0}
        onclick={addMembers}
        class="gap-2"
      >
        {#if adding}
          <LoaderCircle class="size-4 animate-spin" />
          Adding…
        {:else}
          Add {selectedSiteIds.length + selectedLinkIds.length > 0
            ? selectedSiteIds.length + selectedLinkIds.length
            : ''}
          {selectedSiteIds.length + selectedLinkIds.length === 1 ? 'member' : 'members'}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Rename / edit details -->
<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content
    class="sm:max-w-[460px]"
    showCloseButton={!rename.isPending}
    onInteractOutside={(event) => {
      if (rename.isPending) event.preventDefault();
    }}
    onEscapeKeydown={(event) => {
      if (rename.isPending) event.preventDefault();
    }}
  >
    <Dialog.Header>
      <Dialog.Title>Edit group</Dialog.Title>
      <Dialog.Description>Update the group's name and description.</Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      <div class="grid gap-3">
        <div class="grid gap-1.5">
          <Label for="group-name">Name</Label>
          <Input
            id="group-name"
            bind:value={renameName}
            placeholder="Group name"
            maxlength={200}
            disabled={rename.isPending}
            onkeydown={(event) => {
              if (event.key === 'Enter' && canSaveRename) {
                event.preventDefault();
                rename.mutate();
              }
            }}
          />
        </div>
        <div class="grid gap-1.5">
          <Label for="group-description">Description</Label>
          <Textarea
            id="group-description"
            bind:value={renameDescription}
            rows={3}
            maxlength={2000}
            disabled={rename.isPending}
            class="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Optional"
          ></Textarea>
        </div>
      </div>
    </Dialog.Body><Dialog.Footer>
      <Button variant="ghost" disabled={rename.isPending} onclick={() => (renameOpen = false)}>
        Cancel
      </Button>
      <Button disabled={!canSaveRename} onclick={() => rename.mutate()} class="gap-2">
        {#if rename.isPending}
          <LoaderCircle class="size-4 animate-spin" />
          Saving…
        {:else}
          Save changes
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete confirm -->
<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content
    onEscapeKeydown={(event) => {
      if (remove.isPending) event.preventDefault();
    }}
  >
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this group?</AlertDialog.Title>
      <AlertDialog.Description>
        Removes this group and its site and tenant link memberships. The sites and tenant links
        remain available. Assignments scoped to this group will stop matching.
      </AlertDialog.Description>
    </AlertDialog.Header>

    <div class="grid gap-2 py-2">
      <Label for="group-delete-confirm">
        Type <span class="font-mono text-foreground">{groupQuery.data?.name ?? ''}</span> to confirm
      </Label>
      <Input
        id="group-delete-confirm"
        bind:value={deleteConfirm}
        placeholder={groupQuery.data?.name ?? ''}
        autocomplete="off"
      />
    </div>

    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={remove.isPending}>Cancel</AlertDialog.Cancel>
      <Button
        variant="destructive"
        disabled={!canConfirmDelete}
        onclick={() => remove.mutate()}
        class="gap-2"
      >
        {#if remove.isPending}
          <LoaderCircle class="size-4 animate-spin" />
          Deleting…
        {:else}
          Delete group
        {/if}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- Full audit log -->
<Dialog.Root bind:open={logOpen}>
  <Dialog.Content class="sm:max-w-[620px]">
    <Dialog.Header>
      <Dialog.Title>Activity log</Dialog.Title>
      <Dialog.Description>The latest 50 recorded changes to this group.</Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      <div class="max-h-[60vh] overflow-y-auto">
        {#if (activityQuery.data ?? []).length}
          <ol class="divide-y divide-border/50">
            {#each activityQuery.data ?? [] as event (event.id)}
              <li class="grid grid-cols-[130px_minmax(0,1fr)] gap-3 px-4 py-2 text-sm">
                <span
                  class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  title={formatDatetime(event.createdAt)}
                >
                  {formatDatetime(event.createdAt)}
                </span>
                <span class="min-w-0">
                  <span class="block truncate">
                    {activityLabel(event.actionLabel, event.action)}
                  </span>
                  <span
                    class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80"
                  >
                    {event.actorLabel}
                    {#if event.result !== 'success'}
                      · <span class="text-destructive">{event.result}</span>
                    {/if}
                  </span>
                </span>
              </li>
            {/each}
          </ol>
        {:else}
          <p
            class="p-8 text-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
          >
            no activity
          </p>
        {/if}
      </div>
    </Dialog.Body></Dialog.Content
  >
</Dialog.Root>
