<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button/index.js';
  import { TriangleAlert } from '@lucide/svelte';
</script>

<div class="flex flex-col items-center justify-center size-full gap-4 text-center p-8">
  <TriangleAlert class="size-12 text-destructive" />
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-bold">
      {page.status} — {page.error?.message ?? 'Something went wrong'}
    </h1>
    <p class="text-muted-foreground text-sm">
      An unexpected error occurred. Try refreshing the page.
    </p>
  </div>
  <div class="flex gap-2">
    <Button variant="outline" onclick={() => history.back()}>Go Back</Button>
    <Button href="/home">Home</Button>
  </div>
</div>
