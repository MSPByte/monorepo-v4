<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { ExternalLink } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { getPolicyTableShape } from '@mspbyte/shared';
  import { serializeFilters } from '$lib/components/data-table';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';

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
    confidence?: number;
    matchMethod?: string;
    createdAt?: string;
    updatedAt?: string;
  };

  type SourceLink = {
    id: string;
    name: string;
    status?: string | null;
    integrationId?: string | null;
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
    return link.integrationId
      ? `/setup/integrations/${link.integrationId}?linkId=${link.id}`
      : `/setup/integrations?linkId=${link.id}`;
  }

  function sourceIntegrationHref(source: SourceRecord): string | null {
    if (!source.linkId) return null;
    return source.integrationId
      ? `/setup/integrations/${source.integrationId}?linkId=${source.linkId}`
      : `/setup/integrations?linkId=${source.linkId}`;
  }

  function sourceHref(source: SourceRecord): string | null {
    if (!source.table || !source.externalId) return null;
    const route = getPolicyTableShape(source.table)?.route;
    if (!route) return null;
    const filters = serializeFilters([
      {
        id: 'asset-source',
        field: route.searchField,
        operator: 'eq',
        value: source.externalId,
      },
      ...(source.linkId
        ? [
            {
              id: 'asset-source-link',
              field: 'linkId',
              operator: 'eq' as const,
              value: source.linkId,
            },
          ]
        : []),
    ]);
    const params = new URLSearchParams({ filters });
    return `${route.path}?${params.toString()}`;
  }

  function vendorTableHref(source: SourceRecord): string | null {
    if (!source.table) return null;
    return getPolicyTableShape(source.table)?.route?.path ?? null;
  }

  function statusClass(value?: string | null): string {
    if (value === 'active') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
    if (value === 'error') return 'border-destructive/30 bg-destructive/10 text-destructive';
    if (value === 'disabled' || value === 'inactive')
      return 'border-muted-foreground/30 bg-muted text-muted-foreground';
    return 'border-border bg-muted/50 text-muted-foreground';
  }

  function confidenceText(value?: number): string {
    if (value === undefined) return 'Unknown confidence';
    return `${value}% confidence`;
  }

  function relativeOrNull(value?: string): string | null {
    return value ? formatRelativeDate(value) : null;
  }
</script>

{#snippet Stat(label: string, value: string | number)}
  <div class="min-w-0 border-l pl-4">
    <div class="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
    <div class="mt-1 truncate text-sm font-medium">{value}</div>
  </div>
{/snippet}

{#snippet Detail(label: string, value: string | null | undefined)}
  <div class="min-w-0">
    <dt class="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd class="mt-1 wrap-break-word text-sm">{value || '-'}</dd>
  </div>
{/snippet}

{#snippet SourceRow(source: SourceRecord)}
  {@const href = sourceHref(source)}
  <div
    class="grid gap-3 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center"
  >
    <div class="min-w-0">
      <div class="truncate text-sm font-medium">
        {source.label ?? prettyText(source.table ?? 'Source')}
      </div>
      <div class="truncate text-xs text-muted-foreground">
        {source.provider ?? 'Provider'}
      </div>
    </div>
    <div class="min-w-0 text-sm">
      {#if source.linkId}
        <a href={sourceIntegrationHref(source) ?? '#'} class="truncate hover:underline">
          {source.linkName ?? source.linkId}
        </a>
      {:else}
        <span class="text-muted-foreground">No link</span>
      {/if}
      <div class="text-xs text-muted-foreground">{confidenceText(source.confidence)}</div>
    </div>
    <div class="flex flex-wrap items-center gap-2 md:justify-end">
      {#if source.linkStatus}
        <span class={`rounded-md border px-2 py-1 text-xs ${statusClass(source.linkStatus)}`}>
          {prettyText(source.linkStatus)}
        </span>
      {/if}
      {#if href}
        <a
          {href}
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          <ExternalLink class="size-3.5" />
          Open record
        </a>
      {:else if vendorTableHref(source)}
        <a
          href={vendorTableHref(source)}
          class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          <ExternalLink class="size-3.5" />
          Open table
        </a>
      {/if}
    </div>
  </div>
{/snippet}

<!-- TODO: Link this to the /[integration] and scope in the URL params -->
{#snippet LinkRow(link: SourceLink)}
  <div
    class="flex justify-between gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/40 md:grid-cols-[minmax(0,1fr)_160px_120px] md:items-center"
  >
    <div class="w-fit">
      <div class="truncate text-sm font-medium">{link.name}</div>
      <div class="truncate text-xs text-muted-foreground">
        {link.integrationId ?? 'Integration link'}
      </div>
    </div>
    <div class="text-xs">
      Link
    </div>
  </div>
{/snippet}

{#snippet FindingRow(finding: Finding)}
  <a
    href={`/findings/${finding.id}`}
    class="grid gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/40 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center"
  >
    <div class="min-w-0">
      <div class="truncate text-sm font-medium">{finding.title}</div>
      <div class="truncate text-xs text-muted-foreground">{finding.policyName}</div>
    </div>
    <div class="min-w-0 text-sm text-muted-foreground">
      <div class="truncate">{finding.evidenceSummary}</div>
      <div class="text-xs">Last seen {formatRelativeDate(finding.lastSeenAt)}</div>
    </div>
    <div class="flex flex-wrap gap-2 lg:justify-end">
      <FindingSeverityBadge severity={finding.severity} />
      <FindingStatusBadge status={finding.status} />
    </div>
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
    <EntityHeader
      eyebrow="Asset"
      title={asset.hostname}
      subtitle={`${prettyText(asset.type)} · ${asset.os ?? 'Unknown OS'} · ${siteName}`}
      sources={asset.sources}
    />

    <div class="mx-auto max-w-7xl space-y-6 p-6">
      <div class="flex flex-col gap-3 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {@render Stat('Status', prettyText(asset.status))}
          {@render Stat('Open findings', findings.length || asset.openFindingCount)}
          {@render Stat('Source records', vendorEvidence.length || asset.sources.length)}
          {@render Stat('Links', sourceLinks.length)}
        </div>
        <div class="flex flex-wrap gap-2">
          {#if asset.siteId}
            <a
              href={`/sites/${asset.siteId}`}
              class="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ExternalLink class="size-4" />
              Open site
            </a>
          {/if}
          <a
            href={`/findings?resourceType=asset&resourceId=${asset.id}`}
            class="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <ExternalLink class="size-4" />
            View findings
          </a>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="space-y-6">
          <section class="overflow-hidden rounded-md border bg-background">
            <div class="border-b px-4 py-3">
              <h2 class="text-sm font-semibold">Vendor source records</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                Confirmed vendor rows that reconcile into this canonical asset.
              </p>
            </div>
            {#each vendorEvidence as source}
              {@render SourceRow(source)}
            {:else}
              <div class="px-4 py-8 text-sm text-muted-foreground">
                No confirmed vendor source records are linked to this asset.
              </div>
            {/each}
          </section>

          <section class="overflow-hidden rounded-md border bg-background">
            <div class="border-b px-4 py-3">
              <h2 class="text-sm font-semibold">Open findings</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                Current policy failures scoped directly to this asset.
              </p>
            </div>
            {#each findings as finding}
              {@render FindingRow(finding)}
            {:else}
              <div class="px-4 py-8 text-sm text-muted-foreground">
                No open findings are currently tied to this asset.
              </div>
            {/each}
          </section>
        </div>

        <aside class="space-y-6">
          <section class="rounded-md border bg-background">
            <div class="border-b px-4 py-3">
              <h2 class="text-sm font-semibold">Asset facts</h2>
            </div>
            <dl class="grid gap-4 p-4">
              {@render Detail('Display name', asset.displayName)}
              {@render Detail('Hostname', asset.hostname)}
              {@render Detail('Serial number', assetExtra.serialNumber)}
              {@render Detail('Type', prettyText(asset.type))}
              {@render Detail('Operating system', asset.os)}
              {@render Detail(
                'Source confidence',
                assetExtra.sourceConfidence ? prettyText(assetExtra.sourceConfidence) : null
              )}
              {@render Detail('Updated', relativeOrNull(assetExtra.updatedAt))}
            </dl>
          </section>

          <section class="overflow-hidden rounded-md border bg-background">
            <div class="border-b px-4 py-3">
              <h2 class="text-sm font-semibold">Site and links</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                Where this asset belongs and which integration links supplied it.
              </p>
            </div>
            {#if asset.siteId}
              <a
                href={`/sites/${asset.siteId}`}
                class="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm transition-colors hover:bg-accent/40"
              >
                <span class="min-w-0 truncate font-medium">{siteName}</span>
                <span class="text-xs text-muted-foreground">Site</span>
              </a>
            {/if}
            {#each sourceLinks as link}
              {@render LinkRow(link)}
            {:else}
              <div class="px-4 py-6 text-sm text-muted-foreground">
                No integration links are attached to the source records.
              </div>
            {/each}
          </section>
        </aside>
      </div>
    </div>
  </FadeIn>
{:else}
  <Loader />
{/if}
