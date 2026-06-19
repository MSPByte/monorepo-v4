<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { ALERT_DEFINITIONS } from '@mspbyte/shared';
  import AlertCard from '$lib/components/alerts/alert-card.svelte';
  import type { UiAlert } from '$lib/components/alerts/types';
  import type { m365Identities } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type IdentityRow = typeof m365Identities.$inferSelect;

  interface Props {
    identity: IdentityRow | null;
    linkId: string;
    alerts: UiAlert[];
    onclose: () => void;
  }

  let { identity, linkId, alerts, onclose }: Props = $props();

  const NOW = Date.now();

  type Tab = 'Roles' | 'Groups' | 'Policies' | 'Alerts';
  let drawerTab = $state<Tab>('Roles');

  $effect(() => {
    if (identity) {
      drawerTab = alerts.length > 0 ? 'Alerts' : 'Roles';
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
        <Sheet.Title>{identity.name}</Sheet.Title>
        <Sheet.Description>{identity.email}</Sheet.Description>
      </Sheet.Header>
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- Alert badges summary -->
        <div class="flex flex-wrap gap-1.5">
          {#each alerts as alert}
            {@const def = alert.definitionId ? ALERT_DEFINITIONS[alert.definitionId] : undefined}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-warning/20 text-warning">
              {def?.name ?? alert.definitionId ?? 'Alert'}
            </span>
          {/each}
          {#if alerts.length === 0}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-success/15 text-success">
              No open alerts
            </span>
          {/if}
        </div>

        <!-- Identity meta -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div class="text-muted-foreground mb-0.5">Type</div>
            <div class="font-medium capitalize">{identity.type || '—'}</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Status</div>
            <div class={cn('font-medium', identity.enabled ? 'text-success' : 'text-destructive')}>
              {identity.enabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Last Sign-in</div>
            <div class="font-medium">{relativeTime(identity.lastSignInAt)}</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">MFA</div>
            <div class={cn('font-medium', identity.mfaEnforced === false ? 'text-destructive' : 'text-success')}>
              {identity.mfaEnforced === false ? 'Disabled' : 'Enabled'}
            </div>
          </div>
        </div>

        <!-- Tabs -->
        <div class="border-t pt-3">
          <div class="flex gap-1 border-b mb-3">
            {#each (['Roles', 'Groups', 'Policies', 'Alerts'] as const) as tab}
              <button
                onclick={() => (drawerTab = tab)}
                class={cn(
                  'px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                  drawerTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab}
                {#if tab === 'Alerts' && alerts.length > 0}
                  <span class="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-destructive/15 text-destructive text-xs leading-none">
                    {alerts.length}
                  </span>
                {/if}
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
                  {@const stateLabel = policy.policyState === 'enabled' ? 'Enabled' : policy.policyState === 'enabledForReportingButNotEnforced' ? 'Report Only' : 'Disabled'}
                  {@const stateClass = policy.policyState === 'enabled' ? 'text-success' : policy.policyState === 'enabledForReportingButNotEnforced' ? 'text-warning' : 'text-muted-foreground'}
                  <div class="flex items-center justify-between p-2.5 rounded-md border text-sm gap-2">
                    <span class="truncate">{policy.name}</span>
                    <div class="flex items-center gap-1.5 shrink-0">
                      <span class={cn('text-xs font-medium', stateClass)}>{stateLabel}</span>
                      <span class={cn('text-xs font-medium', policy.included ? 'text-foreground' : 'text-muted-foreground')}>
                        {policy.included ? 'Included' : 'Excluded'}
                      </span>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          {:else if drawerTab === 'Alerts'}
            <div class="flex flex-col gap-2">
              {#if alerts.length === 0}
                <div class="text-sm text-muted-foreground p-2">No open alerts</div>
              {:else}
                {#each alerts as alert}
                  <AlertCard alert={alert} />
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
