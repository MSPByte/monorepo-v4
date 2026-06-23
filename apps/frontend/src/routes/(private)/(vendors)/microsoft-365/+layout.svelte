<script lang="ts">
  import { type LayoutProps } from './$types';
  import { M365_INTEGRATION_CONFIG } from '@mspbyte/shared';
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import UrlTabs from '$lib/components/url-tabs.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';

  const { children }: LayoutProps = $props();
  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const tabs = [
    { label: 'Overview', href: '/microsoft-365', exact: true },
    { label: 'Findings', href: '/microsoft-365/findings' },
    ...M365_INTEGRATION_CONFIG.navigation
      .filter((n) => n.route !== '/compliance')
      .map((n) => ({
        label: n.label,
        href: `/microsoft-365${n.route}`,
        disabled: () => n.isNullable && !scopeStore.currentLink,
      })),
  ];

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'microsoft-365', 'active'],
    queryFn: () =>
      trpc.integrationLinks.list.query({ integrationId: 'microsoft-365', status: 'active' }),
  }));

  const currentLink = $derived(
    (linksQuery.data ?? []).find((l) => l.id === scopeStore.currentLink)
  );

  const isGdap = $derived(
    (currentLink?.meta as Record<string, unknown> | null)?.source === 'gdap' ||
      (currentLink?.meta as Record<string, unknown> | null)?.source === 'msp'
  );

  const customerDomain = $derived.by(() => {
    const meta = currentLink?.meta as Record<string, unknown> | null;
    return (meta?.defaultDomain as string) ?? (meta?.domains as string[])?.[0] ?? null;
  });

  const mspDomain = $derived.by(() => {
    const mspLink = (linksQuery.data ?? []).find(
      (l) => (l.meta as Record<string, unknown> | null)?.source === 'msp'
    );
    const meta = mspLink?.meta as Record<string, unknown> | null;
    return (meta?.defaultDomain as string) ?? null;
  });

  const portalOptions = $derived([
    { value: 'entra', label: 'Entra' },
    { value: 'm365-admin', label: 'M365 Admin' },
    { value: 'exchange', label: 'Exchange', disabled: !customerDomain },
    { value: 'teams', label: 'Teams', disabled: !customerDomain },
    { value: 'powerbi', label: 'PowerBI' },
    { value: 'sharepoint', label: 'SharePoint' },
    { value: 'azure', label: 'Azure', disabled: !customerDomain },
    { value: 'defender', label: 'Defender' },
    { value: 'intune', label: 'Intune' },
    { value: 'purview', label: 'Purview' },
  ]);

  const portalPlaceholder = $derived.by(() => {
    if (!scopeStore.currentLink) return 'Select a tenant';
    if (!isGdap) return 'GDAP required';
    return 'Open Portal';
  });

  let portalSelection = $state<string | undefined>(undefined);

  function handlePortalChange(selected: string) {
    if (!selected || !currentLink?.externalId) return;

    const tid = currentLink.externalId;
    let url: string | null = null;

    switch (selected) {
      case 'entra':
        url = `https://entra.microsoft.com/${tid}`;
        break;
      case 'azure':
        if (customerDomain) url = `https://portal.azure.com/${customerDomain}`;
        break;
      case 'exchange':
        if (customerDomain) {
          url = `https://admin.cloud.microsoft/exchange?rfr=Admin_o365&exsvurl=1&delegatedOrg=${customerDomain}`;
          if (mspDomain) url += `&Realm=${mspDomain}`;
        }
        break;
      case 'm365-admin':
        url = `https://admin.cloud.microsoft/Partner/BeginClientSession.aspx?CTID=${tid}&CSDEST=o365admincenter`;
        break;
      case 'defender':
        url = `https://security.microsoft.com/?tid=${tid}`;
        break;
      case 'intune':
        url = `https://endpoint.microsoft.com/${tid}`;
        break;
      case 'purview':
        url = `https://purview.microsoft.com/?tid=${tid}`;
        break;
      case 'powerbi':
        url = `https://app.powerbi.com/admin-portal?ctid=${tid}`;
        break;
      case 'sharepoint':
        url = `https://admin.microsoft.com/Partner/beginclientsession.aspx?CTID=${tid}&CSDEST=SharePoint`;
        break;
      case 'teams':
        if (customerDomain)
          url = `https://admin.teams.microsoft.com/?delegatedOrg=${customerDomain}`;
        break;
    }

    if (url) {
      window.open(url, '_blank');
    }

    portalSelection = undefined;
  }
</script>

<div class="flex flex-col size-full overflow-hidden">
  <UrlTabs {tabs}>
    <div class="w-40">
      <SingleSelect
        placeholder={portalPlaceholder}
        options={portalOptions}
        disabled={!scopeStore.currentLink || !isGdap}
        bind:selected={portalSelection}
        onchange={handlePortalChange}
        disableSort={true}
      />
    </div>
  </UrlTabs>
  <div class="flex-1 overflow-hidden">
    {@render children()}
  </div>
</div>
