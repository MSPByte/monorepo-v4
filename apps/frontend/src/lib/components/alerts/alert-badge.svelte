<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import { ALERT_DEFINITIONS, AlertSeverity, hydrateMessageTemplate } from '@mspbyte/shared';
  import StatusBadge from "$lib/components/status-badge.svelte";
  import type { db } from "$lib/db";

  const { alert }: { alert: db.Alert } = $props();

  const definition = $derived(ALERT_DEFINITIONS[alert.definitionId!]);

  const getVariant = () => {
    switch (alert.severity) {
      case AlertSeverity.Critical: return 'critical';
      case AlertSeverity.High: return 'destructive';
      case AlertSeverity.Medium: return 'warning';
      case AlertSeverity.Low: return 'muted';
      default: return 'default';
    }
  }

  const getSeverityLabel = () => {
    return ['Low', 'Medium', 'High', 'Critical'][alert.severity] ?? 'Unknown';
  }
</script>

<Tooltip.Provider>
  <Tooltip.Root>
    <Tooltip.Trigger>
      <StatusBadge variant={getVariant()}>
        {definition?.tag ?? alert.definitionId}
      </StatusBadge>
    </Tooltip.Trigger>
    <Tooltip.Content class="bg-card border-warning/30 border rounded flex flex-col items-start gap-1 py-3!">
      <div>
        <p class="text-xs font-medium text-primary">{definition?.name ?? alert.definitionId}</p>
        <span class="text-muted-foreground whitespace-nowrap">{getSeverityLabel()}</span>
      </div>
      {#if alert.metadata}
        <p class="text-xs text-muted-foreground mt-0.5">
          {hydrateMessageTemplate(definition?.messageTemplate ?? '', Object(alert.metadata))}
        </p>
      {/if}
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>