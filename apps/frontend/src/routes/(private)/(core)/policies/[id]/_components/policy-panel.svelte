<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, aside, children }: { title: string; aside?: Snippet; children: Snippet } = $props();
</script>
<section class="pw-panel">
  <header><h2>{title}</h2>{#if aside}<div>{@render aside()}</div>{/if}</header>
  <div class="pw-panel-body">{@render children()}</div>
</section>
