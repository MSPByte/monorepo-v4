<script lang="ts">
  import type { ProfileNote } from '../_profile/client-profile.types';

  let { note }: { note: ProfileNote } = $props();

  const severity = $derived(note.severity ?? 0);
  const tone = $derived(
    severity >= 3
      ? 'border-destructive/40 bg-destructive/[0.06]'
      : severity >= 2
        ? 'border-warning/50 bg-warning/[0.08]'
        : 'border-border bg-muted/40'
  );
  const dot = $derived(
    severity >= 3 ? 'bg-destructive' : severity >= 2 ? 'bg-warning' : 'bg-muted-foreground'
  );
</script>

<div class={`group relative flex items-start gap-2.5 border-l-2 px-3 py-2 ${tone}`}>
  <span class={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`}></span>
  <div class="min-w-0 space-y-0.5">
    <div class="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">{note.title}</div>
    {#if note.description}
      <p class="text-xs leading-snug text-muted-foreground">{note.description}</p>
    {/if}
  </div>
</div>
