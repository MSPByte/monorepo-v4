<script lang="ts">
  import SourceBadge from './source-badge.svelte';

  let {
    eyebrow,
    title,
    subtitle,
    sources = [],
  }: {
    eyebrow?: string;
    title: string;
    subtitle?: string;
    sources?: string[];
  } = $props();
</script>

<div class="flex flex-col gap-3 border-b bg-background/80 px-6 py-5">
  <div class="space-y-1">
    {#if eyebrow}
      <div class="text-xs font-medium uppercase tracking-normal text-muted-foreground">{eyebrow}</div>
    {/if}
    <h1 class="text-2xl font-semibold tracking-normal">{title}</h1>
    {#if subtitle}
      <p class="max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
    {/if}
  </div>
  {#if sources.length}
    <div class="flex flex-wrap gap-2">
      {#each sources as source}
        <SourceBadge {source} />
      {/each}
    </div>
  {/if}
</div>
