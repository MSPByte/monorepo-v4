<script lang="ts">
  import { Check, X, Minus, Play, Pencil } from '@lucide/svelte';

  export type StepStatus =
    | 'draft'
    | 'pending'
    | 'running'
    | 'success'
    | 'skip'
    | 'fail'
    | 'halted';

  type Props = {
    status: StepStatus;
    number: number;
  };

  let { status, number }: Props = $props();

  // Terminal states get an icon; everything else keeps its ordinal so the
  // sequence stays legible while a package is being authored or executed.
  const styles = $derived.by(() => {
    switch (status) {
      case 'success':
        return 'border-emerald-500 bg-emerald-500 text-white';
      case 'fail':
        return 'border-rose-500 bg-rose-500 text-white';
      case 'halted':
        return 'border-amber-500 bg-amber-500 text-white';
      case 'skip':
        return 'border-muted-foreground/40 bg-muted text-muted-foreground';
      case 'running':
        return 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400';
      case 'pending':
        return 'border-muted-foreground/30 bg-background text-muted-foreground';
      case 'draft':
      default:
        return 'border-dashed border-muted-foreground/40 bg-background text-muted-foreground';
    }
  });
</script>

<div
  class={`relative flex size-9 items-center justify-center rounded-full border-2 font-mono text-xs tabular-nums transition-colors ${styles}`}
  aria-label={`Step ${number} (${status})`}
>
  {#if status === 'success'}
    <Check class="size-4" />
  {:else if status === 'fail'}
    <X class="size-4" />
  {:else if status === 'skip'}
    <Minus class="size-4" />
  {:else if status === 'halted'}
    <Play class="size-4 -rotate-90" />
  {:else if status === 'draft'}
    <Pencil class="size-3" />
  {:else}
    {String(number).padStart(2, '0')}
  {/if}
  {#if status === 'running'}
    <span class="absolute -inset-1 animate-ping rounded-full border border-sky-500/40"></span>
  {/if}
</div>
