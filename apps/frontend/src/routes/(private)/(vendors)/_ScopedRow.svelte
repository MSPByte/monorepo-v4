<script lang="ts">
  import { cn } from '$lib/utils';
  import { AlertSeverity } from '@mspbyte/shared';
  import type { IntegrationLink } from '@mspbyte/drizzle';

  type LinkRow = IntegrationLink & Record<string, unknown>;

  let {
    link,
    label = 'Site',
    displayName,
    onclick,
    alertCount,
    highestSeverity,
    loading,
  }: {
    link: LinkRow;
    label?: string;
    displayName?: string | null;
    onclick: (link: LinkRow) => void;
    alertCount?: number;
    highestSeverity?: number | null;
    loading?: boolean;
  } = $props();

  const isLoading = $derived(loading ?? false);
  const resolvedAlertCount = $derived(alertCount ?? 0);
  const resolvedHighestSeverity = $derived(highestSeverity ?? null);

  function statusColor() {
    if (resolvedHighestSeverity === AlertSeverity.Critical) return 'bg-destructive';
    if (resolvedHighestSeverity === AlertSeverity.High) return 'bg-destructive/80';
    if (resolvedHighestSeverity === AlertSeverity.Medium) return 'bg-warning';
    if (resolvedHighestSeverity === AlertSeverity.Low) return 'bg-muted-foreground/40';
    return 'bg-success';
  }

  function statusLabel() {
    if (resolvedHighestSeverity === AlertSeverity.Critical)
      return { text: 'Critical', cls: 'bg-destructive/15 text-destructive' };
    if (resolvedHighestSeverity === AlertSeverity.High)
      return { text: 'High', cls: 'bg-destructive/10 text-destructive/80' };
    if (resolvedHighestSeverity === AlertSeverity.Medium)
      return { text: 'Medium', cls: 'bg-warning/20 text-warning' };
    if (resolvedHighestSeverity === AlertSeverity.Low)
      return { text: 'Low', cls: 'bg-muted text-muted-foreground' };
    return { text: 'Healthy', cls: 'bg-success/15 text-success' };
  }
</script>

<tr class="border-b transition-colors hover:bg-muted/50 cursor-pointer" onclick={() => onclick(link)}>
  <td class="px-4 py-3">
    {#if isLoading}
      <span class="inline-block w-2.5 h-2.5 rounded-full bg-muted animate-pulse"></span>
    {:else}
      <span class={cn('inline-block w-2.5 h-2.5 rounded-full shrink-0', statusColor())}></span>
    {/if}
  </td>
  <td class="px-4 py-3">
    <span class="font-medium text-sm">{displayName ?? link.name ?? link.externalId ?? link.id}</span>
  </td>
  <td class="px-4 py-3 text-center">
    {#if isLoading}
      <span class="inline-block w-8 h-4 rounded bg-muted animate-pulse"></span>
    {:else if resolvedAlertCount > 0}
      <span
        class="inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 rounded-full text-xs font-medium bg-destructive/15 text-destructive"
      >
        {resolvedAlertCount}
      </span>
    {:else}
      <span class="text-xs text-muted-foreground">-</span>
    {/if}
  </td>
  <td class="px-4 py-3 text-center">
    <span class="text-xs text-muted-foreground">-</span>
  </td>
  <td class="px-4 py-3 text-center">
    {#if isLoading}
      <span class="inline-block w-16 h-5 rounded bg-muted animate-pulse"></span>
    {:else}
      {@const s = statusLabel()}
      <span class={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', s.cls)}>
        {s.text}
      </span>
    {/if}
  </td>
</tr>
