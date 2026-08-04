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
  import type { m365Licenses } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type LicenseRow = typeof m365Licenses.$inferSelect;

  interface Props {
    license: LicenseRow | null;
    linkId: string;
    onclose: () => void;
  }

  let { license, linkId, onclose }: Props = $props();

  const canWrite = $derived(authStore.isAllowed('Vendors.Write'));

  async function invalidate() {
    if (!license) return;
    await queryClient.invalidateQueries({
      queryKey: ['vendor.licenseUsers', linkId, license.externalId],
    });
    await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
    await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
    await queryClient.invalidateQueries({ queryKey: ['vendor.m365LicenseAvailability'] });
  }

  let addOpen = $state(false);
  let removingId = $state<string | null>(null);

  async function removeUser(identityId: string) {
    if (!license) return;
    removingId = identityId;
    try {
      const result = await trpc.vendor.removeM365LicensesFromIdentities.mutate({
        identityIds: [identityId],
        licenseIds: [license.id],
      });
      summarizePairResult('Remove license', result);
      await invalidate();
    } catch (err) {
      showErrorToast(err, 'Failed to remove license. Please try again.');
    } finally {
      removingId = null;
    }
  }

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
              {#if canWrite}
                <Button
                  size="sm"
                  variant="outline"
                  class="self-start"
                  onclick={() => (addOpen = true)}
                >
                  <PlusIcon class="size-3.5" /> Assign to users
                </Button>
              {/if}
              {#if usersQuery.isPending}
                <div class="h-8 bg-muted rounded animate-pulse"></div>
              {:else if (usersQuery.data?.length ?? 0) === 0}
                <div class="text-sm text-muted-foreground p-2">No users assigned</div>
              {:else}
                {#each usersQuery.data! as user (user.id)}
                  <div class="flex items-center justify-between p-2.5 rounded-md border text-sm gap-2">
                    <div class="flex flex-col gap-0.5 min-w-0">
                      <span class="font-medium truncate">{user.name}</span>
                      <span class="text-xs text-muted-foreground truncate">{user.email}</span>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <span class={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                        user.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                      )}>
                        {user.enabled ? 'Active' : 'Disabled'}
                      </span>
                      {#if canWrite}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-7 w-7 p-0"
                          aria-label="Remove license from user"
                          disabled={removingId === user.id}
                          onclick={() => removeUser(user.id)}
                        >
                          {#if removingId === user.id}
                            <LoaderCircleIcon class="size-3.5 animate-spin" />
                          {:else}
                            <Trash2Icon class="size-3.5 text-destructive" />
                          {/if}
                        </Button>
                      {/if}
                    </div>
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

{#if license}
  <IdentityPickerDialog
    open={addOpen}
    onOpenChange={(open) => (addOpen = open)}
    {linkId}
    relation={{
      kind: 'license',
      licenseIds: [license.id],
      anchorLabel: license.friendlyName || license.skuPartNumber,
    }}
    onSuccess={invalidate}
  />
{/if}
