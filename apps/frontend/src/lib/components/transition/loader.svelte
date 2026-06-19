<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let { size = 48, children }: { size?: number; children?: Snippet } = $props();
</script>

<div class="flex flex-col items-center justify-center w-full h-full gap-3">
  <LoaderCircle class="animate-spin text-muted-foreground" {size} />
  {@render children?.()}
</div>
