<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { authStore } from '$lib/stores/auth.store.svelte';

  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let {
    policyId,
    policyName,
  }: {
    policyId: string;
    policyName: string;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canDelete = $derived(authStore.isAllowed('Policies.Delete'));

  let deleteOpen = $state(false);
  let deleteConfirm = $state('');

  $effect(() => {
    if (deleteOpen) deleteConfirm = '';
  });

  const remove = createMutation(() => ({
    mutationFn: async () => {
      const result = await trpc.policies.delete.mutate({ ids: [policyId] });
      if (result.deleted !== 1) throw new Error('Policy could not be deleted.');
    },
    onSuccess: async () => {
      deleteOpen = false;
      toast.success('Policy deleted');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['policies.list'] }),
        queryClient.invalidateQueries({ queryKey: ['policies.tableData'] }),
      ]);
      await goto('/policies');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Failed to delete policy'),
  }));

  const canConfirmDelete = $derived(
    canDelete && deleteConfirm === policyName && !remove.isPending,
  );
</script>

{#if canDelete}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <button
          class="rounded-sm border border-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
          title="Policy options"
          aria-label="Policy options"
          {...props}
        >
          <Ellipsis class="size-4" />
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="w-40" align="end">
      <DropdownMenu.Item
        class="gap-2 cursor-pointer text-destructive focus:text-destructive"
        onclick={() => (deleteOpen = true)}
      >
        <Trash2 class="size-3.5" /> Delete
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this policy?</AlertDialog.Title>
      <AlertDialog.Description>
        This permanently removes the policy, its findings, and its assignments.
      </AlertDialog.Description>
    </AlertDialog.Header>

    <div class="grid gap-2 py-2">
      <Label for="policy-delete-confirm">
        Type <span class="font-mono text-foreground">{policyName}</span> to confirm
      </Label>
      <Input
        id="policy-delete-confirm"
        bind:value={deleteConfirm}
        placeholder={policyName}
        autocomplete="off"
      />
    </div>

    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <Button variant="destructive" disabled={!canConfirmDelete} onclick={() => remove.mutate()}>
        Delete policy
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
