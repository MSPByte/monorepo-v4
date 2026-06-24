<script lang="ts">
  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import type { Snippet } from 'svelte';

  let {
    code,
    title,
    aside,
    children,
  }: {
    code?: string;
    title: string;
    aside?: Snippet;
    children: Snippet;
  } = $props();
</script>

<SectionPanel {code} {title} {aside}>
  {@render children()}
</SectionPanel>
