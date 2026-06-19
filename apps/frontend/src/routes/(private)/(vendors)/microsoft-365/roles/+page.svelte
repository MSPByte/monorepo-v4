<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import DataTable from '$lib/components/data-table/data-table.svelte';
  import { textColumn, nullableTextColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn, PaginationInput } from '$lib/components/data-table/types';
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { inferRouterOutputs } from '@trpc/server';
  import type { AppRouter } from '@mspbyte/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type RoleRow = inferRouterOutputs<AppRouter>['vendor']['assignedRoles'][number] &
    Record<string, unknown>;

  const columns: DataTableColumn<RoleRow>[] = [
    textColumn<RoleRow>('name', 'Role Name'),
    {
      key: 'assigneeCount',
      title: 'Assignees',
      sortable: true,
    },
    nullableTextColumn<RoleRow>('description', 'Description'),
  ];

  let refreshKey = $state(0);
  let selectedRole = $state<RoleRow | null>(null);

  const assigneesQuery = createQuery(() => ({
    queryKey: ['vendor.roleAssignees', scopeStore.currentLink, selectedRole?.id],
    queryFn: () =>
      trpc.vendor.roleAssignees.query({
        linkId: scopeStore.currentLink!,
        roleId: selectedRole!.id,
      }),
    enabled: !!selectedRole && !!scopeStore.currentLink,
  }));

  async function fetchData(input: PaginationInput): Promise<{ rows: RoleRow[]; total: number }> {
    if (!scopeStore.currentLink) return { rows: [], total: 0 };
    let rows = (await trpc.vendor.assignedRoles.query({
      linkId: scopeStore.currentLink,
    })) as RoleRow[];

    if (input.globalSearch) {
      const term = input.globalSearch.toLowerCase();
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(term) || r.description?.toLowerCase().includes(term)
      );
    }

    if (input.sortField) {
      const field = input.sortField as keyof RoleRow;
      const dir = input.sortDir === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = a[field] ?? '';
        const bv = b[field] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }

    return { rows, total: rows.length };
  }
</script>

{#if !scopeStore.currentLink}
  <div class="flex size-full items-center justify-center text-muted-foreground text-2xl">
    Please select Tenant to view roles
  </div>
{:else}
  <div class="flex flex-col size-full p-4">
    <DataTable
      {fetchData}
      {columns}
      enablePagination={false}
      enableFilters={false}
      onrowclick={(row) => (selectedRole = row as RoleRow)}
      {refreshKey}
    />
  </div>

  <Sheet.Root
    open={!!selectedRole}
    onOpenChange={(open) => {
      if (!open) selectedRole = null;
    }}
  >
    <Sheet.Content side="right" class="w-96 flex flex-col p-0">
      {#if selectedRole}
        <Sheet.Header class="p-4 border-b">
          <Sheet.Title>{selectedRole.name}</Sheet.Title>
          <Sheet.Description class="font-mono text-xs">{selectedRole.templateId}</Sheet.Description>
        </Sheet.Header>

        <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {#if selectedRole.description}
            <p class="text-xs text-muted-foreground">{selectedRole.description}</p>
          {/if}

          <div class="border-t pt-3">
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Assigned Users
              {#if !assigneesQuery.isPending && (assigneesQuery.data?.length ?? 0) > 0}
                <span class="ml-1 normal-case font-normal">({assigneesQuery.data!.length})</span>
              {/if}
            </div>

            {#if assigneesQuery.isPending}
              <div class="flex flex-col gap-2">
                {#each Array(3) as _}
                  <div class="h-12 bg-muted rounded animate-pulse"></div>
                {/each}
              </div>
            {:else if (assigneesQuery.data?.length ?? 0) === 0}
              <div class="text-sm text-muted-foreground p-2">No users assigned to this role</div>
            {:else}
              <div class="flex flex-col gap-2">
                {#each assigneesQuery.data! as identity (identity.id)}
                  <div class="flex items-center justify-between p-2.5 rounded-md border text-sm">
                    <div class="flex flex-col gap-0.5">
                      <span class="font-medium">{identity.name}</span>
                      <span class="text-xs text-muted-foreground">{identity.email}</span>
                    </div>
                    <span
                      class={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                        identity.enabled
                          ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {identity.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </Sheet.Content>
  </Sheet.Root>
{/if}
