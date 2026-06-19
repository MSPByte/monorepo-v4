<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365InboxRules } from '@mspbyte/drizzle';

  type InboxRuleRow = typeof m365InboxRules.$inferSelect;

  interface Props {
    rule: InboxRuleRow | null;
    onclose: () => void;
  }

  let { rule, onclose }: Props = $props();

  const REASON_LABELS: Record<string, { label: string; color: string }> = {
    deletesMessages: { label: 'Deletes Messages', color: 'bg-destructive/20 text-destructive' },
    forwardsExternally: { label: 'Forwards Externally', color: 'bg-warning/20 text-warning' },
    redirectsMessages: { label: 'Redirects Messages', color: 'bg-warning/20 text-warning' },
    movesToJunk: { label: 'Moves to Junk', color: 'bg-muted text-muted-foreground' },
  };

  const hasActions = $derived(
    !!rule &&
      (!!rule.deleteMessage ||
        !!rule.markAsRead ||
        !!rule.moveToFolder ||
        (rule.forwardTo?.length ?? 0) > 0 ||
        (rule.forwardAsAttachmentTo?.length ?? 0) > 0 ||
        (rule.redirectTo?.length ?? 0) > 0)
  );
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
        <Sheet.Title class="truncate">{rule.ruleName}</Sheet.Title>
        <Sheet.Description class="truncate text-xs">{rule.mailboxUpn}</Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex flex-col gap-3">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rule Details</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2 text-sm">
              <span class="text-muted-foreground">Status</span>
              <span class={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                rule.enabled === false ? 'bg-muted text-muted-foreground' : 'bg-success/20 text-success'
              )}>
                {rule.enabled === false ? 'Disabled' : 'Enabled'}
              </span>
            </div>
            <div class="flex items-center justify-between gap-2 text-sm">
              <span class="text-muted-foreground">Suspicious</span>
              <span class={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                rule.isSuspicious ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground'
              )}>
                {rule.isSuspicious ? 'Yes' : 'No'}
              </span>
            </div>

            {#if rule.suspicionReasons && rule.suspicionReasons.length > 0}
              <div class="flex items-start justify-between gap-2 text-sm">
                <span class="text-muted-foreground shrink-0">Suspicious Behaviour</span>
                <div class="flex flex-wrap gap-1 justify-end">
                  {#each rule.suspicionReasons as reason}
                    {@const meta = REASON_LABELS[reason]}
                    <span class={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                      meta?.color ?? 'bg-muted text-muted-foreground'
                    )}>
                      {meta?.label ?? reason}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}

            {#if rule.subjectContainsWords && rule.subjectContainsWords.length > 0}
              <div class="flex items-start justify-between gap-2 text-sm">
                <span class="text-muted-foreground shrink-0">Subject Matches</span>
                <span class="text-xs text-right break-all">{rule.subjectContainsWords.join(', ')}</span>
              </div>
            {/if}
          </div>
        </div>

        <div class="border-t pt-3 flex flex-col gap-3">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</div>
          <div class="flex flex-col gap-2">
            {#if rule.deleteMessage}
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="text-muted-foreground">Delete Message</span>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-destructive/20 text-destructive">Yes</span>
              </div>
            {/if}
            {#if rule.markAsRead}
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="text-muted-foreground">Mark as Read</span>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">Yes</span>
              </div>
            {/if}
            {#if rule.moveToFolder}
              <div class="flex items-start justify-between gap-2 text-sm">
                <span class="text-muted-foreground shrink-0">Move to Folder</span>
                <span class="text-xs text-right">{rule.moveToFolder}</span>
              </div>
            {/if}
            {#if rule.forwardTo && rule.forwardTo.length > 0}
              <div class="flex items-start justify-between gap-2 text-sm">
                <span class="text-muted-foreground shrink-0">Forward To</span>
                <span class="text-xs text-right break-all">{rule.forwardTo.join(', ')}</span>
              </div>
            {/if}
            {#if rule.forwardAsAttachmentTo && rule.forwardAsAttachmentTo.length > 0}
              <div class="flex items-start justify-between gap-2 text-sm">
                <span class="text-muted-foreground shrink-0">Forward as Attachment</span>
                <span class="text-xs text-right break-all">{rule.forwardAsAttachmentTo.join(', ')}</span>
              </div>
            {/if}
            {#if rule.redirectTo && rule.redirectTo.length > 0}
              <div class="flex items-start justify-between gap-2 text-sm">
                <span class="text-muted-foreground shrink-0">Redirect To</span>
                <span class="text-xs text-right break-all">{rule.redirectTo.join(', ')}</span>
              </div>
            {/if}
            {#if !hasActions}
              <span class="text-sm text-muted-foreground">No actions configured</span>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
