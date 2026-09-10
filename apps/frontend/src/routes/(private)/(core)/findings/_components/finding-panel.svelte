<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, aside, children }: { title: string; aside?: Snippet; children: Snippet } = $props();
</script>
<section class="fq-panel">
  <header><h2>{title}</h2>{#if aside}<span>{@render aside()}</span>{/if}</header>
  <div class="fq-panel-body">{@render children()}</div>
</section>
