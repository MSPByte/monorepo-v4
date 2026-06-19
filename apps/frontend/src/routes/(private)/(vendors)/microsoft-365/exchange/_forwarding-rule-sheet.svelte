<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365MailboxForwarding } from '@mspbyte/drizzle';

  type ForwardingRow = typeof m365MailboxForwarding.$inferSelect;

  interface Props {
    rule: ForwardingRow | null;
    onclose: () => void;
  }

  let { rule, onclose }: Props = $props();
</script>

<Sheet.Root
  open={!!rule}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if rule}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title class="truncate">{rule.userPrincipalName}</Sheet.Title>
        <Sheet.Description>
          <span class={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
            rule.forwardingSmtpAddress ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground'
          )}>
            {rule.forwardingSmtpAddress ? 'External Forwarding' : 'Internal Forwarding'}
          </span>
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex flex-col gap-3">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Forwarding Details</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-start justify-between gap-2 text-sm">
              <span class="text-muted-foreground shrink-0">SMTP Target</span>
              <span class="font-mono text-xs text-right break-all">{rule.forwardingSmtpAddress ?? '—'}</span>
            </div>
            <div class="flex items-start justify-between gap-2 text-sm">
              <span class="text-muted-foreground shrink-0">Internal Target</span>
              <span class="text-xs text-right break-all">{rule.forwardingAddress ?? '—'}</span>
            </div>
            <div class="flex items-center justify-between gap-2 text-sm">
              <span class="text-muted-foreground">Keep Copy</span>
              <span class={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                rule.deliverToMailboxAndForward
                  ? 'bg-success/20 text-success'
                  : 'bg-muted text-muted-foreground'
              )}>
                {rule.deliverToMailboxAndForward ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
