<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { m365Devices } from '@mspbyte/drizzle';

  type DeviceRow = typeof m365Devices.$inferSelect;

  interface Props {
    device: DeviceRow | null;
    onclose: () => void;
  }

  let { device, onclose }: Props = $props();

  function relativeTime(ts?: string | null) {
    if (!ts) return 'Never';
    const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }
</script>

<Sheet.Root
  open={!!device}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-96 flex flex-col p-0">
    {#if device}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{device.displayName}</Sheet.Title>
        <Sheet.Description>{device.operatingSystem ?? 'Unknown OS'}</Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <!-- Status badges -->
        <div class="flex flex-wrap gap-1.5">
          <span class={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
            device.isCompliant === true
              ? 'bg-success/15 text-success'
              : device.isCompliant === false
              ? 'bg-destructive/15 text-destructive'
              : 'bg-muted text-muted-foreground'
          )}>
            {device.isCompliant === true ? 'Compliant' : device.isCompliant === false ? 'Non-Compliant' : 'Compliance Unknown'}
          </span>
          <span class={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
            device.isManaged === true
              ? 'bg-success/15 text-success'
              : device.isManaged === false
              ? 'bg-destructive/15 text-destructive'
              : 'bg-muted text-muted-foreground'
          )}>
            {device.isManaged === true ? 'Managed' : device.isManaged === false ? 'Unmanaged' : 'Management Unknown'}
          </span>
        </div>

        <!-- Details grid -->
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div class="text-muted-foreground mb-0.5">Operating System</div>
            <div class="font-medium">{device.operatingSystem ?? '—'}</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Version</div>
            <div class="font-medium">{device.operatingSystemVersion ?? '—'}</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Ownership</div>
            <div class="font-medium capitalize">{device.deviceOwnership ?? '—'}</div>
          </div>
          <div>
            <div class="text-muted-foreground mb-0.5">Last Sign-in</div>
            <div class="font-medium">{relativeTime(device.approximateLastSignInAt)}</div>
          </div>
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
