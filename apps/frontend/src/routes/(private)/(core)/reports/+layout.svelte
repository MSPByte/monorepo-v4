<script lang="ts">
  import ScopeBar from './_components/scope-bar.svelte';
  let { children } = $props();
</script>

<div class="flex size-full flex-col overflow-hidden">
  <div class="flex items-center justify-end border-b px-6 py-2">
    <ScopeBar />
  </div>
  <div class="min-h-0 flex-1">
    {@render children()}
  </div>
</div>
