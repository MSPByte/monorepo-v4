<script lang="ts">
  import { page } from '$app/state';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';

  const {
    tabs,
    children,
  }: {
    tabs: {
      href: string;
      label: string;
      exact?: boolean;
      disabled?: () => boolean;
    }[];
    children?: Snippet;
  } = $props();
</script>

<div class="flex w-full justify-between border-b bg-background">
  <div class="flex items-center gap-0 px-4 shrink-0">
    {#each tabs as tab}
      {@const isActive = tab.exact
        ? page.url.pathname === tab.href
        : page.url.pathname.includes(tab.href)}
      {@const disabled = tab.disabled?.() ?? false}
      <a
        href={tab.href}
        class={cn(
          'px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
          isActive
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground',
          disabled && 'opacity-50 pointer-events-none'
        )}
        aria-disabled={disabled}
      >
        {tab.label}
      </a>
    {/each}
  </div>
  <div class="w-fit h-fit items-center justify-center my-auto px-2">
    {@render children?.()}
  </div>
</div>
