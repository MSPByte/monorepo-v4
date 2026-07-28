<!-- TODO: Findings Implementation -->
<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { createTrpcClient } from '$lib/trpc';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import ShieldOffIcon from '@lucide/svelte/icons/shield-off';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import RotateCcwKeyIcon from '@lucide/svelte/icons/rotate-ccw-key';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import type { m365Identities } from '@mspbyte/drizzle';
  import ResetPasswordDialog from './_reset-password-dialog.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  type IdentityRow = typeof m365Identities.$inferSelect;

  interface Props {
    identity: IdentityRow | null;
    linkId: string;
    onclose: () => void;
  }

  let { identity, linkId, onclose }: Props = $props();

  const NOW = Date.now();
  const canWrite = $derived(authStore.isAllowed('Vendors.Write'));

  type Tab = 'Roles' | 'Groups' | 'Policies' | 'Auth Methods';
  let drawerTab = $state<Tab>('Roles');

  // Track the identity's enabled state locally so the pill flips immediately
  // after Disable/Enable while the sheet stays open.
  let localEnabled = $state<boolean | null>(null);
  const currentEnabled = $derived(localEnabled ?? identity?.enabled ?? null);

  $effect(() => {
    if (identity) {
      drawerTab = 'Roles';
      localEnabled = null;
    }
  });

  const detailsQuery = createQuery(() => ({
    queryKey: ['vendor.identityDetails', linkId, identity?.id],
    queryFn: () =>
      trpc.vendor.identityDetails.query({
        linkId,
        identityId: identity!.id,
      }),
    enabled: !!identity && !!linkId,
  }));

  function relativeTime(ts?: string | null) {
    if (!ts) return 'Never';
    const days = Math.floor((NOW - new Date(ts).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }

  let busy = $state<string | null>(null);

  async function invalidateAll() {
    await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
    await queryClient.invalidateQueries({
      queryKey: ['vendor.identityDetails', linkId, identity?.id],
    });
  }

  async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    busy = key;
    try {
      return await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
      return null;
    } finally {
      busy = null;
    }
  }

  async function revokeSessions() {
    if (!identity) return;
    await withBusy('revoke', async () => {
      const result = await trpc.vendor.revokeM365IdentitySessions.mutate({ ids: [identity!.id] });
      if (result.failed > 0) toast.error(result.results[0]?.error ?? 'Failed');
      else toast.success('Sessions revoked');
    });
  }

  async function toggleEnabled() {
    if (!identity || currentEnabled === null) return;
    const next = !currentEnabled;
    await withBusy('toggle', async () => {
      const result = await trpc.vendor.setM365IdentityEnabled.mutate({
        ids: [identity!.id],
        enabled: next,
      });
      if (result.failed > 0) {
        toast.error(result.results[0]?.error ?? 'Failed');
      } else {
        localEnabled = next;
        toast.success(next ? 'Account enabled' : 'Account disabled');
        await invalidateAll();
      }
    });
  }

  // Reset password dialog
  let resetDialogOpen = $state(false);
  const resetTargets = $derived(
    identity ? [{ id: identity.id, name: identity.name, email: identity.email }] : []
  );

  // Require MFA reset (confirm)
  let mfaResetOpen = $state(false);
  let mfaResetBusy = $state(false);

  async function submitMfaReset() {
    if (!identity) return;
    mfaResetBusy = true;
    try {
      const result = await trpc.vendor.requireM365IdentityMfaReset.mutate({ id: identity.id });
      if (result.result === 'success') {
        toast.success(`Removed ${result.deleted} MFA method${result.deleted === 1 ? '' : 's'}`);
      } else if (result.result === 'partial') {
        toast.warning(
          `Removed ${result.deleted}, ${result.failed} failed — user may need to re-enroll partially`
        );
      } else {
        toast.error('Failed to remove MFA methods');
      }
      await invalidateAll();
      mfaResetOpen = false;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'MFA reset failed');
    } finally {
      mfaResetBusy = false;
    }
  }

  // Delete a single auth method
  let deletingMethodId = $state<string | null>(null);

  async function deleteAuthMethod(methodId: string, segment: string | null) {
    if (!identity || !segment) return;
    deletingMethodId = methodId;
    try {
      const result = await trpc.vendor.deleteM365IdentityAuthMethod.mutate({
        id: identity.id,
        methodId,
        methodSegment: segment,
      });
      if (result.success) {
        toast.success('Auth method removed');
        await invalidateAll();
      } else {
        toast.error(result.error ?? 'Failed to remove auth method');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove auth method');
    } finally {
      deletingMethodId = null;
    }
  }

  const enabledLabel = $derived(currentEnabled ? 'Disable' : 'Enable');
</script>

<Sheet.Root
  open={!!identity}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-140! max-w-140! flex flex-col p-0">
    {#if identity}
      <Sheet.Header class="p-4 border-b">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex flex-col gap-1">
            <Sheet.Title class="truncate">{identity.name}</Sheet.Title>
            <Sheet.Description class="truncate">{identity.email}</Sheet.Description>
          </div>

          {#if canWrite}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button
                    variant="outline"
                    size="sm"
                    class="mr-8 shrink-0"
                    disabled={!!busy}
                    {...props}
                  >
                    {#if busy}
                      <LoaderCircleIcon class="size-3.5 animate-spin" />
                    {/if}
                    Actions
                    <ChevronDownIcon class="size-3.5" />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-52">
                <DropdownMenu.Item class="gap-2 cursor-pointer" onclick={revokeSessions}>
                  <LogOutIcon class="size-3.5" /> Revoke Sessions
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class="gap-2 cursor-pointer"
                  disabled={currentEnabled === null}
                  onclick={toggleEnabled}
                >
                  {#if currentEnabled}
                    <ShieldOffIcon class="size-3.5" />
                  {:else}
                    <ShieldCheckIcon class="size-3.5" />
                  {/if}
                  {enabledLabel}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class="gap-2 cursor-pointer"
                  onclick={() => (resetDialogOpen = true)}
                >
                  <RotateCcwKeyIcon class="size-3.5" /> Reset Password
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  class="gap-2 cursor-pointer text-destructive focus:text-destructive"
                  onclick={() => (mfaResetOpen = true)}
                >
                  <ShieldOffIcon class="size-3.5" /> Require MFA Reset
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
        </div>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- Identity meta -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div class="text-muted-foreground mb-0.5">Type</div>
            <div class="font-medium capitalize">{identity.type || '—'}</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Status</div>
            <div class={cn('font-medium', currentEnabled ? 'text-success' : 'text-destructive')}>
              {currentEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Last Sign-in</div>
            <div class="font-medium">{relativeTime(identity.lastSignInAt)}</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">MFA</div>
            <div
              class={cn(
                'font-medium',
                identity.mfaEnforced === false ? 'text-destructive' : 'text-success'
              )}
            >
              {identity.mfaEnforced === false ? 'Disabled' : 'Enabled'}
            </div>
          </div>
        </div>

        <!-- Tabs -->
        <div class="border-t pt-3">
          <div class="flex gap-1 border-b mb-3">
            {#each ['Roles', 'Groups', 'Policies', 'Auth Methods'] as const as tab}
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
              </button>
            {/each}
          </div>

          {#if drawerTab === 'Roles'}
            <div class="flex flex-col gap-2">
              {#if detailsQuery.isPending}
                <div class="h-8 bg-muted rounded animate-pulse"></div>
              {:else if (detailsQuery.data?.roles ?? []).length === 0}
                <div class="text-sm text-muted-foreground p-2">No roles assigned</div>
              {:else}
                {#each detailsQuery.data!.roles as role}
                  <div class="flex items-center justify-between p-2.5 rounded-md border text-sm">
                    <span>{role.name}</span>
                  </div>
                {/each}
              {/if}
            </div>
          {:else if drawerTab === 'Groups'}
            <div class="flex flex-col gap-2">
              {#if detailsQuery.isPending}
                <div class="h-8 bg-muted rounded animate-pulse"></div>
              {:else if (detailsQuery.data?.groups ?? []).length === 0}
                <div class="text-sm text-muted-foreground p-2">No groups found</div>
              {:else}
                {#each detailsQuery.data!.groups as group}
                  <div class="flex items-center p-2.5 rounded-md border text-sm">
                    {group.name}
                  </div>
                {/each}
              {/if}
            </div>
          {:else if drawerTab === 'Policies'}
            <div class="flex flex-col gap-2">
              {#if detailsQuery.isPending}
                <div class="h-8 bg-muted rounded animate-pulse"></div>
              {:else if (detailsQuery.data?.policies ?? []).length === 0}
                <div class="text-sm text-muted-foreground p-2">No policies assigned</div>
              {:else}
                {#each detailsQuery.data!.policies as policy}
                  {@const stateLabel =
                    policy.policyState === 'enabled'
                      ? 'Enabled'
                      : policy.policyState === 'enabledForReportingButNotEnforced'
                        ? 'Report Only'
                        : 'Disabled'}
                  {@const stateClass =
                    policy.policyState === 'enabled'
                      ? 'text-success'
                      : policy.policyState === 'enabledForReportingButNotEnforced'
                        ? 'text-warning'
                        : 'text-muted-foreground'}
                  <div
                    class="flex items-center justify-between p-2.5 rounded-md border text-sm gap-2"
                  >
                    <span class="truncate">{policy.name}</span>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <span class={cn('text-xs font-medium', stateClass)}>{stateLabel}</span>
                      <span
                        class={cn(
                          'text-xs font-medium',
                          policy.included ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {policy.included ? 'Included' : 'Excluded'}
                      </span>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          {:else if drawerTab === 'Auth Methods'}
            <div class="flex flex-col gap-2">
              {#if detailsQuery.isPending}
                <div class="h-8 bg-muted rounded animate-pulse"></div>
              {:else if detailsQuery.data?.authMethodsError}
                <div class="text-sm text-muted-foreground p-2">
                  {detailsQuery.data.authMethodsError}
                </div>
              {:else if (detailsQuery.data?.authMethods ?? []).length === 0}
                <div class="text-sm text-muted-foreground p-2">No authentication methods found</div>
              {:else}
                {#each detailsQuery.data!.authMethods as method}
                  <div
                    class="flex items-center justify-between p-2.5 rounded-md border text-sm gap-2"
                  >
                    <span>{method.type}</span>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="text-xs text-muted-foreground">
                        {method.createdDateTime
                          ? relativeTime(method.createdDateTime)
                          : 'No created date'}
                      </span>
                      {#if canWrite && method.segment}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deletingMethodId === method.id}
                          onclick={() => deleteAuthMethod(method.id, method.segment)}
                          class="h-7 w-7 p-0"
                          aria-label="Remove auth method"
                        >
                          {#if deletingMethodId === method.id}
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
          {/if}
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<!-- Reset password dialog (shared) -->
<ResetPasswordDialog
  open={resetDialogOpen}
  identities={resetTargets}
  onOpenChange={(open) => (resetDialogOpen = open)}
  onSuccess={invalidateAll}
/>

<!-- Require MFA reset confirm -->
<AlertDialog.Root bind:open={mfaResetOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Require MFA Reset?</AlertDialog.Title>
      <AlertDialog.Description>
        {#if identity}
          This removes all non-password authentication methods for <span class="font-medium"
            >{identity.email}</span
          >. They will have to re-register MFA at next sign-in.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={mfaResetBusy}>Cancel</AlertDialog.Cancel>
      <Button variant="destructive" disabled={mfaResetBusy} onclick={submitMfaReset}>
        {#if mfaResetBusy}
          <LoaderCircleIcon class="size-4 animate-spin" />
        {/if}
        Require Reset
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
