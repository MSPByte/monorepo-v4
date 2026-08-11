<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import { scopeStore } from '$lib/stores/scope.store.svelte';

  let { children } = $props();
  let mounted = $state(false);

  onMount(() => {
    mounted = true;
  });

  function detectProvider(pathname: string): ProviderId | null {
    const first = pathname.split('/').filter(Boolean)[0];
    if (!first) return null;
    return first in INTEGRATIONS ? (first as ProviderId) : null;
  }

  $effect(() => {
    const provider = detectProvider(page.url.pathname);
    if (!provider) return;

    const url = page.url;
    const linkId = url.searchParams.get('linkId');
    const siteId = url.searchParams.get('siteId');
    const groupId = url.searchParams.get('groupId');
    if (!linkId && !siteId && !groupId) return;

    const scope = INTEGRATIONS[provider].scope;

    // URL parameters provide initial scope only. Keep these store reads untracked so
    // clearing a scope in the chip cannot cause this effect to restore it from the URL.
    untrack(() => {
      if (scopeStore.currentIntegration !== provider) {
        scopeStore.currentIntegration = provider;
      }

      if (groupId && scopeStore.currentGroup !== groupId) {
        scopeStore.currentGroup = groupId;
      } else if (scope === 'tenant' && linkId && scopeStore.currentLink !== linkId) {
        scopeStore.currentLink = linkId;
      } else if (scope === 'site' && siteId && scopeStore.currentSite !== siteId) {
        scopeStore.currentSite = siteId;
      }
    });

    if (!mounted) return;
    const stripped = new URL(url);
    stripped.searchParams.delete('linkId');
    stripped.searchParams.delete('siteId');
    stripped.searchParams.delete('groupId');
    tick().then(() => replaceState(stripped, page.state));
  });
</script>

{@render children()}
