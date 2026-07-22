<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import MetaRow from '$lib/components/panel/meta-row.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
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

{#snippet findingRow(finding: Finding)}
  <a
    href={`/findings/${finding.id}`}
    class="grid gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center"
  >
    <div class="min-w-0">
      <div class="truncate">{finding.title}</div>
      <div class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        {finding.policyName}
      </div>
    </div>
    <div class="min-w-0 text-sm text-muted-foreground">
      <div class="truncate">{finding.evidenceSummary}</div>
      <div class="font-mono text-[10.5px] uppercase tracking-wider">
        last seen {formatRelativeDate(finding.lastSeenAt)}
      </div>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
      <FindingSeverityBadge severity={finding.severity} />
      <FindingStatusBadge status={finding.status} />
      <ArrowUpRight class="size-3 text-muted-foreground" />
    </div>
  </a>
{/snippet}

{#snippet linkRow(link: SourceLink)}
  <a
    href={integrationHref(link)}
    class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
  >
    <div class="flex min-w-0 items-baseline gap-2">
      <span class={`size-1.5 shrink-0 translate-y-px rounded-full ${linkStatusDot(link.status)}`}></span>
      <div class="min-w-0">
        <div class="truncate">{link.name}</div>
        <div class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          {providerName(link.integrationId)} · {link.sourceCount} record{link.sourceCount === 1 ? '' : 's'}
        </div>
      </div>
    </div>
    <ArrowUpRight class="size-3 shrink-0 text-muted-foreground" />
  </a>
{/snippet}

{#if assetQuery.data}
  {@const asset = assetQuery.data}
  {@const assetExtra = asAssetLike(asset)}
  {@const siteName = assetExtra.siteName ?? 'Unknown site'}
  {@const vendorEvidence = sourceRecords(asset)}
  {@const sourceLinks = assetSourceLinks(asset)}
  {@const findings = assetFindings(asset)}
  <FadeIn class="size-full overflow-auto">
    <AssetBriefing
      id={asset.id}
      hostname={asset.hostname}
      displayName={asset.displayName}
      type={asset.type}
      os={asset.os}
      status={asset.status}
      siteId={asset.siteId}
      {siteName}
      serialNumber={assetExtra.serialNumber}
      sourceConfidence={assetExtra.sourceConfidence}
      updatedAt={assetExtra.updatedAt}
      openFindingCount={findings.length || asset.openFindingCount}
      sourceCount={vendorEvidence.length || asset.sources.length}
      linkCount={sourceLinks.length}
    />

    <div class="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
      <!-- Top legend strip -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-card px-3 py-2">
        <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          ASSET INTELLIGENCE
          {#if assetExtra.updatedAt}
            <span class="ml-2 text-foreground/70">·</span>
            <span class="ml-2">updated {formatRelativeDate(assetExtra.updatedAt)}</span>
          {/if}
        </div>
        <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {vendorEvidence.length} source · {sourceLinks.length} link · {findings.length || asset.openFindingCount} finding
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <!-- LEFT COLUMN -->
        <div class="space-y-4">
          <VendorSourceRecords
            canonicalType="asset"
            canonicalId={asset.id}
            canonicalLabel={asset.hostname ?? asset.displayName}
            sources={vendorEvidence}
            queryKey={['assets.byId', id]}
          />


          <SectionPanel code="02" title="OPEN FINDINGS">
            {#snippet aside()}
              <a
                href={`/findings?resourceType=asset&resourceId=${asset.id}`}
                class="inline-flex items-center gap-1 hover:text-foreground"
              >
                view all <ArrowUpRight class="size-3" />
              </a>
            {/snippet}
            <div>
              {#each findings as finding}
                {@render findingRow(finding)}
              {:else}
                <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  no open findings
                </p>
              {/each}
            </div>
          </SectionPanel>
        </div>

        <!-- RIGHT COLUMN -->
        <aside class="space-y-4">
          <SectionPanel code="@" title="ASSET FACTS">
            <dl>
              <MetaRow label="Hostname" value={asset.hostname} />
              <MetaRow label="Display Name" value={asset.displayName} />
              <MetaRow label="Type" value={prettyText(asset.type)} />
              <MetaRow label="Operating Sys" value={asset.os} />
              <MetaRow label="Status" value={prettyText(asset.status)} />
              <MetaRow label="Serial" value={assetExtra.serialNumber} mono />
              <MetaRow
                label="Confidence"
                value={assetExtra.sourceConfidence ? prettyText(assetExtra.sourceConfidence) : null}
              />
              <MetaRow
                label="Updated"
                value={assetExtra.updatedAt ? formatRelativeDate(assetExtra.updatedAt) : null}
                mono
              />
            </dl>
          </SectionPanel>

          <SectionPanel code="↳" title="HIERARCHY">
            <div class="space-y-2 text-sm">
              {#if asset.siteId}
                <a
                  href={`/sites/${asset.siteId}`}
                  class="flex items-center justify-between gap-2 border-b border-border/40 pb-2"
                >
                  <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">SITE</span>
                  <span class="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    {siteName}
                    <ArrowUpRight class="size-3" />
                  </span>
                </a>
              {:else}
                <div class="flex items-center justify-between">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">SITE</span>
                  <span class="font-mono text-xs text-muted-foreground/60">— unassigned —</span>
                </div>
              {/if}
            </div>
          </SectionPanel>

          <SectionPanel code="≡" title="INTEGRATIONS">
            {#snippet aside()}
              {sourceLinks.length} attached
            {/snippet}
            <div>
              {#each sourceLinks as link}
                {@render linkRow(link)}
              {:else}
                <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  no integration links
                </p>
              {/each}
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  </FadeIn>
{:else}
  <Loader />
{/if}
