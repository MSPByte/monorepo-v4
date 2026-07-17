<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { Plus } from '@lucide/svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
  } from '$lib/components/data-table';
  import { numberColumn, textColumn } from '$lib/components/data-table/column-defs';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWriteSites = $derived(authStore.isAllowed('Sites.Write'));

  type GroupRow = {
    id: string;
    name: string;
    description: string | null;
    memberCount: number;
    createdAt: string;
    updatedAt: string;
  };

  const columns: DataTableColumn<GroupRow>[] = [
    textColumn<GroupRow>('name', 'Group', undefined, undefined, { width: '260px' }),
    textColumn<GroupRow>('description', 'Description'),
    numberColumn<GroupRow>('memberCount', 'Sites'),
  ];

  async function fetchData(input: PaginationInput) {
    const result = await trpc.siteGroups.tableData.query(
      toServerTableInput(input, ['name', 'description'])
    );
    return { rows: result.rows as GroupRow[], total: result.total };
  }

  let createOpen = $state(false);
  let creating = $state(false);
  let name = $state('');
  let description = $state('');

  function openCreate() {
    name = '';
    description = '';
    createOpen = true;
  }

  async function submitCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Group name is required');
      return;
    }
    creating = true;
    try {
      const row = await trpc.siteGroups.create.mutate({
        name: trimmed,
        description: description.trim() || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['siteGroups.list'] });
      createOpen = false;
      toast.success('Group created');
      goto(`/groups/${row.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create group');
    } finally {
      creating = false;
    }
  }
</script>

<div class="flex size-full flex-col gap-4 overflow-hidden p-6">
  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-normal">Site Groups</h1>
      <p class="text-sm text-muted-foreground">
        Arbitrary groupings of sites — parent/child, region, tier, or any other slicing.
      </p>
    </div>
    {#if canWriteSites}
      <Button class="gap-2" onclick={openCreate}>
        <Plus class="size-4" />
        New Group
      </Button>
    {/if}
  </div>

  <DataTable
    {fetchData}
    {columns}
    defaultPageSize={25}
    defaultSort={{ field: 'name', dir: 'asc' }}
    onrowclick={(row) => goto(`/groups/${row.id}`)}
  />
</div>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title>Create group</Dialog.Title>
      <Dialog.Description>
        Groups let you assign policies, billing, and framework scope to a slice of sites.
      </Dialog.Description>
    </Dialog.Header>
    <Separator />
    <div class="grid gap-3 p-4">
      <label class="grid gap-1 text-xs font-medium text-muted-foreground">
        Name
        <input
          type="text"
          bind:value={name}
          class="rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          placeholder="e.g. Northeast region"
        />
      </label>
      <label class="grid gap-1 text-xs font-medium text-muted-foreground">
        Description
        <textarea
          bind:value={description}
          rows="3"
          class="rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          placeholder="Optional"
        ></textarea>
      </label>
    </div>
    <Dialog.Footer>
      <button
        type="button"
        class="rounded-sm px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        onclick={() => (createOpen = false)}
      >
        Cancel
      </button>
      <button
        type="button"
        class="rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        disabled={creating || !name.trim()}
        onclick={submitCreate}
      >
        Create
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
