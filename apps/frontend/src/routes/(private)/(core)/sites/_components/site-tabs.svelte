<script lang="ts">
  import { page } from '$app/state';
  let { tabs, label }: { tabs: { href: string; label: string; exact?: boolean }[]; label: string } =
    $props();
</script>

<nav class="sw-tabs" aria-label={label}>
  {#each tabs as tab}
    {@const active = tab.exact
      ? page.url.pathname === tab.href
      : page.url.pathname === tab.href || page.url.pathname.startsWith(`${tab.href}/`)}
    <a href={tab.href} aria-current={active ? 'page' : undefined}>{tab.label}</a>
  {/each}
</nav>
