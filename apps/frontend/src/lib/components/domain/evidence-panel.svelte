<script lang="ts">
  import SourceBadge from './source-badge.svelte';

  let {
    summary,
    sources = [],
    items = [],
  }: {
    summary: string;
    sources?: string[];
    items?: string[];
  } = $props();
</script>

<section class="rounded-lg border bg-background p-4">
  <div class="mb-3 text-sm font-medium">Evidence</div>
  <p class="text-sm text-muted-foreground">{summary}</p>
  {#if sources.length}
    <div class="mt-4 flex flex-wrap gap-2">
      {#each sources as source}
        <SourceBadge {source} />
      {/each}
    </div>
  {/if}
  {#if items.length}
    <div class="mt-4 space-y-2 text-sm">
      {#each items as item}
        <div class="rounded-md bg-muted px-3 py-2">{item}</div>
      {/each}
    </div>
  {/if}
</section>
