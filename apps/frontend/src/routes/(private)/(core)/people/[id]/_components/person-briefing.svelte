<script lang="ts">
  import { formatRelativeDate, prettyText } from '$lib/utils/format';

  type Props = {
    id: string;
    displayName: string;
    primaryEmail: string;
    status: string;
    siteId: string | null | undefined;
    siteName: string;
    sourceConfidence: string | null | undefined;
    updatedAt: string | null | undefined;
    openFindingCount: number;
    sourceCount: number;
    linkCount: number;
    licenseCount: number;
  };
  let {
    displayName,
    primaryEmail,
    status,
    siteId,
    siteName,
    sourceConfidence,
    updatedAt,
    openFindingCount,
    sourceCount,
    linkCount,
    licenseCount,
  }: Props = $props();

  const statusLabel = $derived(status ? status.replace('_', '-').toUpperCase() : 'UNKNOWN');
  const statusAccent = $derived(
    status === 'inactive' || status === 'disabled' || status === 'error'
  );
  const findingsAccent = $derived(openFindingCount > 0);
</script>

<header class="border-b border-foreground/15 bg-card">
  <!-- Identity row -->
  <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-4">
    <div class="flex items-baseline gap-3">
      <div class="min-w-0">
        <div
          class="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          <span class="font-semibold text-foreground/80">PERSON</span>
          <span class="text-foreground/40">·</span>
          <span class="truncate">IDENTITY</span>
        </div>
        <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">{displayName}</h1>
        {#if primaryEmail}
          <p class="mt-0.5 max-w-3xl truncate font-mono text-xs text-muted-foreground">
            {primaryEmail}
          </p>
        {/if}
      </div>
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
    {#if sourceConfidence}
      <span
        class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
      >
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
    <span class="flex items-baseline gap-1.5">
      <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">LICENSES</span>
      <span class="font-semibold tabular-nums">{licenseCount.toLocaleString()}</span>
    </span>
    {#if updatedAt}
      <span class="flex items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">UPDATED</span>
        <span class="font-semibold tabular-nums">{formatRelativeDate(updatedAt)}</span>
      </span>
    {/if}
  </div>
</header>
