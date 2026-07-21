<script lang="ts">
  import { onMount, tick } from 'svelte';
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
    if (!linkId && !siteId) return;

    const scope = INTEGRATIONS[provider].scope;

    if (scopeStore.currentIntegration !== provider) {
      scopeStore.currentIntegration = provider;
    }

    if (scope === 'link' && linkId && scopeStore.currentLink !== linkId) {
      scopeStore.currentLink = linkId;
    } else if (scope === 'site' && siteId && scopeStore.currentSite !== siteId) {
      scopeStore.currentSite = siteId;
    }

    if (!mounted) return;
    const stripped = new URL(url);
    stripped.searchParams.delete('linkId');
    stripped.searchParams.delete('siteId');
    tick().then(() => replaceState(stripped, page.state));
  });
</script>

{@render children()}
