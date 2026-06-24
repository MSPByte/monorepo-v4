<script lang="ts">
  import Callsign from '$lib/components/panel/callsign.svelte';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';

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
</script>

<header class="border-b border-foreground/15 bg-card">
  <!-- Identity row -->
  <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-4">
    <div class="flex items-baseline gap-3">
      <div class="min-w-0">
        <div class="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span class="font-semibold text-foreground/80">ASSET</span>
          <span class="text-foreground/40">·</span>
          <span class="truncate">{prettyText(type)}</span>
        </div>
        <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">{hostname}</h1>
        {#if displayName && displayName !== hostname}
          <p class="mt-0.5 max-w-3xl truncate text-xs text-muted-foreground">{displayName}</p>
        {/if}
      </div>
      <Callsign prefix="ASSET" {id} title="Asset callsign — first 4 chars of ID" />
    </div>
  </div>

  <!-- Categorical pills -->
  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-6 pb-2 font-mono text-[10.5px]">
    <span
      class={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px tracking-[0.14em] ${
        statusAccent
          ? 'border-destructive/40 bg-destructive/6 text-destructive'
          : 'border-foreground/15 bg-foreground/4 text-foreground/90'
      }`}
    >
      STATUS·{statusLabel}
    </span>
    <span class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90">
      TYPE·{type.toUpperCase()}
    </span>
    {#if os}
      <span class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90">
        OS·{os.toUpperCase()}
      </span>
    {/if}
    {#if sourceConfidence}
      <span class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90">
        CONF·{sourceConfidence.toUpperCase()}
      </span>
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
  </div>

  <!-- Metric ribbon -->
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 bg-muted/30 px-6 py-2.5 font-mono text-[12px] text-foreground"
  >
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">FINDINGS</span>
      <span class={`font-semibold tabular-nums ${findingsAccent ? 'text-destructive' : ''}`}>
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
  </div>
</header>
