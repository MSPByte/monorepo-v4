<script lang="ts">
  import { formatRelativeDate } from '$lib/utils/format';
  import SourceGlyph from './source-glyph.svelte';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import type { ClientProfile } from '../_profile/client-profile.types';

  let {
    siteId,
    siteName,
    description,
    profile,
  }: {
    siteId: string;
    siteName: string;
    description?: string | null;
    profile: ClientProfile;
  } = $props();

  // Stable 4-char site code from the UUID so techs can refer to clients
  // by callsign in chat. Not random; deterministic per site.
  const siteCode = $derived(siteId.replace(/-/g, '').slice(0, 4).toUpperCase());

  let question = $state('');
  let asking = $state(false);

  function ask(e: Event) {
    e.preventDefault();
    if (!question.trim()) return;
    asking = true;
    // TODO: wire to AI endpoint when available
    setTimeout(() => {
      asking = false;
      question = '';
    }, 600);
  }

  const tierLabel = $derived(profile.supportTier.value.toUpperCase());
  const statusLabel = $derived(profile.status.value.toUpperCase());
  const criticalityLabel = $derived(profile.criticality.value.replace('_', '-').toUpperCase());
</script>

<header class="border-b border-foreground/15 bg-card">
  <!-- Identity row -->
  <div class="flex flex-wrap items-end justify-between gap-3 px-6 pb-2 pt-4">
    <div class="flex items-baseline gap-3">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold leading-tight tracking-tight">{siteName}</h1>
        {#if description}
          <p class="mt-0.5 max-w-3xl truncate text-xs text-muted-foreground">{description}</p>
        {/if}
      </div>
      <span
        class="rounded-[3px] border border-foreground/30 bg-foreground/4 px-1.5 py-px font-mono text-[11px] font-semibold tracking-[0.18em] text-foreground"
        title="Site callsign — first 4 chars of UUID"
      >
        SITE·{siteCode}
      </span>
    </div>
  </div>

  <!-- Categorical pills -->
  <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-6 pb-2 font-mono text-[10.5px]">
    {#each [{ label: statusLabel }, { label: tierLabel }, { label: profile.industry.value.toUpperCase() }, { label: criticalityLabel, accent: true }] as pill (pill.label)}
      <span
        class={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px tracking-[0.14em] ${
          pill.accent
            ? 'border-destructive/40 bg-destructive/6 text-destructive'
            : 'border-foreground/15 bg-foreground/4 text-foreground/90'
        }`}
      >
        <SourceGlyph source="user_options" />{pill.label}
      </span>
    {/each}
    <span class="ml-2 truncate text-xs text-muted-foreground"
      >{profile.primaryLocation.value} · {profile.timeZone.value}</span
    >
  </div>

  <!-- Metric ribbon -->
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 bg-muted/30 px-6 py-2.5 font-mono text-[12px] text-foreground"
  >
    {#each [{ label: 'USERS', field: profile.managedUsers }, { label: 'ENDPOINTS', field: profile.managedEndpoints }, { label: 'SERVERS', field: profile.managedServers }, { label: 'NET-DEVICES', field: profile.managedNetworkDevices }, { label: 'SITES', field: profile.numberOfLocations }, { label: 'ALERTS', field: profile.metrics.activeAlerts }, { label: 'INTEGRATIONS', field: profile.meta.connectedIntegrations }] as stat (stat.label)}
      <span class="flex items-baseline gap-1.5">
        <SourceGlyph source={stat.field.source} class="self-center" />
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          >{stat.label}</span
        >
        <span class="font-semibold tabular-nums">{stat.field.value.toLocaleString()}</span>
      </span>
    {/each}
  </div>

  <!-- AI summary + ask input -->
  <!-- <div class="grid gap-3 border-t border-border/70 px-6 py-3 lg:grid-cols-[1fr_360px]">
    <div class="flex gap-3">
      <Sparkles class="mt-0.5 size-3.5 shrink-0 text-primary" />
      <div class="min-w-0 space-y-1">
        <div
          class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
        >
          <span class="font-semibold text-foreground/80">AI BRIEF</span>
          <span>·</span>
          <span>{profile.aiSummary.origin ?? 'AI'}</span>
          {#if profile.aiSummary.updatedAt}
            <span>·</span>
            <span>refreshed {formatRelativeDate(profile.aiSummary.updatedAt)}</span>
          {/if}
        </div>
        <p class="text-[13px] leading-snug text-foreground/95">
          {profile.aiSummary.value}
        </p>
      </div>
    </div>

    <form
      onsubmit={ask}
      class="flex h-fit items-center gap-2 self-start rounded-md border border-primary/30 bg-primary/4 px-2.5 py-1.5 transition-colors focus-within:border-primary/60 focus-within:bg-primary/[0.07]"
    >
      <Sparkles class="size-3.5 shrink-0 text-primary" />
      <input
        bind:value={question}
        type="text"
        placeholder="Ask about this site…"
        disabled={asking}
        class="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={asking || !question.trim()}
        class="inline-flex shrink-0 items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        aria-label="Ask"
      >
        <CornerDownLeft class="size-3" />
      </button>
    </form>
  </div> -->
</header>
