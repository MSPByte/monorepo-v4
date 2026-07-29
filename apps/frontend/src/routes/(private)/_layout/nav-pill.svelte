<script lang="ts">
  import { page } from '$app/state';
  import { cn } from '$lib/utils';
  import type { Route } from '$lib/config/routes';

  let { routes }: { routes: Route[] } = $props();

  let container = $state<HTMLElement | null>(null);
  let linkEls = $state<Array<HTMLAnchorElement | null>>([]);
  let indicator = $state({ left: 0, width: 0, visible: false });

  const activeIndex = $derived(
    routes.findIndex((r) => page.url.pathname.startsWith(r.href)),
  );

  function measure() {
    if (!container || activeIndex < 0) {
      indicator = { ...indicator, visible: false };
      return;
    }
    const el = linkEls[activeIndex];
    if (!el) return;
    const c = container.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    indicator = {
      left: e.left - c.left,
      width: e.width,
      visible: true,
    };
  }

  $effect(() => {
    // Recompute when the active route changes or refs settle.
    activeIndex;
    linkEls.length;
    queueMicrotask(measure);
  });

  $effect(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    for (const el of linkEls) if (el) ro.observe(el);
    return () => ro.disconnect();
  });

  const linkClass =
    'relative z-10 inline-flex items-center h-8 px-4 rounded-full text-sm font-medium transition-colors hover:text-foreground';
</script>

<div
  bind:this={container}
  class="relative flex rounded-full p-1 bg-muted/50 border border-border/60 gap-0.5"
>
  {#if indicator.visible}
    <div
      class="absolute top-1 bottom-1 rounded-full bg-background shadow-sm ring-1 ring-border/40"
      style="left: {indicator.left}px; width: {indicator.width}px; transition: left 320ms cubic-bezier(0.32, 0.72, 0, 1), width 320ms cubic-bezier(0.32, 0.72, 0, 1);"
      aria-hidden="true"
    ></div>
  {/if}
  {#each routes as route, i (route.href)}
    {@const active = i === activeIndex}
    <a
      href={route.href}
      bind:this={linkEls[i]}
      aria-current={active ? 'page' : undefined}
      class={cn(linkClass, active ? 'text-foreground' : 'text-muted-foreground')}
    >
      {route.label}
    </a>
  {/each}
</div>
