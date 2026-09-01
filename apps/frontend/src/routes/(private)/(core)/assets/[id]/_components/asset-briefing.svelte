<script lang="ts">
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import BriefingHeader from '$lib/components/domain/briefing-header.svelte';

  type Props = {
    id: string;
    hostname: string;
    displayName: string | null | undefined;
    type: string;
    os: string | null | undefined;
    status: string;
    siteId: string | null | undefined;
    siteName: string;
    serialNumber: string | null | undefined;
    sourceConfidence: string | null | undefined;
    updatedAt: string | null | undefined;
    openFindingCount: number;
    sourceCount: number;
    linkCount: number;
  };
  let {
    id,
    hostname,
    displayName,
    type,
    os,
    status,
    siteId,
    siteName,
    serialNumber,
    sourceConfidence,
    updatedAt,
    openFindingCount,
    sourceCount,
    linkCount,
  }: Props = $props();

  const statusLabel = $derived(status ? status.replace('_', '-').toUpperCase() : 'UNKNOWN');
  const statusAccent = $derived(status === 'inactive' || status === 'disabled' || status === 'error');
  const findingsAccent = $derived(openFindingCount > 0);

  const pillBase = 'inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px tracking-[0.14em]';
  const pillMuted = `${pillBase} border-foreground/15 bg-foreground/4 text-foreground/90`;
</script>

<BriefingHeader
  entityType="ASSET"
  title={hostname}
  subtitle={displayName && displayName !== hostname ? displayName : null}
  breadcrumb={prettyText(type)}
>
  {#snippet pills()}
    <span
      class="{pillBase} {statusAccent
        ? 'border-destructive/40 bg-destructive/6 text-destructive'
        : 'border-foreground/15 bg-foreground/4 text-foreground/90'}"
    >
      STATUS·{statusLabel}
    </span>
    <span class={pillMuted}>TYPE·{type.toUpperCase()}</span>
    {#if os}
      <span class={pillMuted}>OS·{os.toUpperCase()}</span>
    {/if}
    {#if sourceConfidence}
      <span class={pillMuted}>CONF·{sourceConfidence.toUpperCase()}</span>
    {/if}
    {#if siteName}
      <span class="ml-2 truncate text-xs text-muted-foreground">
        {#if siteId}
          <a href={`/sites/${siteId}`} class="hover:underline">{siteName}</a>
        {:else}
          {siteName}
        {/if}
      </span>
    {/if}
  {/snippet}

  {#snippet ribbon()}
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">FINDINGS</span>
      <span class="font-semibold tabular-nums {findingsAccent ? 'text-destructive' : ''}">
        {openFindingCount.toLocaleString()}
      </span>
    </span>
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">SOURCES</span>
      <span class="font-semibold tabular-nums">{sourceCount.toLocaleString()}</span>
    </span>
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">LINKS</span>
      <span class="font-semibold tabular-nums">{linkCount.toLocaleString()}</span>
    </span>
    {#if serialNumber}
      <span class="flex items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">SERIAL</span>
        <span class="max-w-[220px] truncate font-semibold tabular-nums">{serialNumber}</span>
      </span>
    {/if}
    {#if updatedAt}
      <span class="flex items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">UPDATED</span>
        <span class="font-semibold tabular-nums">{formatRelativeDate(updatedAt)}</span>
      </span>
    {/if}
  {/snippet}
</BriefingHeader>
