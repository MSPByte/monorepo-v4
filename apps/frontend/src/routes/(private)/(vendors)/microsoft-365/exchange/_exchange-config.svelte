<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { cn } from '$lib/utils';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import type { m365ExchangeConfigs, m365MailboxForwarding } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  type ExchangeConfigRow = typeof m365ExchangeConfigs.$inferSelect & Record<string, unknown>;
  type ForwardingRow = typeof m365MailboxForwarding.$inferSelect & Record<string, unknown>;

  interface Props {
    linkId: string;
  }

  let { linkId }: Props = $props();

  const configQuery = createQuery(() => ({
    queryKey: ['vendor.tableData', 'm365_exchange_configs', linkId],
    queryFn: () =>
      trpc.vendor.tableData.query({
        table: 'm365_exchange_configs',
        linkId,
        page: 1,
        pageSize: 1,
      }),
    enabled: !!linkId,
  }));

  const forwardingQuery = createQuery(() => ({
    queryKey: ['vendor.tableData', 'm365_mailbox_forwarding', linkId],
    queryFn: () =>
      trpc.vendor.tableData.query({
        table: 'm365_mailbox_forwarding',
        linkId,
        page: 1,
        pageSize: 100,
      }),
    enabled: !!linkId,
  }));

  const config = $derived((configQuery.data?.rows[0] ?? null) as ExchangeConfigRow | null);
  const forwardingMailboxes = $derived((forwardingQuery.data?.rows ?? []) as ForwardingRow[]);

  const AUTO_FORWARD_LABELS: Record<string, { label: string; color: string }> = {
    Disabled: { label: 'Disabled', color: 'bg-success/20 text-success' },
    Automatic: { label: 'Automatic', color: 'bg-warning/20 text-warning' },
    On: { label: 'On', color: 'bg-destructive/20 text-destructive' },
  };
</script>

<div class="flex flex-col size-full overflow-y-auto p-4">
  {#if configQuery.isPending}
    <Loader />
  {:else if !config}
    <FadeIn class="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
      <div class="text-sm font-medium">No exchange configuration found</div>
      <div class="text-xs">Configuration data may not have been synced yet</div>
    </FadeIn>
  {:else}
    <FadeIn class="border rounded-lg p-4 flex flex-col gap-4">
      <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Tenant Configuration
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Auto Forwarding Mode</span>
          {#if config.autoForwardingMode}
            {@const meta = AUTO_FORWARD_LABELS[config.autoForwardingMode]}
            <span
              class={cn(
                'inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-medium',
                meta?.color ?? 'bg-muted text-muted-foreground'
              )}
            >
              {meta?.label ?? config.autoForwardingMode}
            </span>
          {:else}
            <span class="text-sm text-muted-foreground">—</span>
          {/if}
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Reject Direct Send</span>
          <span
            class={cn(
              'inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-medium',
              config.rejectDirectSend ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'
            )}
          >
            {config.rejectDirectSend ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Basic Auth (SMTP)</span>
          <span
            class={cn(
              'inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-medium',
              config.allowBasicAuthSmtp
                ? 'bg-destructive/20 text-destructive'
                : 'bg-success/20 text-success'
            )}
          >
            {config.allowBasicAuthSmtp ? 'Allowed' : 'Blocked'}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Forwarding Mailboxes</span>
          <span class="text-sm font-medium">{forwardingMailboxes.length}</span>
        </div>
      </div>

      {#if forwardingMailboxes.length > 0}
        <div class="border-t pt-3 flex flex-col gap-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Forwarding Mailboxes
          </div>
          <div class="flex flex-col gap-1.5">
            {#each forwardingMailboxes as mb}
              <div
                class="flex items-start justify-between gap-2 text-sm p-2 rounded-md bg-muted/50"
              >
                <span class="text-xs font-mono truncate">{mb.userPrincipalName}</span>
                <span class="text-xs text-muted-foreground shrink-0 truncate max-w-45"
                  >{mb.forwardingSmtpAddress ?? mb.forwardingAddress ?? '—'}</span
                >
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </FadeIn>
  {/if}
</div>
