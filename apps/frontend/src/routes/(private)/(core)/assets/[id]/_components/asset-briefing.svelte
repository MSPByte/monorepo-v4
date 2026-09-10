<script lang="ts">
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Monitor from '@lucide/svelte/icons/monitor';
  import { Button } from '$lib/components/ui/button';

  let {
    hostname,
    displayName,
    type,
    os,
    status,
    siteId,
    siteName,
    updatedAt,
    openFindingCount,
    sourceCount,
    linkCount,
  }: {
    hostname: string;
    displayName?: string | null;
    type: string;
    os?: string | null;
    status: string;
    siteId?: string | null;
    siteName: string;
    updatedAt?: string | null;
    openFindingCount: number;
    sourceCount: number;
    linkCount: number;
  } = $props();

  const assetName = $derived(hostname.trim() || displayName?.trim() || 'Unnamed asset');
  const alternateName = $derived(
    displayName?.trim() && displayName.trim().toLowerCase() !== assetName.toLowerCase()
      ? displayName.trim()
      : null
  );
</script>

<a href="/assets" class="aw-back"><ArrowLeft class="size-3.5" /> All assets</a>
<header class="aw-heading aw-asset-heading">
  <div class="flex min-w-0 items-center gap-3">
    <span class="aw-asset-icon"><Monitor class="size-6" /></span>
    <div class="min-w-0">
      <h1>{assetName}</h1>
      {#if alternateName}<p class="aw-subtitle">{alternateName}</p>{/if}
      <div class="aw-identity">
        <span class="aw-status" class:is-active={status === 'active'}>{prettyText(status)}</span>
        <span>{prettyText(type)}</span>
        {#if os}<span>{os}</span>{/if}
        {#if siteId}<a href={`/sites/${siteId}`}>{siteName}</a>{:else}<span>No site assigned</span
          >{/if}
      </div>
    </div>
  </div>
  <Button href="#asset-findings" variant={openFindingCount ? 'default' : 'outline'}
    >Review findings <span class="tabular-nums">{openFindingCount}</span></Button
  >
</header>
<div class="aw-overview aw-detail-overview">
  <a href="#asset-findings"
    ><span>Open findings</span><strong>{openFindingCount.toLocaleString()}</strong><small
      >{openFindingCount ? 'Review issues by severity' : 'No open issues reported'}</small
    ></a
  >
  <a href="#asset-sources"
    ><span>Source records</span><strong>{sourceCount.toLocaleString()}</strong><small
      >Review matches and evidence</small
    ></a
  >
  <a href="#asset-integrations"
    ><span>Integrations</span><strong>{linkCount.toLocaleString()}</strong><small
      >Connections linked to this asset</small
    ></a
  >
  <div class="aw-coverage">
    <span>Last updated</span><strong class="aw-date"
      >{updatedAt ? formatRelativeDate(updatedAt) : 'Not available'}</strong
    ><small>Latest inventory update</small>
  </div>
</div>
