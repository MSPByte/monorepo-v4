<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { createTrpcClient } from '$lib/trpc';
  import { DataTable } from '$lib/components/data-table';
  import type {
    DataTableColumn,
    PaginationInput,
    RowAction,
  } from '$lib/components/data-table/types';
  import { PERMISSION_TREE, ROLE_LEVELS, type Permission } from '@mspbyte/shared';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Textarea } from '$lib/components/ui/textarea';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const canWrite = $derived(authStore.isAllowed('Roles.Write'));

  // Flat permission options derived from PERMISSION_TREE. Tree picker is Phase 2.
  const ACTIONS = ['Read', 'Write', 'Delete'] as const;
  const permissionOptions = (() => {
    const opts: { value: string; label: string }[] = [{ value: '*', label: '* (all permissions)' }];
    for (const resource of Object.keys(PERMISSION_TREE)) {
      for (const action of ACTIONS) {
        opts.push({ value: `${resource}.${action}`, label: `${resource}.${action}` });
      }
    }
    return opts;
  })();

  type RoleRow = {
    id: string;
    name: string;
    description: string;
    level: number;
    permissions: readonly string[];
    isSystem: boolean;
    grantCount: number;
    [key: string]: unknown;
  };

  let refreshKey = $state(0);
  let editorOpen = $state(false);
  let deleteOpen = $state(false);
  let submitting = $state(false);
  let formError = $state<string | null>(null);

  // null = create; otherwise edit
  let editingId = $state<string | null>(null);
  let form = $state({
    name: '',
    description: '',
    level: '1',
    permissions: [] as string[],
  });
  let targetRole = $state<RoleRow | null>(null);

  const grantCountsQuery = createQuery(() => ({
    queryKey: ['roles.grantCounts', refreshKey],
    queryFn: () => trpc.roles.grantCounts.query(),
  }));

  const columns: DataTableColumn<RoleRow>[] = [
    { key: 'name', title: 'Name', sortable: true, searchable: true },
    { key: 'description', title: 'Description', searchable: true },
    { key: 'level', title: 'Level', sortable: true },
    { key: 'grantCount', title: 'Grants', sortable: true },
    { key: 'isSystem', title: 'System', sortable: true },
  ];

  const rowActions: RowAction<RoleRow>[] = $derived.by(() => {
    if (!canWrite) return [];
    return [
      {
        label: 'Edit',
        icon: PencilIcon,
        onclick(rows) {
          const r = rows[0];
          if (!r) return;
          if (r.isSystem) {
            toast.error('System roles cannot be edited');
            return;
          }
          openEditor(r);
        },
      },
      {
        label: 'Delete',
        icon: Trash2,
        variant: 'destructive',
        onclick(rows) {
          const r = rows[0];
          if (!r) return;
          if (r.isSystem) {
            toast.error('System roles cannot be deleted');
            return;
          }
          targetRole = r;
          deleteOpen = true;
        },
      },
    ];
  });

  async function fetchData(opts: PaginationInput): Promise<{ rows: RoleRow[]; total: number }> {
    const [raw, counts] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ['roles.list', refreshKey],
        queryFn: () => trpc.roles.list.query(),
      }),
      queryClient.fetchQuery({
        queryKey: ['roles.grantCounts', refreshKey],
        queryFn: () => trpc.roles.grantCounts.query(),
      }),
    ]);

    const rows: RoleRow[] = raw.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? '',
      level: r.level,
      permissions: r.permissions ?? [],
      isSystem: r.isSystem,
      grantCount: counts[r.id] ?? 0,
    }));

    const search = opts.globalSearch.toLowerCase();
    const filtered = search
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(search) || r.description.toLowerCase().includes(search)
        )
      : rows;

    const sorted = opts.sortField
      ? [...filtered].sort((a, b) => {
          const av = a[opts.sortField!] ?? '';
          const bv = b[opts.sortField!] ?? '';
          if (typeof av === 'number' && typeof bv === 'number') {
            return opts.sortDir === 'desc' ? bv - av : av - bv;
          }
          return opts.sortDir === 'desc'
            ? String(bv).localeCompare(String(av))
            : String(av).localeCompare(String(bv));
        })
      : filtered;

    const start = opts.page * opts.pageSize;
    return {
      rows: sorted.slice(start, start + opts.pageSize),
      total: sorted.length,
    };
  }

  function openEditor(role: RoleRow | null) {
    formError = null;
    if (role) {
      editingId = role.id;
      form = {
        name: role.name,
        description: role.description,
        level: String(role.level),
        permissions: [...role.permissions],
      };
    } else {
      editingId = null;
      form = { name: '', description: '', level: '1', permissions: [] };
    }
    editorOpen = true;
  }

  async function submit() {
    submitting = true;
    formError = null;
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        level: Number(form.level),
        permissions: form.permissions,
      };
      if (editingId) {
        await trpc.roles.update.mutate({ id: editingId, ...payload });
        toast.success(`Role updated: ${payload.name}`);
      } else {
        await trpc.roles.create.mutate(payload);
        toast.success(`Role created: ${payload.name}`);
      }
      editorOpen = false;
      refreshKey++;
    } catch (err: unknown) {
      formError = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  async function confirmDelete() {
    if (!targetRole) return;
    submitting = true;
    try {
      await trpc.roles.delete.mutate({ id: targetRole.id });
      toast.success(`Role deleted: ${targetRole.name}`);
      deleteOpen = false;
      targetRole = null;
      refreshKey++;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      submitting = false;
    }
  }
</script>

<div class="flex size-full p-4 overflow-hidden">
  <div class="flex flex-col size-full gap-2">
    {#if canWrite}
      <div class="flex justify-end">
        <Button size="sm" class="gap-2" onclick={() => openEditor(null)}>
          <PlusIcon class="h-4 w-4" />
          New Role
        </Button>
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

<Dialog.Root bind:open={editorOpen}>
  <Dialog.Content class="max-w-lg p-0!">
    <Dialog.Header class="px-4 pt-4">
      <Dialog.Title>{editingId ? 'Edit Role' : 'New Role'}</Dialog.Title>
      <Dialog.Description>
        {editingId
          ? 'Change role details and permissions.'
          : 'Create a custom role for your organization.'}
      </Dialog.Description>
    </Dialog.Header>
    <Separator />
    <div class="flex flex-col gap-4 p-4">
      <div class="flex flex-col gap-2">
        <Label for="role-name">Name</Label>
        <Input id="role-name" bind:value={form.name} placeholder="Client Portal — Read Only" />
      </div>
      <div class="flex flex-col gap-2">
        <Label for="role-desc">Description</Label>
        <Textarea id="role-desc" bind:value={form.description} rows={2} placeholder="Optional" />
      </div>
      <div class="flex flex-col gap-2">
        <Label>Level</Label>
        <SingleSelect
          options={ROLE_LEVELS.map((l) => ({
            value: String(l.value),
            label: `${l.value} — ${l.label}`,
          }))}
          bind:selected={form.level}
        />
      </div>
      <div class="flex flex-col gap-2">
        <Label>Permissions</Label>
        <MultiSelect
          options={permissionOptions}
          bind:selected={form.permissions}
          placeholder="Choose permissions..."
          searchPlaceholder="Filter by resource or action..."
        />
      </div>
      {#if formError}
        <p class="text-sm text-destructive">{formError}</p>
      {/if}
    </div>
    <Dialog.Footer class="px-4 pb-4">
      <Button
        type="button"
        variant="outline"
        onclick={() => (editorOpen = false)}
        disabled={submitting}
      >
        Cancel
      </Button>
      <Button
        type="button"
        onclick={submit}
        disabled={submitting || !form.name.trim() || form.permissions.length === 0}
      >
        {submitting ? 'Saving...' : editingId ? 'Save' : 'Create'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Delete role?</Dialog.Title>
      <Dialog.Description>
        {#if targetRole}
          You are about to delete <strong>{targetRole.name}</strong>.
          {#if targetRole.grantCount > 0}
            <br /><br />
            <Badge variant="destructive">
              {targetRole.grantCount} active grant{targetRole.grantCount === 1 ? '' : 's'}
            </Badge>
            The delete will fail — remove the grants first.
          {/if}
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (deleteOpen = false)}>Cancel</Button>
      <Button type="button" variant="destructive" onclick={confirmDelete} disabled={submitting}>
        {submitting ? 'Deleting...' : 'Delete'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
