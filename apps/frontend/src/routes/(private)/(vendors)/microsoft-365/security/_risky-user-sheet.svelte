<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365RiskyUsers } from '@mspbyte/drizzle';

  type RiskyUserRow = typeof m365RiskyUsers.$inferSelect;

  interface Props {
    user: RiskyUserRow | null;
    onclose: () => void;
  }

  let { user, onclose }: Props = $props();

  const riskLevelInfo = $derived.by(() => {
    if (!user) return { class: '' };
    if (user.riskLevel === 'high') return { class: 'bg-destructive/15 text-destructive' };
    if (user.riskLevel === 'medium') return { class: 'bg-warning/20 text-warning' };
    return { class: 'bg-muted text-muted-foreground' };
  });

  const riskStateInfo = $derived.by(() => {
    if (!user) return { class: '' };
    if (user.riskState === 'atRisk' || user.riskState === 'confirmedCompromised') return { class: 'bg-destructive/15 text-destructive' };
    if (user.riskState === 'remediated' || user.riskState === 'confirmedSafe') return { class: 'bg-success/15 text-success' };
    return { class: 'bg-muted text-muted-foreground' };
  });

  const RISK_STATE_LABELS: Record<string, string> = {
    atRisk: 'At Risk',
    confirmedCompromised: 'Confirmed Compromised',
    remediated: 'Remediated',
    confirmedSafe: 'Confirmed Safe',
    dismissed: 'Dismissed',
    none: 'None',
  };
</script>

<Sheet.Root
  open={!!user}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if user}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{user.userDisplayName ?? user.userPrincipalName}</Sheet.Title>
        <Sheet.Description class="text-xs">{user.userPrincipalName}</Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- Risk badges -->
        <div class="flex flex-wrap gap-1.5">
          <span class={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize', riskLevelInfo.class)}>
            {user.riskLevel} Risk
          </span>
          <span class={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', riskStateInfo.class)}>
            {RISK_STATE_LABELS[user.riskState] ?? user.riskState}
          </span>
        </div>

        <!-- Details -->
        <div class="grid grid-cols-1 gap-3 text-xs">
          {#if user.riskDetail}
            <div>
              <div class="text-muted-foreground mb-0.5">Risk Detail</div>
              <div class="font-medium">{user.riskDetail}</div>
            </div>
          {/if}
          {#if user.riskLastUpdatedAt}
            <div>
              <div class="text-muted-foreground mb-0.5">Last Updated</div>
              <div class="font-medium">{new Date(user.riskLastUpdatedAt).toLocaleDateString()}</div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
