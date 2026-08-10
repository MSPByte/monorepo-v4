<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';

  let {
    value,
    roleMap = {},
  }: {
    value: string[] | null;
    roleMap?: Record<string, string>;
  } = $props();
</script>

{#if Array.isArray(value) && value.length > 0}
  <Badge variant="outline" class="mr-1">{roleMap[value[0]] ?? value[0]}</Badge>
  {#if value.length > 1}
    <Badge variant="outline" class="mr-1">+{value.length - 1}</Badge>
  {/if}
{:else}
  <span class="text-muted-foreground">—</span>
{/if}
