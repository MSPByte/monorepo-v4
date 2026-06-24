<script lang="ts">
  import type { ProfileNote } from '../_profile/client-profile.types';
  import { formatRelativeDate } from '$lib/utils/format';

  let { note }: { note: ProfileNote } = $props();
</script>

<article class="relative border-l-2 border-warning/40 bg-warning/[0.04] py-2 pl-3 pr-2">
  <div class="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-warning/90">
    <span class="opacity-70">~</span>
    <span class="font-semibold">{note.title}</span>
    {#if note.updatedAt}
      <span class="ml-auto text-muted-foreground/70">{formatRelativeDate(note.updatedAt)}</span>
    {/if}
  </div>
  <p class="text-[13px] leading-snug text-foreground/95">{note.description}</p>
</article>
