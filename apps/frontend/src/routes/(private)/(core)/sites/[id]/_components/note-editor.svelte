<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';

  import type { ProfileNote } from '../_profile/client-profile.types';

  let {
    siteId,
    type,
    note,
    open = $bindable(),
  }: {
    siteId: string;
    type: 'special' | 'tribal';
    note: ProfileNote | null;
    open: boolean;
  } = $props();

  let title = $state('');
  let description = $state('');
  let severity = $state(0);

  $effect(() => {
    if (open) {
      title = note?.title ?? '';
      description = note?.description ?? '';
      severity = note?.severity ?? (type === 'special' ? 2 : 0);
    }
  });

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const save = createMutation(() => ({
    mutationFn: () =>
      trpc.siteProfile.upsertNote.mutate({
        id: note?.id,
        siteId,
        type,
        title,
        description,
        severity,
        active: true,
      }),
    onSuccess: () => {
      open = false;
      toast.success('Note saved');
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const del = createMutation(() => ({
    mutationFn: () => {
      if (!note?.id) throw new Error('No note to delete');
      return trpc.siteProfile.deleteNote.mutate({ id: note.id });
    },
    onSuccess: () => {
      open = false;
      toast.success('Note deleted');
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  }));

  const title_label = $derived(type === 'special' ? 'Special Handling' : 'Tribal Knowledge');
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[480px]">
    <Dialog.Header>
      <Dialog.Title>{note ? `Edit ${title_label}` : `New ${title_label} note`}</Dialog.Title>
      <Dialog.Description>
        {#if type === 'special'}
          Operational rules every technician should respect when touching this site.
        {:else}
          Tribal knowledge — quirks, history, things that aren't documented anywhere else.
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-3 p-4">
      <div class="grid gap-1.5">
        <Label for="note-title">Title</Label>
        <Input id="note-title" bind:value={title} placeholder="Short headline" />
      </div>
      <div class="grid gap-1.5">
        <Label for="note-desc">Description</Label>
        <Textarea id="note-desc" bind:value={description} rows={4} placeholder="Details" />
      </div>
      {#if type === 'special'}
        <div class="grid gap-1.5">
          <Label>Severity</Label>
          <Select.Root
            type="single"
            value={String(severity)}
            onValueChange={(v) => v && (severity = Number(v))}
          >
            <Select.Trigger>
              {severity >= 3 ? 'High' : severity >= 2 ? 'Medium' : 'Low'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="1">Low</Select.Item>
              <Select.Item value="2">Medium</Select.Item>
              <Select.Item value="3">High</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      {#if note?.id}
        <Button
          variant="ghost"
          class="text-destructive"
          onclick={() => del.mutate()}
          disabled={del.isPending}
        >
          Delete
        </Button>
      {/if}
      <div class="flex-1"></div>
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
      <Button onclick={() => save.mutate()} disabled={save.isPending || !title}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
