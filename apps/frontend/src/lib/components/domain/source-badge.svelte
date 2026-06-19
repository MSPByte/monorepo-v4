<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';

  let { source }: { source: string } = $props();
</script>

<Badge variant="outline" class="bg-background">{source}</Badge>
