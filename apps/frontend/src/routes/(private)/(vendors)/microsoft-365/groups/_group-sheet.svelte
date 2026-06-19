<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365Groups } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type GroupRow = typeof m365Groups.$inferSelect;

  interface Props {
    group: GroupRow | null;
    linkId: string;
    onclose: () => void;
  }

  let { group, linkId, onclose }: Props = $props();

  const membersQuery = createQuery(() => ({
    queryKey: ['vendor.groupMembers', linkId, group?.id],
    queryFn: () => trpc.vendor.groupMembers.query({ linkId, groupId: group!.id }),
    enabled: !!group && !!linkId,
  }));
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
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Members
            {#if !membersQuery.isPending && (membersQuery.data?.length ?? 0) > 0}
              <span class="ml-1 normal-case font-normal">({membersQuery.data!.length})</span>
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
                <div class="flex items-center justify-between p-2.5 rounded-md border text-sm">
                  <div class="flex flex-col gap-0.5">
                    <span class="font-medium">{member.name}</span>
                    <span class="text-xs text-muted-foreground">{member.email}</span>
                  </div>
                  <span class={cn(
                    'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                    member.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                  )}>
                    {member.enabled ? 'Active' : 'Disabled'}
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
