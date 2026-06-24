<script lang="ts">
  import type { FieldSource } from '../_profile/client-profile.types';

  let { source, class: className = '' }: { source: FieldSource; class?: string } = $props();

  const title = $derived(
    source === 'generated'
      ? 'Generated · derived from connected systems'
      : source === 'user_options'
        ? 'User entry · structured option'
        : source === 'user_free'
          ? 'User entry · free-form'
          : 'User entry · flexible note'
  );
</script>

<span class="inline-flex size-2 shrink-0 items-center justify-center {className}" {title} aria-label={title}>
  {#if source === 'generated'}
    <span class="size-1.5 rounded-full bg-primary"></span>
  {:else if source === 'user_options'}
    <span class="size-1.5 rotate-45 bg-foreground/70"></span>
  {:else if source === 'user_free'}
    <span class="size-1.5 rounded-full border border-foreground/40"></span>
  {:else}
    <span class="h-2 w-[2px] bg-warning"></span>
  {/if}
</span>
