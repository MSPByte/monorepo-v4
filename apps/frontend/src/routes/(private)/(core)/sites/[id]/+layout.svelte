<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import UrlTabs from '$lib/components/url-tabs.svelte';
  import BriefingBar from './_components/briefing-bar.svelte';
  import {
    provideSiteContext,
    type SiteContextStore,
    type SiteRecord,
  } from './_components/site-context';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const siteQuery = createQuery(() => ({
    queryKey: ['sites.byId', id],
    queryFn: () => trpc.sites.byId.query({ id }),
    enabled: !!id,
  }));

  const profileQuery = createQuery(() => ({
    queryKey: ['sites.profileById', id],
    queryFn: () => trpc.sites.profileById.query({ id }),
    enabled: !!id,
  }));

  const store: SiteContextStore = $state({ site: null, profile: null });
  provideSiteContext(store);

  $effect.pre(() => {
    store.site = (siteQuery.data as SiteRecord | undefined) ?? null;
    store.profile = profileQuery.data ?? null;
  });

  const tabs = $derived([
    { href: `/sites/${id}`, label: 'Overview', exact: true },
    { href: `/sites/${id}/assets`, label: 'Assets' },
    { href: `/sites/${id}/findings`, label: 'Findings' },
    { href: `/sites/${id}/wiki`, label: 'Wiki' },
    { href: `/sites/${id}/network`, label: 'Network' },
  ]);

  let { children } = $props();
</script>

<div class="flex size-full flex-col overflow-hidden">
  {#if siteQuery.isLoading || profileQuery.isLoading}
    <Loader />
  {:else if siteQuery.error || !siteQuery.data || profileQuery.error || !profileQuery.data}
    <div class="p-8 text-sm text-destructive">Site not found.</div>
  {:else}
    <BriefingBar
      siteId={id}
      siteName={siteQuery.data.name}
      description={siteQuery.data.description}
      profile={profileQuery.data}
    />
    <UrlTabs {tabs} />
    <FadeIn class="min-h-0 flex-1 overflow-auto">
      {@render children()}
    </FadeIn>
  {/if}
</div>
