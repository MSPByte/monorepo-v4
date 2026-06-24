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

  import type { StackEntry } from '../_profile/client-profile.types';

  let {
    siteId,
    entry,
    open = $bindable(),
  }: {
    siteId: string;
    entry: StackEntry;
    open: boolean;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  type Status = 'managed' | 'third_party' | 'not_used' | 'unknown';
  let status = $state<Status>(entry.status);
  let vendor = $state(entry.vendor ?? '');
  let product = $state(entry.product ?? '');

  $effect(() => {
    if (open) {
      status = entry.status;
      vendor = entry.vendor ?? '';
      product = entry.product ?? '';
    }
  });

  const save = createMutation(() => ({
    mutationFn: () =>
      trpc.siteProfile.upsertStackEntry.mutate({
        siteId,
        categoryKey: entry.categoryKey,
        vendor: status === 'not_used' ? null : vendor || null,
        product: status === 'not_used' ? null : product || null,
        status,
        source: 'manual',
        origin: 'manual',
      }),
    onSuccess: () => {
      open = false;
      toast.success('Stack entry saved');
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const clear = createMutation(() => ({
    mutationFn: () =>
      trpc.siteProfile.deleteStackEntry.mutate({ siteId, categoryKey: entry.categoryKey }),
    onSuccess: () => {
      open = false;
      toast.success('Cleared');
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Clear failed'),
  }));
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>{entry.categoryLabel}</Dialog.Title>
      <Dialog.Description>
        Record what platform this site uses for {entry.categoryLabel}.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-3 p-4">
      <div class="grid gap-1.5">
        <Label>Status</Label>
        <Select.Root
          type="single"
          value={status}
          onValueChange={(v) => v && (status = v as Status)}
        >
          <Select.Trigger>{status.replace('_', ' ')}</Select.Trigger>
          <Select.Content>
            <Select.Item value="managed">managed</Select.Item>
            <Select.Item value="third_party">third-party</Select.Item>
            <Select.Item value="not_used">not used</Select.Item>
            <Select.Item value="unknown">unknown</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      {#if status === 'managed' || status === 'third_party' || status === 'unknown'}
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5">
            <Label for="stack-vendor">Vendor</Label>
            <Input id="stack-vendor" bind:value={vendor} placeholder="Vendor name" />
          </div>
          <div class="grid gap-1.5">
            <Label for="stack-product">Product</Label>
            <Input id="stack-product" bind:value={product} placeholder="Product name" />
          </div>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => clear.mutate()} disabled={clear.isPending}>
        Clear
      </Button>
      <div class="flex-1"></div>
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
      <Button onclick={() => save.mutate()} disabled={save.isPending}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
