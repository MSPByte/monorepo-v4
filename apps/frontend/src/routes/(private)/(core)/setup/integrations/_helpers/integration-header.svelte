<script lang="ts">
  import Loader from "$lib/components/transition/loader.svelte";
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import type { Integration } from '@mspbyte/shared';

  let {
    integration,
    active,
    loading = false,
  }: {
    integration: Integration;
    active: boolean;
    loading?: boolean;
  } = $props();
</script>

<div class="flex flex-col gap-0.5">
  <div class="flex items-center gap-2">
    {#if loading}
      <Loader />
    {/if}
    <h1 class="text-lg font-semibold">{integration.name}</h1>
    <Badge
      variant="outline"
      class="{active
        ? 'bg-primary/15 text-primary border-primary/30'
        : 'bg-muted text-muted-foreground'} text-xs"
    >
      {active ? 'Configured' : 'Not configured'}
    </Badge>
    <Badge variant="outline" class="text-xs bg-muted text-muted-foreground">
      {integration.category.charAt(0).toUpperCase() + integration.category.slice(1)}
    </Badge>
  </div>
  <p class="text-xs text-muted-foreground">
    Manage {integration.name} credentials and site mappings.
  </p>
</div>
