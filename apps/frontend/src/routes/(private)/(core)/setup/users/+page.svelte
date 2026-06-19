<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
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
  import SingleSelect from '$lib/components/single-select.svelte';
  import UserPlusIcon from '@lucide/svelte/icons/user-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Separator from '$lib/components/ui/separator/separator.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  let addDialogOpen = $state(false);
  let formError = $state<string | null>(null);
  let submitting = $state(false);
  let selectedRoleId = $state<string | undefined>(undefined);
  let refreshKey = $state(0);

  const rolesQuery = createQuery(() => ({
    queryKey: ['roles.list'],
    queryFn: () => trpc.roles.list.query(),
  }));

  const roleOptions = $derived(
    (rolesQuery.data ?? []).map((r) => ({ value: r.id, label: r.name }))
  );

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
    { key: 'role', title: 'Role', sortable: true },
  ];

  const rowActions: RowAction<UserRow>[] = $derived.by(() =>
    authStore.isAllowed('Users.Delete')
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            variant: 'destructive',
            async onclick(rows) {
              await Promise.all(rows.map((r) => trpc.users.delete.mutate({ id: r.id })));
              refreshKey++;
            },
          },
        ]
      : []
  );

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
</script>

<div class="flex size-full p-4 overflow-hidden">
  <div class="flex flex-col size-full gap-2">
    {#if authStore.isAllowed('Users.Write')}
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
                  <Label>Role</Label>
                  <SingleSelect
                    options={roleOptions}
                    bind:selected={selectedRoleId}
                    placeholder="Select role..."
                  />
                  <input type="hidden" name="roleId" value={selectedRoleId ?? ''} />
                </div>
              </div>
              {#if formError}
                <p class="text-sm text-destructive">{formError}</p>
              {/if}
              <Dialog.Footer>
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
