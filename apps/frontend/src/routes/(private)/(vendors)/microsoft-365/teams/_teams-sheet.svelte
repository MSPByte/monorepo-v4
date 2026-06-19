<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365TeamsConfig } from '@mspbyte/drizzle';

  type TeamsRow = typeof m365TeamsConfig.$inferSelect;

  interface Props {
    policy: TeamsRow | null;
    onclose: () => void;
  }

  let { policy, onclose }: Props = $props();

  function boolBadge(value: boolean | null, trueIsRisk = true) {
    if (value === null) return { label: '—', class: 'bg-muted text-muted-foreground' };
    if (value) return trueIsRisk
      ? { label: 'Allowed', class: 'bg-warning/20 text-warning' }
      : { label: 'Yes', class: 'bg-success/15 text-success' };
    return trueIsRisk
      ? { label: 'Blocked', class: 'bg-muted text-muted-foreground' }
      : { label: 'No', class: 'bg-muted text-muted-foreground' };
  }
</script>

<Sheet.Root
  open={!!policy}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if policy}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{policy.externalId}</Sheet.Title>
        <Sheet.Description>Teams meeting policy</Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- Meeting Security -->
        <div class="flex flex-col gap-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meeting Security</div>
          <div class="flex flex-col gap-1.5 text-sm">
            {#each [
              { label: 'Anonymous Users Can Join', value: policy.allowAnonymousUsersToJoinMeeting, risk: true },
              { label: 'External Participant Control', value: policy.allowExternalParticipantGiveRequestControl, risk: true },
              { label: 'PSTN Bypass Lobby', value: policy.allowPSTNUsersToBypassLobby, risk: true },
            ] as setting}
              {@const badge = boolBadge(setting.value, setting.risk)}
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">{setting.label}</span>
                <span class={cn('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium', badge.class)}>
                  {badge.label}
                </span>
              </div>
            {/each}
            {#if policy.autoAdmittedUsers}
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Auto-Admit</span>
                <span class="text-xs font-medium">{policy.autoAdmittedUsers}</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- External Access -->
        <div class="border-t pt-3 flex flex-col gap-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">External Access</div>
          <div class="flex flex-col gap-1.5 text-sm">
            {#each [
              { label: 'Federated Users', value: policy.allowFederatedUsers },
              { label: 'Public Users', value: policy.allowPublicUsers },
              { label: 'Teams Consumer', value: policy.allowTeamsConsumer },
            ] as setting}
              {@const badge = boolBadge(setting.value, true)}
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">{setting.label}</span>
                <span class={cn('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium', badge.class)}>
                  {badge.label}
                </span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Allowed Domains -->
        {#if policy.allowedDomains && policy.allowedDomains.length > 0}
          <div class="border-t pt-3 flex flex-col gap-2">
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Allowed Domains <span class="ml-1 normal-case font-normal">({policy.allowedDomains.length})</span>
            </div>
            <div class="flex flex-col gap-1.5">
              {#each policy.allowedDomains as domain}
                <div class="text-xs font-mono p-2 rounded-md bg-muted/50">{domain}</div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
