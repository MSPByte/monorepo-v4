<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import { TRPCClientError, type TRPCClient } from '@trpc/client';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import MetaRow from '$lib/components/panel/meta-row.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { Button } from '$lib/components/ui/button';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';

  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import AssetBriefing from './_components/asset-briefing.svelte';
  import VendorSourceRecords from '$lib/components/domain/vendor-source-records.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const assetQuery = createQuery(() => ({
    queryKey: ['assets.byId', id],
    queryFn: () => trpc.assets.byId.query({ id }),
  }));

  const notFound = $derived(
    assetQuery.error instanceof TRPCClientError && assetQuery.error.data?.code === 'NOT_FOUND'
  );

  type SourceRecord = {
    id?: string;
    label?: string;
    table?: string;
    provider?: string;
    type?: string;
    externalId?: string;
    vendorRecordId?: string;
    linkId?: string | null;
    linkName?: string | null;
    linkStatus?: string | null;
    integrationId?: string | null;
    siteId?: string | null;
    confidence?: number;
    matchMethod?: string;
    status?: string;
    manuallyConfirmedAt?: string | null;
    manuallyRejectedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };

  type SourceLink = {
    id: string;
    name: string;
    status?: string | null;
    integrationId?: string | null;
    siteId?: string | null;
    sourceCount: number;
  };

  type Finding = {
    id: string;
    title: string;
    severity: number;
    status: string;
    policyName: string;
    evidenceSummary: string;
    recommendation?: string | null;
    lastSeenAt: string;
  };

  type AssetLike = {
    siteName?: string;
    serialNumber?: string | null;
    sourceConfidence?: string | null;
    updatedAt?: string;
    vendorEvidence?: unknown[];
    sourceLinks?: unknown[];
    findings?: unknown[];
  };

  let findingSearch = $state('');
  $effect(() => {
    id;
    findingSearch = '';
  });

  function asAssetLike(asset: unknown): AssetLike {
    return asset && typeof asset === 'object' ? (asset as AssetLike) : {};
  }

  function isSourceRecord(value: unknown): value is SourceRecord {
    return !!value && typeof value === 'object';
  }

  function isSourceLink(value: unknown): value is SourceLink {
    return !!value && typeof value === 'object' && 'id' in value && 'name' in value;
  }

  function isFinding(value: unknown): value is Finding {
    return !!value && typeof value === 'object' && 'id' in value && 'title' in value;
  }

  function sourceRecords(asset: unknown): SourceRecord[] {
    const evidence = asAssetLike(asset).vendorEvidence;
    return Array.isArray(evidence) ? evidence.filter(isSourceRecord) : [];
  }

  function assetSourceLinks(asset: unknown): SourceLink[] {
    const links = asAssetLike(asset).sourceLinks;
    return Array.isArray(links) ? links.filter(isSourceLink) : [];
  }

  function assetFindings(asset: unknown): Finding[] {
    const findings = asAssetLike(asset).findings;
    return Array.isArray(findings) ? findings.filter(isFinding) : [];
  }

  function integrationHref(link: SourceLink): string {
    if (!link.integrationId) return `/setup/integrations?linkId=${link.id}`;
    const params = new URLSearchParams({ linkId: link.id });
    if (link.siteId) params.set('siteId', link.siteId);
    return `/${link.integrationId}?${params.toString()}`;
  }

  function providerName(id?: string | null): string {
    if (!id) return 'Integration';
    return INTEGRATIONS[id as ProviderId]?.name ?? id;
  }

  function linkStatusDot(value?: string | null): string {
    if (value === 'active') return 'bg-primary';
    if (value === 'error') return 'bg-destructive';
    if (value === 'disabled' || value === 'inactive') return 'bg-muted-foreground';
    return 'bg-muted-foreground';
  }
</script>

<svelte:head><title>{assetQuery.data?.hostname ?? 'Asset'} · MSPByte</title></svelte:head>

{#snippet findingRow(finding: Finding)}
  <a href={`/findings/${finding.id}`} class="aw-finding">
    <div class="flex flex-wrap items-center gap-2">
      <FindingSeverityBadge severity={finding.severity} /><FindingStatusBadge
        status={finding.status}
      /><span class="ml-auto text-xs text-muted-foreground"
        >Seen {formatRelativeDate(finding.lastSeenAt)}</span
      >
    </div>
    <div class="flex items-start justify-between gap-3">
      <h3>{finding.title}</h3>
      <ArrowUpRight class="size-4 shrink-0 text-muted-foreground" />
    </div>
    <p>{finding.evidenceSummary}</p>
    {#if finding.recommendation}<div class="aw-recommendation">
        <span>Recommended action</span>
        <p>{finding.recommendation}</p>
      </div>{/if}
    <span class="text-xs text-muted-foreground">{finding.policyName}</span>
  </a>
{/snippet}

{#snippet linkRow(link: SourceLink)}
  <a href={integrationHref(link)} class="aw-link-row">
    <span class={`size-2 shrink-0 rounded-full ${linkStatusDot(link.status)}`}></span>
    <div class="min-w-0 flex-1">
      <strong>{link.name}</strong>
      <p>
        {providerName(link.integrationId)} · {link.sourceCount} record{link.sourceCount === 1
          ? ''
          : 's'} · {prettyText(link.status ?? 'unknown')}
      </p>
    </div>
    <ArrowUpRight class="size-4 shrink-0 text-muted-foreground" />
  </a>
{/snippet}

<div class="aw-detail-scroll">
  {#if assetQuery.data}
    {@const asset = assetQuery.data}
    {@const assetExtra = asAssetLike(asset)}
    {@const siteName = assetExtra.siteName ?? 'Unknown site'}
    {@const vendorEvidence = sourceRecords(asset)}
    {@const sourceLinks = assetSourceLinks(asset)}
    {@const findings = assetFindings(asset)}
    {@const openFindingCount = assetExtra.findings ? findings.length : asset.openFindingCount}
    {@const visibleFindings = findings
      .filter((finding) =>
        `${finding.title} ${finding.policyName} ${finding.evidenceSummary} ${finding.recommendation ?? ''}`
          .toLowerCase()
          .includes(findingSearch.trim().toLowerCase())
      )
      .toSorted((a, b) => b.severity - a.severity)}
    <div class="aw-detail">
      <AssetBriefing
        hostname={asset.hostname}
        displayName={asset.displayName}
        type={asset.type}
        os={asset.os}
        status={asset.status}
        siteId={asset.siteId}
        {siteName}
        updatedAt={assetExtra.updatedAt}
        {openFindingCount}
        sourceCount={vendorEvidence.length}
        linkCount={sourceLinks.length}
      />
      {#if assetQuery.isError}<div class="aw-notice" role="alert">
          This asset could not be refreshed. Displaying the last loaded details. <button
            type="button"
            onclick={() => assetQuery.refetch()}>Retry</button
          >
        </div>{/if}
      <div class="aw-detail-grid">
        <div class="space-y-5 min-w-0">
          <section class="aw-panel" id="asset-findings">
            <header class="aw-panel-heading">
              <div>
                <h2>Open findings <span class="aw-count">{openFindingCount}</span></h2>
                <p>Review the most severe issues first.</p>
              </div>
            </header>
            {#if findings.length > 0}
              <div class="aw-findings-search">
                <input
                  type="search"
                  aria-label="Search findings"
                  placeholder="Search findings or policies…"
                  bind:value={findingSearch}
                /><span aria-live="polite">{visibleFindings.length} of {findings.length}</span>
              </div>
              <div class="aw-findings-list">
                {#each visibleFindings as finding (finding.id)}{@render findingRow(
                    finding
                  )}{:else}<div class="aw-empty">
                    <h3>No matching findings</h3>
                    <p>Try a different device issue or policy name.</p>
                    <Button variant="outline" onclick={() => (findingSearch = '')}
                      >Clear search</Button
                    >
                  </div>{/each}
              </div>
            {:else if openFindingCount > 0}
              <div class="aw-empty">
                <p>Finding details are not available here.</p>
                <Button
                  href={`/findings?resourceType=asset&resourceId=${asset.id}`}
                  variant="outline">View findings</Button
                >
              </div>
            {:else}
              <div class="aw-empty">
                <CircleCheck class="size-7 text-success" />
                <h3>No open findings</h3>
                <p>
                  There are no open issues reported for this asset or its confirmed source records.
                </p>
              </div>
            {/if}
          </section>
          <div id="asset-sources" class="aw-sources">
            <VendorSourceRecords
              canonicalType="asset"
              canonicalId={asset.id}
              canonicalLabel={asset.hostname ?? asset.displayName}
              sources={vendorEvidence}
              queryKey={['assets.byId', id]}
              code=""
              title="Source records"
            />
          </div>
        </div>
        <aside class="space-y-5 min-w-0">
          <section class="aw-panel">
            <header class="aw-panel-heading">
              <div>
                <h2>Device details</h2>
                <p>Identity and inventory information.</p>
              </div>
            </header>
            <dl class="aw-facts">
              <MetaRow label="Hostname" value={asset.hostname} />
              <MetaRow label="Display name" value={asset.displayName} />
              <MetaRow label="Type" value={prettyText(asset.type)} />
              <MetaRow label="Operating system" value={asset.os} />
              <MetaRow label="Status" value={prettyText(asset.status)} />
              <MetaRow label="Serial number" value={assetExtra.serialNumber} mono />
              <MetaRow
                label="Source confidence"
                value={assetExtra.sourceConfidence ? prettyText(assetExtra.sourceConfidence) : null}
              />
            </dl>
            <div class="aw-site">
              <span>Site</span>{#if asset.siteId}<a href={`/sites/${asset.siteId}`}
                  >{siteName}<ArrowUpRight class="size-3.5 shrink-0" /></a
                >{:else}<span class="text-muted-foreground">No site assigned</span>{/if}
            </div>
          </section>
          <section class="aw-panel" id="asset-integrations">
            <header class="aw-panel-heading">
              <div>
                <h2>Integrations <span class="aw-count">{sourceLinks.length}</span></h2>
                <p>Connections providing confirmed records.</p>
              </div>
            </header>
            <div class="px-5">
              {#each sourceLinks as link (link.id)}{@render linkRow(link)}{:else}<p
                  class="py-5 text-sm text-muted-foreground"
                >
                  No integrations are linked yet. Review source records to confirm a match.
                </p>{/each}
            </div>
          </section>
        </aside>
      </div>
    </div>
  {:else if assetQuery.isError}
    <div class="aw-empty aw-error" role="alert">
      <CircleAlert class="size-8 text-muted-foreground" />
      <h1>{notFound ? 'Asset not found' : 'Could not load this asset'}</h1>
      <p>
        {notFound
          ? 'This asset may have been removed, or you may no longer have access to it.'
          : 'Try again to load the device details and findings.'}
      </p>
      <div class="flex gap-2">
        <Button href="/assets" variant="outline">Back to assets</Button><Button
          onclick={() => assetQuery.refetch()}
          disabled={assetQuery.isFetching}
          >{assetQuery.isFetching ? 'Retrying…' : 'Try again'}</Button
        >
      </div>
    </div>
  {:else}
    <Loader><p class="text-sm text-muted-foreground">Loading asset details…</p></Loader>
  {/if}
</div>
