<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365OAuthGrants } from '@mspbyte/drizzle';

  type OAuthGrantRow = typeof m365OAuthGrants.$inferSelect;

  interface Props {
    grant: OAuthGrantRow | null;
    onclose: () => void;
  }

  let { grant, onclose }: Props = $props();

  const consentInfo = $derived.by(() => {
    if (!grant) return { label: '', class: '' };
    if (grant.consentType === 'AllPrincipals') return { label: 'Admin (All Users)', class: 'bg-warning/20 text-warning' };
    return { label: 'User (Delegated)', class: 'bg-muted text-muted-foreground' };
  });
</script>

<Sheet.Root
  open={!!grant}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if grant}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title class="truncate">{grant.clientDisplayName ?? 'Unknown Application'}</Sheet.Title>
        <Sheet.Description>
          <span class={cn('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium', consentInfo.class)}>
            {consentInfo.label}
          </span>
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div class="flex flex-col gap-2 text-sm">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Application</div>
          <div class="flex items-start justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Client ID</span>
            <span class="font-mono text-xs text-right break-all">{grant.clientId}</span>
          </div>
        </div>

        <div class="border-t pt-3 flex flex-col gap-2 text-sm">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Resource</div>
          <div class="flex items-start justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Name</span>
            <span class="text-right">{grant.resourceDisplayName ?? '—'}</span>
          </div>
          <div class="flex items-start justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Resource ID</span>
            <span class="font-mono text-xs text-right break-all">{grant.resourceId}</span>
          </div>
        </div>

        {#if grant.principalId}
          <div class="border-t pt-3 flex flex-col gap-2 text-sm">
            <div class="flex items-start justify-between gap-2">
              <span class="text-muted-foreground shrink-0">Principal ID</span>
              <span class="font-mono text-xs text-right break-all">{grant.principalId}</span>
            </div>
          </div>
        {/if}

        {#if grant.scope}
          <div class="border-t pt-3 flex flex-col gap-2">
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Scopes</div>
            <div class="flex flex-wrap gap-1">
              {#each grant.scope.trim().split(' ') as scope}
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground font-mono">
                  {scope}
                </span>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
