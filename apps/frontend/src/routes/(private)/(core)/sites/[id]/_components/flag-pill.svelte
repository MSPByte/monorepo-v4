<script lang="ts">
  import type { Flag } from '../_profile/client-profile.types';

  let { flag }: { flag: Flag } = $props();

  const tone = $derived(
    flag.severity === 'critical'
      ? 'border-destructive/40 bg-destructive/[0.06]'
      : flag.severity === 'warn'
        ? 'border-warning/50 bg-warning/[0.08]'
        : 'border-border bg-muted/40'
  );

  const dot = $derived(
    flag.severity === 'critical'
      ? 'bg-destructive'
      : flag.severity === 'warn'
        ? 'bg-warning'
        : 'bg-muted-foreground'
  );
</script>

<div class={`group relative flex items-start gap-2.5 border-l-2 px-3 py-2 ${tone}`}>
  <span class={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`}></span>
  <div class="min-w-0 space-y-0.5">
    <div class="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">{flag.label}</div>
    {#if flag.description}
      <p class="text-xs leading-snug text-muted-foreground">{flag.description}</p>
    {/if}
  </div>
</div>
