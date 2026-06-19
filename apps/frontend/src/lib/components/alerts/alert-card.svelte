<script lang="ts">
  import Button from "$lib/components/ui/button/button.svelte";
  import { cn } from "$lib/utils";
  import { EyeOff } from "@lucide/svelte";
  import { ALERT_DEFINITIONS, AlertSeverity } from '@mspbyte/shared';
  import AlertSuppress from "$lib/components/alerts/alert-suppress.svelte";
  import type { UiAlert } from "$lib/components/alerts/types";
  import { hydratedAlertMessage } from './display';

  const { alert }: { alert: UiAlert } = $props();

  const definition = $derived(ALERT_DEFINITIONS[alert.definitionId!]);
  
  let open = $state(false);

  const getSeverityColor = () => {
    switch (alert.severity) {
      case AlertSeverity.Critical:
      case AlertSeverity.High: return "text-destructive";
      case AlertSeverity.Medium: return "text-warning";
      default: return "";
    }
  }
</script>

<div class="flex flex-col relative border rounded p-2 gap-3">
  <Button variant="link" class="absolute top-0 right-0 rounded! hover:cursor-pointer" onclick={() => open = true}>
    <EyeOff class="size-4"/>
  </Button>

  <div class="flex flex-col gap-1">
    <span class={cn(getSeverityColor())}>{definition.name}</span>
    <span class="text-xs text-muted-foreground">{definition.description}</span>
  </div>
  {#if alert.metadata}
    <span>{hydratedAlertMessage(alert)}</span>
  {/if}
</div>

<AlertSuppress id={alert.id} {alert} bind:open={open} />
