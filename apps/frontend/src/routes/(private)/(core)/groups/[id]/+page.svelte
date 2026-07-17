<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';

  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { formatActionLabel } from '@mspbyte/shared';
  import { formatRelativeDate } from '$lib/utils/format';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id ?? '');

  const canWrite = $derived(authStore.isAllowed('Sites.Write'));

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
  }));

  const activityQuery = createQuery(() => ({
    queryKey: ['siteGroups.recentActivity', id],
    queryFn: () => trpc.siteGroups.recentActivity.query({ id, limit: 50 }),
    enabled: !!id,
  }));

  const memberSiteIds = $derived(new Set((membersQuery.data ?? []).map((m) => m.id)));
  const availableSiteOptions = $derived(
    (sitesQuery.data ?? [])
      .filter((s) => !memberSiteIds.has(s.id))
      .map((s) => ({ value: s.id, label: s.name }))
  );

  async function invalidateGroup() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['siteGroups.byId', id] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.members', id] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.recentActivity', id] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.list'] }),
    ]);
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
      goto('/groups');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  const canConfirmDelete = $derived(
    canWrite && deleteConfirm === (groupQuery.data?.name ?? '') && !remove.isPending
  );

  // Add members dialog
  let addOpen = $state(false);
  let selectedSiteIds = $state<string[]>([]);
  let adding = $state(false);
  $effect(() => {
    if (!addOpen) selectedSiteIds = [];
  });

  async function addMembers() {
    const ids = selectedSiteIds.filter((sid) => !memberSiteIds.has(sid));
    if (!ids.length) return;
    adding = true;
    try {
      await Promise.all(
        ids.map((siteId) => trpc.siteGroups.addMember.mutate({ siteGroupId: id, siteId }))
      );
      await invalidateGroup();
      selectedSiteIds = [];
      addOpen = false;
      toast.success(ids.length === 1 ? 'Site added' : `${ids.length} sites added`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add sites');
    } finally {
      adding = false;
    }
  }

  // Remove members (per-row pending)
  let removingSiteId = $state<string | null>(null);
  async function removeMember(siteId: string) {
    removingSiteId = siteId;
    try {
      await trpc.siteGroups.removeMember.mutate({ siteGroupId: id, siteId });
      await invalidateGroup();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove site');
    } finally {
      removingSiteId = null;
    }
  }

  // Activity: recent 5 in-panel; full log dialog
  let logOpen = $state(false);
  const recentActivity = $derived((activityQuery.data ?? []).slice(0, 5));
  const hasMoreActivity = $derived((activityQuery.data ?? []).length > 5);

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

{#if groupQuery.isLoading}
  <Loader />
{:else if groupQuery.error || !groupQuery.data}
  <div class="p-8 text-sm text-destructive">Group not found.</div>
{:else}
  {@const group = groupQuery.data}
  <FadeIn class="min-h-0 flex-1 overflow-auto">
    <header class="border-b border-foreground/15 bg-card">
      <div class="flex w-full flex-wrap items-end justify-between gap-3 px-6 pb-3 pt-4">
        <div class="flex min-w-0 items-baseline gap-3">
          <div class="min-w-0">
            <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">
              {group.name}
            </h1>
            {#if group.description}
              <p class="mt-0.5 max-w-3xl truncate text-xs text-muted-foreground">
                {group.description}
              </p>
            {/if}
          </div>
        </div>

        {#if canWrite}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <button
                  class="rounded-sm border border-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                  title="Group options"
                  aria-label="Group options"
                  {...props}
                >
                  <Ellipsis class="size-4" />
                </button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content class="w-40" align="end">
              <DropdownMenu.Item class="gap-2 cursor-pointer" onclick={() => (renameOpen = true)}>
                <Pencil class="size-3.5" /> Edit details
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                class="gap-2 cursor-pointer text-destructive focus:text-destructive"
                onclick={() => (deleteOpen = true)}
              >
                <Trash2 class="size-3.5" /> Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
      </div>
    </header>

    <div class="mx-auto max-w-[1200px] space-y-4 p-4 lg:p-6">
      <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <SectionPanel code="01" title="SITES">
          {#snippet aside()}
            <div class="flex items-center gap-3">
              <span>{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</span>
              {#if canWrite}
                <button
                  type="button"
                  class="inline-flex items-center gap-1 border border-border bg-background px-1.5 py-0.5 text-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                  aria-label="Add sites to group"
                  title="Add sites"
                  disabled={!availableSiteOptions.length || adding}
                  onclick={() => (addOpen = true)}
                >
                  <Plus class="size-3" />
                  <span class="tracking-[0.14em]">ADD SITES</span>
                </button>
              {/if}
            </div>
          {/snippet}

          {#if membersQuery.isLoading}
            <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
              loading…
            </p>
          {:else if (membersQuery.data ?? []).length}
            <dl>
              {#each membersQuery.data ?? [] as member (member.id)}
                {@const isRemoving = removingSiteId === member.id}
                <div
                  class="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 py-[7px] last:border-b-0"
                >
                  <a
                    href={`/sites/${member.id}`}
                    class="flex min-w-0 items-center gap-2 hover:text-primary"
                  >
                    <div class="min-w-0">
                      <div class="truncate text-sm">{member.name}</div>
                      {#if member.description}
                        <div class="truncate text-xs text-muted-foreground">
                          {member.description}
                        </div>
                      {/if}
                    </div>
                    <ArrowUpRight
                      class="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary"
                    />
                  </a>
                  {#if canWrite}
                    <button
                      type="button"
                      class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      aria-label={`Remove ${member.name}`}
                      title="Remove from group"
                      disabled={isRemoving}
                      onclick={() => removeMember(member.id)}
                    >
                      {#if isRemoving}
                        <LoaderCircle class="size-3.5 animate-spin" />
                      {:else}
                        <X class="size-3.5" />
                      {/if}
                    </button>
                  {/if}
                </div>
              {/each}
            </dl>
          {:else}
            <div
              class="flex flex-col items-start gap-2 py-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
            >
              <span>no sites in this group</span>
              {#if canWrite}
                <button
                  type="button"
                  class="inline-flex items-center gap-1 border border-border bg-background px-2 py-0.5 text-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                  disabled={!availableSiteOptions.length}
                  onclick={() => (addOpen = true)}
                >
                  <Plus class="size-3" />
                  <span class="tracking-[0.14em]">ADD FIRST SITE</span>
                </button>
              {/if}
            </div>
          {/if}
        </SectionPanel>

        <aside class="space-y-4">
          <SectionPanel code="~" title="ACTIVITY">
            {#snippet aside()}
              {#if hasMoreActivity}
                <button
                  type="button"
                  class="tracking-[0.14em] hover:text-foreground"
                  onclick={() => (logOpen = true)}
                >
                  VIEW LOG →
                </button>
              {/if}
            {/snippet}

            {#if activityQuery.isLoading}
              <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                loading…
              </p>
            {:else if recentActivity.length}
              <ol class="space-y-1.5">
                {#each recentActivity as event (event.id)}
                  <li
                    class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 border-b border-border/40 pb-1.5 last:border-b-0"
                  >
                    <span
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70"
                      title={formatDatetime(event.createdAt)}
                    >
                      {formatRelativeDate(event.createdAt)}
                    </span>
                    <span class="min-w-0">
                      <span class="truncate text-xs text-foreground/90">
                        {formatActionLabel(event.actionLabel, event.action)}
                      </span>
                      <span
                        class="ml-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                        >· {event.actorLabel}</span
                      >
                      {#if event.result !== 'success'}
                        <span class="ml-1 font-mono text-[10px] uppercase text-destructive"
                          >· {event.result}</span
                        >
                      {/if}
                    </span>
                  </li>
                {/each}
              </ol>
            {:else}
              <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                no activity yet
              </p>
            {/if}
          </SectionPanel>
        </aside>
      </div>
    </div>
  </FadeIn>
{/if}

<!-- Add sites (multi-select) -->
<Dialog.Root bind:open={addOpen}>
  <Dialog.Content class="sm:max-w-[520px]">
    <Dialog.Header>
      <Dialog.Title>Add sites to group</Dialog.Title>
      <Dialog.Description>Pick one or more sites. Existing members are hidden.</Dialog.Description>
    </Dialog.Header>
    <Separator />
    <div class="grid gap-3 p-4">
      <MultiSelect
        options={availableSiteOptions}
        bind:selected={selectedSiteIds}
        placeholder="Select sites..."
        searchPlaceholder="Search sites..."
        maxDisplay={3}
        disabled={adding}
      />
      <p class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {selectedSiteIds.length} selected
      </p>
    </div>
    <Dialog.Footer>
      <Button variant="ghost" disabled={adding} onclick={() => (addOpen = false)}>Cancel</Button>
      <Button disabled={adding || !selectedSiteIds.length} onclick={addMembers} class="gap-2">
        {#if adding}
          <LoaderCircle class="size-4 animate-spin" />
          Adding…
        {:else}
          Add {selectedSiteIds.length > 0 ? selectedSiteIds.length : ''}
          {selectedSiteIds.length === 1 ? 'site' : 'sites'}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Rename / edit details -->
<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>Edit group</Dialog.Title>
      <Dialog.Description>Update the group's name and description.</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-3 px-4 pb-2">
      <div class="grid gap-1.5">
        <Label for="group-name">Name</Label>
        <Input
          id="group-name"
          bind:value={renameName}
          placeholder="Group name"
          maxlength={200}
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
        <textarea
          id="group-description"
          bind:value={renameDescription}
          rows="3"
          class="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Optional"></textarea>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="ghost" disabled={rename.isPending} onclick={() => (renameOpen = false)}>
        Cancel
      </Button>
      <Button disabled={!canSaveRename} onclick={() => rename.mutate()} class="gap-2">
        {#if rename.isPending}
          <LoaderCircle class="size-4 animate-spin" />
          Saving…
        {:else}
          Save
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete confirm -->
<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this group?</AlertDialog.Title>
      <AlertDialog.Description>
        Removes the group and all site memberships. Sites themselves stay put. Any policy or
        framework assignments scoped to this group will stop matching.
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
      <Dialog.Description>Full audit trail for this group.</Dialog.Description>
    </Dialog.Header>
    <Separator />
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
                  {formatActionLabel(event.actionLabel, event.action)}
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
  </Dialog.Content>
</Dialog.Root>
