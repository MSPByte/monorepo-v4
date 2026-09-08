<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';
  import Loader from '$lib/components/transition/loader.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';

  type FirewallRow = Record<string, unknown>;

  interface Props {
    open: boolean;
    firewall: FirewallRow | null;
    onOpenChange: (open: boolean) => void;
  }

  let { open, firewall, onOpenChange }: Props = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const firewallLicensesQuery = createQuery(() => ({
    queryKey: ['vendor.sophosFirewallLicenses', firewall?.['id']],
    queryFn: () => trpc.vendor.sophosFirewallLicenses.query({ firewallId: String(firewall?.['id']) }),
    enabled: !!firewall?.['id']
  }));

  function formatDate(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
  }

  function usageLabel(count: number | null, date?: string | null) {
    if (count === null) return null;
    const formattedDate = formatDate(date);
    return formattedDate ? `Usage ${count} as of ${formattedDate}` : `Usage ${count}`;
  }

  function relativeTime(ts?: string | number | null) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
</script>

<Sheet.Root {open} {onOpenChange}>
  <Sheet.Content side="right" class="w-80 flex flex-col p-0">
    {#if firewall}
      {@const fw = firewall}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{String(fw['name'] ?? '—')}</Sheet.Title>
        <Sheet.Description class="flex gap-1.5 mt-1">
          <span
            class={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
              fw['connected'] ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
            )}
          >
            {fw['connected'] ? 'Online' : 'Offline'}
          </span>
          {#if fw['upgradeToVersion']}
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-warning/20 text-warning">
              Upgrade Available
            </span>
          {/if}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Details</div>
        {#each [{ label: 'Hostname', value: fw['hostname'] }, { label: 'Model', value: fw['model'] }, { label: 'Serial', value: fw['serialNumber'] }, { label: 'External IP', value: fw['externalIp'] }, { label: 'Firmware', value: fw['firmwareVersion'] }, { label: 'Upgrade To', value: fw['upgradeToVersion'] }, { label: 'Managing', value: fw['managing'] }, { label: 'Reporting', value: fw['reporting'] }, { label: 'Suspended', value: fw['suspended'] ? 'Yes' : null }, { label: 'Last Change', value: relativeTime(fw['lastChangeAt'] as string | null) }] as item}
          {#if item.value}
            <div class="flex justify-between text-xs gap-2">
              <span class="text-muted-foreground shrink-0">{item.label}</span>
              <span class="font-medium text-right font-mono">{String(item.value)}</span>
            </div>
          {/if}
        {/each}

        <div class="border-t pt-3 mt-1 flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Licenses</div>
          </div>

          {#if firewallLicensesQuery.isLoading}
            <div class="py-2"><Loader size={20} /></div>
          {:else if firewallLicensesQuery.data?.length}
            {#each firewallLicensesQuery.data as license (license.id)}
              <div class="rounded-md border bg-muted/30 px-3 py-2.5 flex flex-col gap-1">
                <div class="text-xs font-medium leading-tight">{license.productName}</div>
                <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span class="font-mono">{license.productCode}</span>
                  <span>{license.type}</span>
                  {#if formatDate(license.endsAt)}<span>Expires {formatDate(license.endsAt)}</span>{/if}
                  {#if license.perpetual}<span>Perpetual</span>{/if}
                  {#if usageLabel(license.usageCount, license.usageDate)}
                    <span>{usageLabel(license.usageCount, license.usageDate)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          {:else}
            <div class="text-xs text-muted-foreground">No licenses reported for this firewall.</div>
          {/if}
        </div>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
