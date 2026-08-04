<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { showErrorToast } from '$lib/utils/errors';
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import IdentityPickerDialog from '../_actions/identity-picker-dialog.svelte';
  import { summarizePairResult } from '../_actions/summarize.js';
  import type { m365Groups } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type GroupRow = typeof m365Groups.$inferSelect;

  interface Props {
    group: GroupRow | null;
    linkId: string;
    onclose: () => void;
  }

  let { group, linkId, onclose }: Props = $props();

  const canWrite = $derived(authStore.isAllowed('Vendors.Write'));

  const membersQuery = createQuery(() => ({
    queryKey: ['vendor.groupMembers', linkId, group?.id],
    queryFn: () => trpc.vendor.groupMembers.query({ linkId, groupId: group!.id }),
    enabled: !!group && !!linkId,
  }));

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['vendor.groupMembers', linkId, group?.id] });
    await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
  }

  let addOpen = $state(false);
  let removingId = $state<string | null>(null);

  async function removeMember(identityId: string) {
    if (!group) return;
    removingId = identityId;
    try {
      const result = await trpc.vendor.removeM365IdentitiesFromGroups.mutate({
        identityIds: [identityId],
        groupIds: [group.id],
      });
      summarizePairResult('Remove member', result);
      await invalidate();
    } catch (err) {
      showErrorToast(err, 'Failed to remove member. Please try again.');
    } finally {
      removingId = null;
    }
  }
</script>

<Sheet.Root
  open={!!group}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if group}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{group.name}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 flex-wrap">
          {#if group.mailEnabled}
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
              Mail-enabled
            </span>
          {/if}
          {#if group.securityEnabled}
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-success/15 text-success">
              Security
            </span>
          {/if}
          {#if !group.mailEnabled && !group.securityEnabled}
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
              Distribution
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {#if group.description}
          <p class="text-xs text-muted-foreground">{group.description}</p>
        {/if}

        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Members
              {#if !membersQuery.isPending && (membersQuery.data?.length ?? 0) > 0}
                <span class="ml-1 normal-case font-normal">({membersQuery.data!.length})</span>
              {/if}
            </div>
            {#if canWrite}
              <Button size="sm" variant="outline" onclick={() => (addOpen = true)}>
                <PlusIcon class="size-3.5" /> Add members
              </Button>
            {/if}
          </div>

          {#if membersQuery.isPending}
            <div class="flex flex-col gap-2">
              {#each Array(3) as _}
                <div class="h-12 bg-muted rounded animate-pulse"></div>
              {/each}
            </div>
          {:else if (membersQuery.data?.length ?? 0) === 0}
            <div class="text-sm text-muted-foreground p-2">No members found</div>
          {:else}
            <div class="flex flex-col gap-2">
              {#each membersQuery.data! as member (member.id)}
                <div class="flex items-center justify-between p-2.5 rounded-md border text-sm gap-2">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <span class="font-medium truncate">{member.name}</span>
                    <span class="text-xs text-muted-foreground truncate">{member.email}</span>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <span class={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                      member.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                    )}>
                      {member.enabled ? 'Active' : 'Disabled'}
                    </span>
                    {#if canWrite}
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 w-7 p-0"
                        aria-label="Remove member"
                        disabled={removingId === member.id}
                        onclick={() => removeMember(member.id)}
                      >
                        {#if removingId === member.id}
                          <LoaderCircleIcon class="size-3.5 animate-spin" />
                        {:else}
                          <Trash2Icon class="size-3.5 text-destructive" />
                        {/if}
                      </Button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

{#if group}
  <IdentityPickerDialog
    open={addOpen}
    onOpenChange={(open) => (addOpen = open)}
    {linkId}
    relation={{ kind: 'group', groupIds: [group.id], anchorLabel: group.name }}
    onSuccess={invalidate}
  />
{/if}
