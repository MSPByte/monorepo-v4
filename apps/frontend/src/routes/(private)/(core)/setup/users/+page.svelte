<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { enhance } from '$app/forms';
  import type { createTrpcClient } from '$lib/trpc';
  import { DataTable } from '$lib/components/data-table';
  import type {
    DataTableColumn,
    PaginationInput,
    RowAction,
  } from '$lib/components/data-table/types';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import UserPlusIcon from '@lucide/svelte/icons/user-plus';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Separator from '$lib/components/ui/separator/separator.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const canWriteUsers = $derived(authStore.isAllowed('Users.Write'));
  const canDeleteUsers = $derived(authStore.isAllowed('Users.Delete'));

  let addDialogOpen = $state(false);
  let formError = $state<string | null>(null);
  let submitting = $state(false);
  let selectedRoleId = $state<string | undefined>(undefined);
  let refreshKey = $state(0);

  // Grants dialog state
  let grantsOpen = $state(false);
  let grantsUserId = $state<string | null>(null);
  let grantsUserLabel = $state<string>('');
  let grantsRefresh = $state(0);
  let addGrantRoleId = $state<string | undefined>(undefined);
  let addGrantScopeKind = $state<'all' | 'sites'>('all');
  let addGrantScopeSites = $state<string[]>([]);
  let grantSubmitting = $state(false);
  let grantError = $state<string | null>(null);

  // Edit-scope state — populated when user clicks the pencil on a grant row.
  let editingGrantId = $state<string | null>(null);
  let editScopeKind = $state<'all' | 'sites'>('all');
  let editScopeSites = $state<string[]>([]);
  let editSubmitting = $state(false);
  let editError = $state<string | null>(null);

  const rolesQuery = createQuery(() => ({
    queryKey: ['roles.list'],
    queryFn: () => trpc.roles.list.query(),
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const roleOptions = $derived(
    (rolesQuery.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (level ${r.level})` }))
  );

  const siteOptions = $derived(
    (sitesQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))
  );

  const grantsQuery = createQuery(() => ({
    queryKey: ['users.listGrants', grantsUserId, grantsRefresh],
    queryFn: () =>
      grantsUserId ? trpc.users.listGrants.query({ userId: grantsUserId }) : Promise.resolve([]),
    enabled: !!grantsUserId,
  }));

  type UserRow = {
    id: string;
    name: string | null;
    email: string;
    role: string;
    [key: string]: unknown;
  };

  const columns: DataTableColumn<UserRow>[] = [
    { key: 'name', title: 'Name', sortable: true, searchable: true },
    { key: 'email', title: 'Email', sortable: true, searchable: true },
    { key: 'role', title: 'Primary Role', sortable: true },
  ];

  const rowActions: RowAction<UserRow>[] = $derived.by(() => {
    const actions: RowAction<UserRow>[] = [];
    if (canWriteUsers) {
      actions.push({
        label: 'Manage grants',
        icon: ShieldIcon,
        onclick(rows) {
          const r = rows[0];
          if (!r) return;
          openGrants(r);
        },
      });
    }
    if (canDeleteUsers) {
      actions.push({
        label: 'Delete',
        icon: Trash2,
        variant: 'destructive',
        async onclick(rows) {
          await Promise.all(rows.map((r) => trpc.users.delete.mutate({ id: r.id })));
          refreshKey++;
        },
      });
    }
    return actions;
  });

  async function fetchData(opts: PaginationInput): Promise<{ rows: UserRow[]; total: number }> {
    const raw = await trpc.users.list.query();

    const rows: UserRow[] = raw.map((u) => ({
      id: u.id,
      name: u.name ?? null,
      email: u.email,
      role: u.role?.name ?? '—',
    }));

    const search = opts.globalSearch.toLowerCase();
    const filtered = search
      ? rows.filter(
          (r) =>
            (r.name ?? '').toLowerCase().includes(search) ||
            r.email.toLowerCase().includes(search) ||
            r.role.toLowerCase().includes(search)
        )
      : rows;

    const sorted = opts.sortField
      ? [...filtered].sort((a, b) => {
          const av = String(a[opts.sortField!] ?? '');
          const bv = String(b[opts.sortField!] ?? '');
          return opts.sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
        })
      : filtered;

    const start = opts.page * opts.pageSize;
    return Promise.resolve({
      rows: sorted.slice(start, start + opts.pageSize),
      total: sorted.length,
    });
  }

  function openGrants(user: UserRow) {
    grantsUserId = user.id;
    grantsUserLabel = user.name || user.email;
    grantsOpen = true;
    resetAddGrantForm();
  }

  function resetAddGrantForm() {
    addGrantRoleId = undefined;
    addGrantScopeKind = 'all';
    addGrantScopeSites = [];
    grantError = null;
  }

  async function submitAddGrant() {
    if (!grantsUserId || !addGrantRoleId) return;
    grantSubmitting = true;
    grantError = null;
    try {
      const scope =
        addGrantScopeKind === 'all'
          ? ({ kind: 'all' } as const)
          : ({ kind: 'sites', ids: addGrantScopeSites } as const);
      if (scope.kind === 'sites' && scope.ids.length === 0) {
        grantError = 'Select at least one site';
        return;
      }
      await trpc.users.addGrant.mutate({
        userId: grantsUserId,
        roleId: addGrantRoleId,
        scope,
      });
      toast.success('Grant added');
      resetAddGrantForm();
      grantsRefresh++;
    } catch (err: unknown) {
      grantError = err instanceof Error ? err.message : String(err);
    } finally {
      grantSubmitting = false;
    }
  }

  const siteLabel = $derived((id: string) => {
    return siteOptions.find((s) => s.value === id)?.label ?? id.slice(0, 8) + '…';
  });

  function beginEdit(grant: {
    id: string;
    scopeKind: string;
    scopeIds: readonly string[] | string[];
  }) {
    editingGrantId = grant.id;
    editScopeKind = grant.scopeKind === 'sites' ? 'sites' : 'all';
    editScopeSites = [...grant.scopeIds];
    editError = null;
  }

  function cancelEdit() {
    editingGrantId = null;
    editError = null;
  }

  async function submitEdit() {
    if (!editingGrantId) return;
    editSubmitting = true;
    editError = null;
    try {
      const scope =
        editScopeKind === 'all'
          ? ({ kind: 'all' } as const)
          : ({ kind: 'sites', ids: editScopeSites } as const);
      if (scope.kind === 'sites' && scope.ids.length === 0) {
        editError = 'Select at least one site';
        return;
      }
      await trpc.users.updateGrantScope.mutate({ grantId: editingGrantId, scope });
      toast.success('Scope updated');
      editingGrantId = null;
      grantsRefresh++;
    } catch (err: unknown) {
      editError = err instanceof Error ? err.message : String(err);
    } finally {
      editSubmitting = false;
    }
  }

  async function removeGrant(grantId: string) {
    try {
      await trpc.users.removeGrant.mutate({ grantId });
      toast.success('Grant removed');
      grantsRefresh++;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }
</script>

<div class="flex size-full p-4 overflow-hidden">
  <div class="flex flex-col size-full gap-2">
    {#if canWriteUsers}
      <div class="flex justify-end">
        <Dialog.Root bind:open={addDialogOpen}>
          <Dialog.Trigger>
            {#snippet child({ props })}
              <Button {...props} size="sm" class="gap-2">
                <UserPlusIcon class="h-4 w-4" />
                Add User
              </Button>
            {/snippet}
          </Dialog.Trigger>
          <Dialog.Content class="max-w-md p-0!">
            <Dialog.Header class="px-4 pt-4">
              <Dialog.Title>Add User</Dialog.Title>
              <Dialog.Description>Create a new user in your organization.</Dialog.Description>
            </Dialog.Header>
            <Separator />
            <form
              method="POST"
              action="?/addUser"
              class="flex flex-col gap-4"
              use:enhance={() => {
                submitting = true;
                formError = null;
                return async ({ result, update }) => {
                  submitting = false;
                  if (result.type === 'success') {
                    addDialogOpen = false;
                    selectedRoleId = undefined;
                    refreshKey++;
                    await update();
                  } else if (result.type === 'failure') {
                    formError =
                      (result.data as { error?: string })?.error ?? 'Something went wrong';
                  }
                };
              }}
            >
              <div class="flex flex-col gap-4 p-4">
                <div class="flex flex-col gap-2">
                  <Label for="name">Name</Label>
                  <Input id="name" name="name" placeholder="John Doe" required />
                </div>
                <div class="flex flex-col gap-2">
                  <Label for="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="john@example.com"
                    required
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <Label>Initial Role</Label>
                  <SingleSelect
                    options={roleOptions}
                    bind:selected={selectedRoleId}
                    placeholder="Select role..."
                  />
                  <input type="hidden" name="roleId" value={selectedRoleId ?? ''} />
                  <p class="text-xs text-muted-foreground">
                    User will get an unscoped grant to this role. Add scoped grants after via
                    "Manage grants."
                  </p>
                </div>
              </div>
              {#if formError}
                <p class="text-sm text-destructive px-4">{formError}</p>
              {/if}
              <Dialog.Footer class="px-4 pb-4">
                <Button type="button" variant="outline" onclick={() => (addDialogOpen = false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting || !selectedRoleId}>
                  {submitting ? 'Adding...' : 'Add User'}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Content>
        </Dialog.Root>
      </div>
    {/if}

    <DataTable
      {columns}
      {fetchData}
      {refreshKey}
      {rowActions}
      enableRowSelection={rowActions.length > 0}
      enableGlobalSearch
      enableFilters={false}
      enableExport={false}
      enableURLState={false}
      defaultPageSize={50}
    />
  </div>
</div>

<Dialog.Root bind:open={grantsOpen}>
  <Dialog.Content class="max-w-xl p-0!">
    <Dialog.Header class="px-4 pt-4">
      <Dialog.Title>Manage grants — {grantsUserLabel}</Dialog.Title>
      <Dialog.Description>
        Each grant assigns a role at a specific scope. A user may hold multiple grants.
      </Dialog.Description>
    </Dialog.Header>
    <Separator />

    <div class="flex flex-col gap-4 p-4">
      <div class="flex flex-col gap-2">
        <h4 class="text-sm font-medium">Current grants</h4>
        {#if grantsQuery.isLoading}
          <p class="text-xs text-muted-foreground">Loading…</p>
        {:else if (grantsQuery.data ?? []).length === 0}
          <p class="text-xs text-muted-foreground">No grants yet.</p>
        {:else}
          <div class="flex flex-col border rounded-md divide-y">
            {#each grantsQuery.data ?? [] as g (g.id)}
              <div class="flex flex-col p-2 gap-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex flex-col text-sm gap-1">
                    <div class="flex items-center gap-2">
                      <strong>{g.role.name}</strong>
                      <Badge variant="secondary">Level {g.role.level}</Badge>
                      {#if g.role.isSystem}
                        <Badge variant="outline">System</Badge>
                      {/if}
                    </div>
                    <div class="text-xs text-muted-foreground">
                      Scope:
                      {#if g.scopeKind === 'all'}
                        <Badge variant="secondary">all sites</Badge>
                      {:else if g.scopeKind === 'sites'}
                        <span>
                          {g.scopeIds.length} site{g.scopeIds.length === 1 ? '' : 's'}
                        </span>
                      {:else}
                        <span>{g.scopeKind}</span>
                      {/if}
                    </div>
                    {#if g.scopeKind === 'sites' && g.scopeIds.length > 0 && editingGrantId !== g.id}
                      <div class="flex flex-wrap gap-1 pt-1">
                        {#each g.scopeIds as siteId}
                          <Badge variant="outline" class="font-normal">
                            {siteLabel(siteId)}
                          </Badge>
                        {/each}
                      </div>
                    {/if}
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    {#if editingGrantId === g.id}
                      <Button variant="ghost" size="sm" onclick={cancelEdit}>Cancel</Button>
                    {:else}
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => beginEdit(g)}
                        title="Edit scope"
                      >
                        <PencilIcon class="h-4 w-4" />
                      </Button>
                    {/if}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => removeGrant(g.id)}
                      title="Remove grant"
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {#if editingGrantId === g.id}
                  <div class="flex flex-col gap-3 border-t pt-3">
                    <div class="flex flex-col gap-2">
                      <Label>Scope</Label>
                      <SingleSelect
                        options={[
                          { value: 'all', label: 'All sites (unscoped)' },
                          { value: 'sites', label: 'Specific sites' },
                        ]}
                        bind:selected={editScopeKind as unknown as string}
                      />
                    </div>
                    {#if editScopeKind === 'sites'}
                      <div class="flex flex-col gap-2">
                        <Label>Sites</Label>
                        <MultiSelect
                          options={siteOptions}
                          bind:selected={editScopeSites}
                          placeholder="Choose sites..."
                          searchPlaceholder="Filter sites..."
                        />
                      </div>
                    {/if}
                    {#if editError}
                      <p class="text-sm text-destructive">{editError}</p>
                    {/if}
                    <div class="flex justify-end">
                      <Button onclick={submitEdit} disabled={editSubmitting}>
                        {editSubmitting ? 'Saving...' : 'Save scope'}
                      </Button>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <Separator />

      <div class="flex flex-col gap-3">
        <h4 class="text-sm font-medium">Add grant</h4>
        <div class="flex flex-col gap-2">
          <Label>Role</Label>
          <SingleSelect
            options={roleOptions}
            bind:selected={addGrantRoleId}
            placeholder="Choose role..."
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label>Scope</Label>
          <SingleSelect
            options={[
              { value: 'all', label: 'All sites (unscoped)' },
              { value: 'sites', label: 'Specific sites' },
            ]}
            bind:selected={addGrantScopeKind as unknown as string}
          />
        </div>
        {#if addGrantScopeKind === 'sites'}
          <div class="flex flex-col gap-2">
            <Label>Sites</Label>
            <MultiSelect
              options={siteOptions}
              bind:selected={addGrantScopeSites}
              placeholder="Choose sites..."
              searchPlaceholder="Filter sites..."
            />
          </div>
        {/if}
        {#if grantError}
          <p class="text-sm text-destructive">{grantError}</p>
        {/if}
        <div class="flex justify-end">
          <Button onclick={submitAddGrant} disabled={grantSubmitting || !addGrantRoleId}>
            {grantSubmitting ? 'Adding...' : 'Add grant'}
          </Button>
        </div>
      </div>
    </div>

    <Dialog.Footer class="px-4 pb-4">
      <Button type="button" variant="outline" onclick={() => (grantsOpen = false)}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
