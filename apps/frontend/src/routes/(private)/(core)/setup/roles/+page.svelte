<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { createTrpcClient } from '$lib/trpc';
  import { DataTable } from '$lib/components/data-table';
  import type {
    DataTableColumn,
    PaginationInput,
    RowAction,
  } from '$lib/components/data-table/types';
  import {
    ACTIONS,
    PERMISSION_RESOURCES,
    ROLE_LEVELS,
    hasPermission,
    normalizePermissions,
    type Action,
    type Permission,
  } from '@mspbyte/shared';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Textarea } from '$lib/components/ui/textarea';
  import SingleSelect from '$lib/components/single-select.svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const canWrite = $derived(authStore.isAllowed('Roles.Write'));
  const MATRIX_ACTIONS = ACTIONS;
  const MATRIX_RESOURCES = PERMISSION_RESOURCES.filter((resource) => resource.depth === 0);
  const ALL_SCOPE = [{ permissions: [] as string[], scope: { kind: 'all' as const } }];

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
  let editingId = $state<string | null>(null);
  let form = $state({
    name: '',
    description: '',
    level: '1',
    permissions: [] as string[],
  });
  let targetRole = $state<RoleRow | null>(null);

  function hasFullAccess(): boolean {
    return form.permissions.includes('*') || form.permissions.includes('Global.Admin');
  }

  function permissionKey(resource: string, action: Action): Permission {
    return `${resource}.${action}` as Permission;
  }

  function resourceSupports(resource: string, action: Action): boolean {
    return MATRIX_RESOURCES.some(
      (entry) => entry.key === resource && entry.actions.includes(action)
    );
  }

  function isDirect(permission: Permission): boolean {
    return form.permissions.includes(permission);
  }

  function isEffective(permission: Permission): boolean {
    ALL_SCOPE[0]!.permissions = form.permissions;
    return hasPermission(ALL_SCOPE, permission);
  }

  function cellState(permission: Permission): 'off' | 'direct' | 'implied' | 'global' {
    if (hasFullAccess()) return 'global';
    if (isDirect(permission)) return 'direct';
    if (isEffective(permission)) return 'implied';
    return 'off';
  }

  function toggleFullAccess(enabled: boolean) {
    form.permissions = enabled ? ['*'] : [];
  }

  function updatePermission(resource: string, action: Action, enabled: boolean) {
    const permission = permissionKey(resource, action);
    const next = new Set(
      form.permissions.filter((value) => value !== '*' && value !== 'Global.Admin')
    );
    if (enabled) next.add(permission);
    else next.delete(permission);
    form.permissions = normalizePermissions([...next]);
  }

  function matrixCellClass(state: 'off' | 'direct' | 'implied' | 'global'): string {
    const tone =
      state === 'direct'
        ? 'border-primary/40 bg-primary/6 shadow-[inset_0_0_0_1px_rgb(var(--primary)_/_0.06)]'
        : state === 'implied'
          ? 'border-border bg-muted/35'
          : state === 'global'
            ? 'border-primary/30 bg-primary/10'
            : 'border-transparent bg-transparent hover:border-border hover:bg-muted/30';
    const cursor =
      state === 'implied' || state === 'global' ? 'cursor-not-allowed' : 'cursor-pointer';
    return `flex min-h-[54px] w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1.5 text-center transition-colors ${tone} ${cursor}`;
  }

  function directGrantCount(): number {
    return hasFullAccess() ? 1 : form.permissions.length;
  }

  function enabledResourceCount(): number {
    if (hasFullAccess()) return MATRIX_RESOURCES.length;
    return MATRIX_RESOURCES.filter((resource) =>
      resource.actions.some((action) => isEffective(permissionKey(resource.key, action)))
    ).length;
  }

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
      permissions: normalizePermissions(r.permissions ?? []),
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
        permissions: normalizePermissions(role.permissions),
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
        permissions: normalizePermissions(form.permissions),
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
      showErrorToast(err, 'Action failed. Please try again.');
    } finally {
      submitting = false;
    }
  }
</script>

<div class="flex size-full overflow-hidden p-4">
  <div class="flex size-full flex-col gap-2">
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
  <Dialog.Content
    class="!w-[min(96vw,1440px)] !max-w-[min(96vw,1440px)] grid h-[min(92vh,980px)] grid-rows-[auto_1fr_auto] overflow-hidden border border-border/70 bg-background p-0! shadow-2xl"
  >
    <Dialog.Header
      class="gap-3 border-b bg-[linear-gradient(180deg,rgba(148,163,184,0.10),rgba(148,163,184,0.03))] px-5 py-5 sm:px-6"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-1">
          <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Role editor
          </div>
          <Dialog.Title class="text-xl font-semibold tracking-tight">
            {editingId ? 'Edit Role' : 'New Role'}
          </Dialog.Title>
        </div>
        <div class="flex flex-wrap gap-2">
          <div class="rounded-full border bg-background/80 px-3 py-1.5 text-xs">
            <span class="text-muted-foreground">Level</span>
            <span class="ml-1 font-medium">{form.level}</span>
          </div>
          <div class="rounded-full border bg-background/80 px-3 py-1.5 text-xs">
            <span class="text-muted-foreground">Direct grants</span>
            <span class="ml-1 font-medium">{directGrantCount()}</span>
          </div>
          <div class="rounded-full border bg-background/80 px-3 py-1.5 text-xs">
            <span class="text-muted-foreground">Resources</span>
            <span class="ml-1 font-medium">{enabledResourceCount()}</span>
          </div>
        </div>
      </div>
      <Dialog.Description>
        {editingId
          ? 'Change role details and permissions.'
          : 'Create a custom role for your organization.'}
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid min-h-0 grid-rows-[1fr] overflow-hidden">
      <div class="grid min-h-0 gap-6 p-5 sm:p-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div class="flex flex-col gap-4 self-start">
          <div class="flex flex-col gap-4 rounded-2xl border bg-card/60 p-4">
            <div class="flex flex-col gap-2">
              <Label for="role-name">Name</Label>
              <Input
                id="role-name"
                bind:value={form.name}
                placeholder="Client Portal — Read Only"
              />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="role-desc">Description</Label>
              <Textarea
                id="role-desc"
                bind:value={form.description}
                rows={3}
                placeholder="Optional"
              />
            </div>
          </div>

          <div class="flex flex-col gap-4 rounded-2xl border bg-card/60 p-4">
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
            <label class="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-3 text-sm">
              <Checkbox checked={hasFullAccess()} onCheckedChange={(v) => toggleFullAccess(!!v)} />
              <div class="min-w-0">
                <div class="font-medium">Full access</div>
                <div class="text-xs text-muted-foreground">
                  Bypass the matrix and grant every permission.
                </div>
              </div>
            </label>
            <div class="rounded-xl border bg-background px-3 py-3 text-xs text-muted-foreground">
              `Write` implies `Read`. For packages, `Write` also implies `Run`.
            </div>
          </div>

          {#if formError}
            <p class="text-sm text-destructive">{formError}</p>
          {/if}
        </div>

        <section class="flex min-h-0 flex-col gap-3 rounded-2xl border bg-card/40 p-4">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Label>Permissions</Label>
              <p class="mt-1 text-xs text-muted-foreground">
                Grant the strongest capability needed. Read access is derived automatically.
              </p>
            </div>
            <div class="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Matrix
            </div>
          </div>

          <div class="min-h-0 rounded-2xl border border-border/70 bg-background">
            <div class="h-full overflow-auto">
              <div class="min-w-[860px]">
                <div
                  class="sticky top-0 z-10 grid grid-cols-[minmax(220px,1.8fr)_repeat(4,minmax(120px,1fr))] border-b bg-background/96 backdrop-blur"
                >
                  <div
                    class="px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                  >
                    Resource
                  </div>
                  {#each MATRIX_ACTIONS as action}
                    <div
                      class="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {action}
                    </div>
                  {/each}
                </div>

                {#each MATRIX_RESOURCES as resource, index (resource.key)}
                  <div
                    class="grid grid-cols-[minmax(220px,1.8fr)_repeat(4,minmax(120px,1fr))] {index <
                    MATRIX_RESOURCES.length - 1
                      ? 'border-b'
                      : ''}"
                  >
                    <div class="bg-muted/10 px-4 py-2.5">
                      <div class="text-sm font-medium leading-tight">{resource.label}</div>
                      <div
                        class="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground"
                      >
                        {resource.key}
                      </div>
                    </div>

                    {#each MATRIX_ACTIONS as action}
                      {@const supported = resourceSupports(resource.key, action)}
                      {@const permission = permissionKey(resource.key, action)}
                      {@const state = supported ? cellState(permission) : 'off'}
                      <div class="flex items-center justify-center px-1.5 py-2">
                        {#if supported}
                          <label class={matrixCellClass(state)}>
                            <Checkbox
                              checked={state === 'direct' || state === 'global'}
                              indeterminate={state === 'implied'}
                              disabled={state === 'implied' || state === 'global'}
                              onCheckedChange={(checked) =>
                                updatePermission(resource.key, action, Boolean(checked))}
                            />
                            <span
                              class="text-[9px] uppercase tracking-[0.1em] text-muted-foreground"
                            >
                              {state === 'direct'
                                ? 'Direct'
                                : state === 'implied'
                                  ? 'Inherited'
                                  : state === 'global'
                                    ? 'Global'
                                    : 'Off'}
                            </span>
                          </label>
                        {:else}
                          <span class="font-mono text-xs text-muted-foreground/45">-</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <div
            class="flex flex-col gap-2 rounded-xl border bg-muted/20 px-3 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0 text-muted-foreground">
              Stored grants: {hasFullAccess()
                ? 'full access'
                : form.permissions.join(', ') || 'none'}
            </div>
            {#if !hasFullAccess()}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-7 w-fit px-2 text-xs"
                onclick={() => (form.permissions = [])}
                disabled={submitting || form.permissions.length === 0}
              >
                Clear
              </Button>
            {/if}
          </div>
        </section>
      </div>
    </div>

    <Dialog.Footer class="border-t bg-muted/20 px-5 py-4 sm:px-6">
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
