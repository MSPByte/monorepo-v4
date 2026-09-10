<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import { Plus, ArrowRight, LoaderCircle } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import {
    DataTable,
    type DataTableColumn,
    type PaginationInput,
  } from '$lib/components/data-table';
  import { textColumn, relativeDateColumn } from '$lib/components/data-table/column-defs';
  import { toServerTableInput } from '$lib/components/domain/server-table';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Sites.Write'));
  type GroupRow = {
    id: string;
    name: string;
    description: string | null;
    memberCount: number;
    createdAt: string;
    updatedAt: string;
  };
  const columns: DataTableColumn<GroupRow>[] = [
    textColumn<GroupRow>('name', 'Group', undefined, undefined, {
      cell: groupCell,
      cellComponent: undefined,
      hideable: false,
    }),
    textColumn<GroupRow>('description', 'Description'),
    { key: 'memberCount', title: 'Members', cell: countCell, width: '120px' },
    relativeDateColumn<GroupRow>('updatedAt', 'Last edited', { width: '160px' }),
  ];
  let tableError = $state(false);
  let refreshKey = $state(0);
  async function fetchData(input: PaginationInput) {
    try {
      const result = await trpc.siteGroups.tableData.query(
        toServerTableInput(input, ['name', 'description'])
      );
      tableError = false;
      return { rows: result.rows as GroupRow[], total: result.total };
    } catch (error) {
      tableError = true;
      throw error;
    }
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
    if (!canWrite || creating || !name.trim()) return;
    creating = true;
    try {
      const row = await trpc.siteGroups.create.mutate({
        name: name.trim(),
        description: description.trim() || null,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['siteGroups.list'] }),
        queryClient.invalidateQueries({ queryKey: ['siteGroups.tableData'] }),
      ]);
      createOpen = false;
      toast.success('Group created. Add members to get started.');
      await goto(`/groups/${row.id}`);
    } catch (error) {
      showErrorToast(error, 'Failed to create group.');
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head><title>Groups · MSPByte</title></svelte:head>

{#snippet groupCell({ row }: { row: GroupRow })}
  <a
    class="font-medium hover:text-primary hover:underline"
    href={`/groups/${row.id}`}
    onclick={(event) => event.stopPropagation()}>{row.name}</a
  >
{/snippet}
{#snippet countCell({ row }: { row: GroupRow })}
  <span class="font-mono text-sm tabular-nums" class:text-muted-foreground={row.memberCount === 0}
    >{row.memberCount}</span
  >
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden px-6 py-4">
  <header class="flex shrink-0 flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-[22px] font-semibold tracking-tight">Groups</h1>
      <p class="mt-1 text-xs text-muted-foreground">
        Manage the sites and tenant links used to scope policies, packages, and reports.
      </p>
    </div>
    {#if canWrite}<Button size="sm" onclick={openCreate}><Plus class="size-4" />Create group</Button
      >{/if}
  </header>
  {#if tableError}<div class="flex items-center gap-3 text-sm text-destructive" role="alert">
      Groups couldn’t be loaded.<Button variant="outline" size="sm" onclick={() => refreshKey++}
        >Try again</Button
      >
    </div>{/if}
  <DataTable
    {fetchData}
    {columns}
    {refreshKey}
    defaultPageSize={25}
    defaultSort={{ field: 'name', dir: 'asc' }}
    onrowclick={(row) => goto(`/groups/${row.id}`)}
  />
</div>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content
    class="sm:max-w-[480px]"
    showCloseButton={!creating}
    onInteractOutside={(event) => {
      if (creating) event.preventDefault();
    }}
    onEscapeKeydown={(event) => {
      if (creating) event.preventDefault();
    }}
  >
    <Dialog.Header
      ><Dialog.Title>Create group</Dialog.Title><Dialog.Description
        >Give this group a recognizable name. You’ll choose its members next.</Dialog.Description
      ></Dialog.Header
    >
    <form
      onsubmit={(event) => {
        event.preventDefault();
        submitCreate();
      }}
      class="contents"
    >
      <Dialog.Body
        ><div class="grid gap-5">
          <label class="grid gap-2 text-xs font-medium"
            >Group name<Input
              bind:value={name}
              placeholder="e.g. Northeast region"
              maxlength={200}
              required
              disabled={creating}
            /></label
          >
          <label class="grid gap-2 text-xs font-medium"
            ><span
              >Description <span class="font-normal text-muted-foreground">(optional)</span></span
            ><Textarea
              bind:value={description}
              rows={3}
              maxlength={2000}
              placeholder="What brings these sites and tenants together?"
              disabled={creating}
            ></Textarea></label
          >
        </div></Dialog.Body
      >
      <Dialog.Footer
        ><Button variant="ghost" disabled={creating} onclick={() => (createOpen = false)}
          >Cancel</Button
        ><Button type="submit" disabled={creating || !name.trim()}
          >{#if creating}<LoaderCircle class="size-4 animate-spin" />Creating…{:else}Create group<ArrowRight
              class="size-4"
            />{/if}</Button
        ></Dialog.Footer
      >
    </form>
  </Dialog.Content>
</Dialog.Root>
