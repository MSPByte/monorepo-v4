<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';
    import { INTEGRATIONS, type ProviderId } from "@mspbyte/shared";

  let { source }: { source: string } = $props();

  const friendlyName = $derived(INTEGRATIONS[source as ProviderId]?.name ?? source);
</script>

<Badge variant="outline" class="bg-background">{friendlyName}</Badge>
