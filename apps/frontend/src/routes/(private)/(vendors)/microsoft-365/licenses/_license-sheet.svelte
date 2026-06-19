<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365Licenses } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type LicenseRow = typeof m365Licenses.$inferSelect;

  interface Props {
    license: LicenseRow | null;
    linkId: string;
    onclose: () => void;
  }

  let { license, linkId, onclose }: Props = $props();

  type Tab = 'Users' | 'Service Plans';
  let drawerTab = $state<Tab>('Users');

  $effect(() => {
    if (license) drawerTab = 'Users';
  });

  const usersQuery = createQuery(() => ({
    queryKey: ['vendor.licenseUsers', linkId, license?.externalId],
    queryFn: () => trpc.vendor.licenseUsers.query({ linkId, skuId: license!.externalId }),
    enabled: !!license && !!linkId,
  }));

  function utilColor(pct: number) {
    if (pct < 50) return 'var(--warning)';
    if (pct > 90) return 'var(--success)';
    return 'var(--primary)';
  }
</script>

<Sheet.Root
  open={!!license}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if license}
      {@const pct = license.totalUnits > 0 ? Math.round((license.consumedUnits / license.totalUnits) * 100) : 0}
      {@const color = utilColor(pct)}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{license.friendlyName || license.skuPartNumber}</Sheet.Title>
        <Sheet.Description class="font-mono text-xs">{license.skuPartNumber}</Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- Utilization summary -->
        <div class="grid grid-cols-3 gap-2 text-xs">
          <div class="rounded-md border p-2.5 flex flex-col gap-1">
            <div class="text-muted-foreground">Assigned</div>
            <div class="font-bold text-base tabular-nums">{license.consumedUnits}</div>
          </div>
          <div class="rounded-md border p-2.5 flex flex-col gap-1">
            <div class="text-muted-foreground">Total</div>
            <div class="font-bold text-base tabular-nums">{license.totalUnits}</div>
          </div>
          <div class="rounded-md border p-2.5 flex flex-col gap-1">
            <div class="text-muted-foreground">Utilization</div>
            <div class="font-bold text-base tabular-nums" style="color:{color}">{pct}%</div>
          </div>
        </div>

        <!-- Tabs -->
        <div class="border-t pt-3">
          <div class="flex gap-1 border-b mb-3">
            {#each (['Users', 'Service Plans'] as const) as tab}
              <button
                onclick={() => (drawerTab = tab)}
                class={cn(
                  'px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                  drawerTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab}
                {#if tab === 'Users' && !usersQuery.isPending && (usersQuery.data?.length ?? 0) > 0}
                  <span class="ml-1 text-xs text-muted-foreground">({usersQuery.data!.length})</span>
                {/if}
              </button>
            {/each}
          </div>

          {#if drawerTab === 'Users'}
            <div class="flex flex-col gap-2">
              {#if usersQuery.isPending}
                <div class="h-8 bg-muted rounded animate-pulse"></div>
              {:else if (usersQuery.data?.length ?? 0) === 0}
                <div class="text-sm text-muted-foreground p-2">No users assigned</div>
              {:else}
                {#each usersQuery.data! as user (user.id)}
                  <div class="flex items-center justify-between p-2.5 rounded-md border text-sm">
                    <div class="flex flex-col gap-0.5">
                      <span class="font-medium">{user.name}</span>
                      <span class="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                    <span class={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                      user.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                    )}>
                      {user.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                {/each}
              {/if}
            </div>
          {:else if drawerTab === 'Service Plans'}
            <div class="flex flex-col gap-2">
              {#if !license.servicePlanNames || license.servicePlanNames.length === 0}
                <div class="text-sm text-muted-foreground p-2">No service plans</div>
              {:else}
                {#each license.servicePlanNames as plan}
                  <div class="flex items-center p-2.5 rounded-md border text-sm">
                    <span class="font-mono text-xs text-muted-foreground">{plan}</span>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
