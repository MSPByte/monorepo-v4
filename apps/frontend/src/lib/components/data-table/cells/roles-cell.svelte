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
  {#each value as templateId}
    <Badge variant="outline" class="mr-1">{roleMap[templateId] ?? templateId}</Badge>
  {/each}
{:else}
  <span class="text-muted-foreground">—</span>
{/if}
