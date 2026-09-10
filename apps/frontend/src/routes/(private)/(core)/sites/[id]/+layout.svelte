<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import { TRPCClientError, type TRPCClient } from '@trpc/client';

  import UrlTabs from '../_components/site-tabs.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
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

<div class="flex size-full flex-col overflow-auto">
  {#if siteQuery.isLoading || profileQuery.isLoading}
    <Loader />
  {:else if siteQuery.error || !siteQuery.data || profileQuery.error || !profileQuery.data}
    <div class="sw-empty" role="alert">
      <h1>
        {siteQuery.error instanceof TRPCClientError && siteQuery.error.data?.code === 'NOT_FOUND'
          ? 'Site not found'
          : 'Unable to load this site'}
      </h1>
      <p>
        {siteQuery.error instanceof TRPCClientError && siteQuery.error.data?.code === 'NOT_FOUND'
          ? 'This site may have been removed or is no longer available.'
          : 'Try again to load the site and its profile. If the problem continues, check your access with an administrator.'}
      </p>
      <div class="flex flex-wrap gap-3">
        <Button variant="outline" href="/sites">Back to sites</Button><Button
          onclick={() => {
            void siteQuery.refetch();
            void profileQuery.refetch();
          }}>Try again</Button
        >
      </div>
    </div>
  {:else}
    <BriefingBar
      siteId={id}
      siteName={siteQuery.data.name}
      description={siteQuery.data.description}
      profile={profileQuery.data}
    />
    <UrlTabs {tabs} label="Site navigation" />
    <FadeIn class="min-h-0 flex-1 overflow-auto">
      {#key id}{@render children()}{/key}
    </FadeIn>
  {/if}
</div>
