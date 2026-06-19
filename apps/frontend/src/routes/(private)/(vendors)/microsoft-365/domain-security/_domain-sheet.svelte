<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365DomainConfig } from '@mspbyte/drizzle';

  type DomainRow = typeof m365DomainConfig.$inferSelect;

  interface Props {
    domain: DomainRow | null;
    onclose: () => void;
  }

  let { domain, onclose }: Props = $props();
</script>

<Sheet.Root
  open={!!domain}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if domain}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{domain.domainName}</Sheet.Title>
        <Sheet.Description>Email security configuration</Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- SPF -->
        <div class="flex flex-col gap-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">SPF</div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">Mode</span>
            {#if domain.spfRecord === null}
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-destructive/15 text-destructive">No Record</span>
            {:else if domain.spfIsPermissive}
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-warning/20 text-warning">Permissive</span>
            {:else}
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-success/15 text-success">Strict</span>
            {/if}
          </div>
          {#if domain.spfRecord}
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">Record</span>
              <code class="text-xs bg-muted rounded p-2 break-all leading-relaxed">{domain.spfRecord}</code>
            </div>
          {/if}
        </div>

        <!-- DMARC -->
        <div class="border-t pt-3 flex flex-col gap-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">DMARC</div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">Policy</span>
            {#if !domain.dmarcPolicy}
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-destructive/15 text-destructive">None</span>
            {:else if domain.dmarcPolicy === 'quarantine'}
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-warning/20 text-warning">Quarantine</span>
            {:else if domain.dmarcPolicy === 'reject'}
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-success/15 text-success">Reject</span>
            {:else}
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground capitalize">{domain.dmarcPolicy}</span>
            {/if}
          </div>
          {#if domain.dmarcRecord}
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">Record</span>
              <code class="text-xs bg-muted rounded p-2 break-all leading-relaxed">{domain.dmarcRecord}</code>
            </div>
          {/if}
        </div>

        <!-- DKIM -->
        <div class="border-t pt-3 flex flex-col gap-2">
          <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">DKIM</div>
          <div class="flex flex-col gap-1.5 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Signing</span>
              <span class={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                domain.dkimEnabled ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
              )}>
                {domain.dkimEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Selector 1</span>
              <span class={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                domain.dkimSelector1Present ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
              )}>
                {domain.dkimSelector1Present ? 'Present' : 'Missing'}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Selector 2</span>
              <span class={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                domain.dkimSelector2Present ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
              )}>
                {domain.dkimSelector2Present ? 'Present' : 'Missing'}
              </span>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
