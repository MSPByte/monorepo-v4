<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    description,
    aside,
    children,
    class: className = '',
  }: {
    title: string;
    description?: string;
    aside?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();
</script>

<section class={`sw-panel ${className}`}>
  <header>
    <div>
      <h2>{title}</h2>
      {#if description}<p class="sw-panel-description">{description}</p>{/if}
    </div>
    {#if aside}<div class="sw-panel-actions">{@render aside()}</div>{/if}
  </header>
  <div class="sw-panel-body">{@render children()}</div>
</section>
