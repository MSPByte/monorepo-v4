<script lang="ts">
    import { prettyText } from "$lib/utils/format";

  let { value, pretty }: { value: string | null; pretty?: boolean; } = $props();
</script>

{#if value}
  {pretty ? prettyText(String(value)) : value}
{:else}
  <span class="text-muted-foreground">—</span>
{/if}
