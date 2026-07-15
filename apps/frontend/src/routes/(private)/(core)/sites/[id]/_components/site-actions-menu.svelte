<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { authStore } from '$lib/stores/auth.store.svelte';

  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let {
    siteId,
    siteName,
  }: {
    siteId: string;
    siteName: string;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const canWrite = $derived(authStore.isAllowed('Sites.Write'));
  const canDelete = $derived(authStore.isAllowed('Sites.Delete'));

  let renameOpen = $state(false);
  let deleteOpen = $state(false);
  let renameValue = $state('');
  let deleteConfirm = $state('');

  $effect(() => {
    if (renameOpen) renameValue = siteName;
    if (deleteOpen) deleteConfirm = '';
  });

  const rename = createMutation(() => ({
    mutationFn: () => trpc.sites.rename.mutate({ id: siteId, name: renameValue.trim() }),
    onSuccess: () => {
      renameOpen = false;
      toast.success('Site renamed');
      qc.invalidateQueries({ queryKey: ['sites.byId', siteId] });
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
      qc.invalidateQueries({ queryKey: ['sites.list'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Rename failed'),
  }));

  const remove = createMutation(() => ({
    mutationFn: () => trpc.sites.delete.mutate({ id: siteId }),
    onSuccess: () => {
      deleteOpen = false;
      toast.success('Site deleted');
      qc.invalidateQueries({ queryKey: ['sites.list'] });
      goto('/sites');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  const trimmedRename = $derived(renameValue.trim());
  const canSubmitRename = $derived(
    canWrite && trimmedRename.length > 0 && trimmedRename !== siteName && !rename.isPending
  );
  const canConfirmDelete = $derived(canDelete && deleteConfirm === siteName && !remove.isPending);
</script>

{#if canWrite || canDelete}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <button
          class="rounded-sm border border-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
          title="Site options"
          aria-label="Site options"
          {...props}
        >
          <Ellipsis class="size-4" />
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="w-40" align="end">
      {#if canWrite}
        <DropdownMenu.Item class="gap-2 cursor-pointer" onclick={() => (renameOpen = true)}>
          <Pencil class="size-3.5" /> Rename
        </DropdownMenu.Item>
      {/if}
      {#if canWrite && canDelete}
        <DropdownMenu.Separator />
      {/if}
      {#if canDelete}
        <DropdownMenu.Item
          class="gap-2 cursor-pointer text-destructive focus:text-destructive"
          onclick={() => (deleteOpen = true)}
        >
          <Trash2 class="size-3.5" /> Delete
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}

<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title>Rename site</Dialog.Title>
      <Dialog.Description>Update the display name for this site.</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-2 px-4 pb-2">
      <Label for="site-rename-input">Name</Label>
      <Input
        id="site-rename-input"
        bind:value={renameValue}
        placeholder="Site name"
        maxlength={200}
        onkeydown={(event) => {
          if (event.key === 'Enter' && canSubmitRename) {
            event.preventDefault();
            rename.mutate();
          }
        }}
      />
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (renameOpen = false)}>Cancel</Button>
      <Button disabled={!canSubmitRename} onclick={() => rename.mutate()}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this site?</AlertDialog.Title>
      <AlertDialog.Description>
        This permanently removes the site profile, notes, stack entries, and other cascading
        records. Assets, people, and integrations linked to this site must be reassigned or removed
        first, or the deletion will fail.
      </AlertDialog.Description>
    </AlertDialog.Header>

    <div class="grid gap-2 py-2">
      <Label for="site-delete-confirm">
        Type <span class="font-mono text-foreground">{siteName}</span> to confirm
      </Label>
      <Input
        id="site-delete-confirm"
        bind:value={deleteConfirm}
        placeholder={siteName}
        autocomplete="off"
      />
    </div>

    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <Button variant="destructive" disabled={!canConfirmDelete} onclick={() => remove.mutate()}>
        Delete site
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
