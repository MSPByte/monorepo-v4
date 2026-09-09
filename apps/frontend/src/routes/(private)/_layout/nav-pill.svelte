<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { cn } from '$lib/utils';
  import type { Route } from '$lib/config/routes';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  let { routes }: { routes: Route[] } = $props();

  function isRouteActive(route: Route, pathname: string): boolean {
    if (route.children?.length) return route.children.some((c) => isRouteActive(c, pathname));
    if (route.href === '/home' && pathname === '/') return true;
    return pathname === route.href || pathname.startsWith(route.href + '/');
  }

  const activeIndex = $derived(routes.findIndex((r) => isRouteActive(r, page.url.pathname)));

  let container = $state<HTMLElement | null>(null);
  let itemEls = $state<Array<HTMLElement | null>>([]);
  let indicator = $state({ left: 0, width: 0, visible: false });
  let openIndex = $state<number | null>(null);

  function measure() {
    if (!container || activeIndex < 0) {
      indicator = { ...indicator, visible: false };
      return;
    }
    const el = itemEls[activeIndex];
    if (!el) return;
    const c = container.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    indicator = { left: e.left - c.left, width: e.width, visible: true };
  }

  $effect(() => {
    activeIndex;
    itemEls.length;
    queueMicrotask(measure);
  });

  $effect(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    for (const el of itemEls) if (el) ro.observe(el);
    return () => ro.disconnect();
  });

  const itemClass =
    'relative z-10 inline-flex items-center h-10 px-3 rounded-md text-xs font-medium transition-colors hover:text-white';

  function activeChildOf(route: Route): Route | undefined {
    return route.children?.find((c) => isRouteActive(c, page.url.pathname));
  }
</script>

<div
  bind:this={container}
  class="byte-navigation relative flex gap-1"
>
  {#if indicator.visible}
    <div
      class="absolute bottom-0 h-0.5 rounded-full bg-[#73e6c5]"
      style="left: {indicator.left}px; width: {indicator.width}px; transition: left 320ms cubic-bezier(0.32, 0.72, 0, 1), width 320ms cubic-bezier(0.32, 0.72, 0, 1);"
      aria-hidden="true"
    ></div>
  {/if}
  {#each routes as route, i (route.href + ':' + route.label)}
    {@const active = i === activeIndex}
    {@const activeChild = activeChildOf(route)}
    {#if route.children?.length}
      <Popover.Root open={openIndex === i} onOpenChange={(v) => (openIndex = v ? i : null)}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              bind:this={itemEls[i]}
              type="button"
              aria-current={active ? 'page' : undefined}
              class={cn(itemClass, 'gap-1.5', active ? 'text-white' : 'text-[#a8c0ca]')}
            >
              {route.label}
              {#if activeChild && activeChild.label !== route.label}
                <span class="text-[10px] opacity-60">·</span>
                <span class="text-xs opacity-80">{activeChild.label}</span>
              {/if}
              <ChevronDown class="size-3 opacity-50" />
            </button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content align="start" class="w-auto min-w-32 max-w-sm p-1">
          {#each route.children as child (child.href)}
            {@const childActive = isRouteActive(child, page.url.pathname)}
            <button
              type="button"
              onclick={() => {
                openIndex = null;
                goto(child.href);
              }}
              class={cn(
                'flex w-full items-center justify-center rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent',
                childActive ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
              )}
            >
              <span>{child.label}</span>
            </button>
          {/each}
        </Popover.Content>
      </Popover.Root>
    {:else}
      <a
        href={route.href}
        bind:this={itemEls[i]}
        aria-current={active ? 'page' : undefined}
        class={cn(itemClass, active ? 'text-white' : 'text-[#a8c0ca]')}
      >
        {route.label}
      </a>
    {/if}
  {/each}
</div>

<style>
  @media(max-width:760px) { .byte-navigation { flex-wrap:wrap; } .byte-navigation > div[aria-hidden] { display:none; } .byte-navigation :global([aria-current="page"]) { background:#284752; } }
</style>
