<script lang="ts">
  import SourceGlyph from './source-glyph.svelte';
  import type { SiteProfileResponse } from '../_profile/client-profile.types';

  let {
    siteId,
    siteName,
    description,
    profile,
  }: {
    siteId: string;
    siteName: string;
    description?: string | null;
    profile: SiteProfileResponse;
  } = $props();

  const siteCode = $derived(siteId.replace(/-/g, '').slice(0, 4).toUpperCase());

  const RIBBON_KEYS = [
    'people',
    'workstations',
    'servers',
    'networkAssets',
    'totalAssets',
    'openFindings',
    'connectedIntegrations',
  ] as const;

  const RIBBON_LABELS: Record<(typeof RIBBON_KEYS)[number], string> = {
    people: 'PEOPLE',
    workstations: 'WORKSTATIONS',
    servers: 'SERVERS',
    networkAssets: 'NET-DEVICES',
    totalAssets: 'ASSETS',
    openFindings: 'FINDINGS',
    connectedIntegrations: 'INTEGRATIONS',
  };

  const ribbon = $derived.by(() => {
    const byKey = new Map(profile.metrics.map((m) => [m.key, m]));
    return RIBBON_KEYS.map((key) => ({
      key,
      label: RIBBON_LABELS[key],
      metric: byKey.get(key),
    })).filter((s) => s.metric && s.metric.supported);
  });

  const factPills = $derived.by(() => {
    const want = ['status', 'support_tier', 'industry', 'criticality'];
    const byKey = new Map(profile.facts.map((f) => [f.key, f]));
    return want
      .map((k) => byKey.get(k))
      .filter(
        (f): f is NonNullable<typeof f> =>
          !!f &&
          f.applicable === 'applies' &&
          f.value !== null &&
          f.value !== '' &&
          (!Array.isArray(f.value) || f.value.length > 0)
      );
  });

  function labelForValue(value: string) {
    const special: Record<string, string> = {
      critical: 'Critical',
      mission_critical: 'Critical',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      active: 'Active',
      prospect: 'Prospect',
      former: 'Former',
      internal: 'Internal',
      standard: 'Standard',
      premium: 'Premium',
      enterprise: 'Enterprise',
    };
    return (
      special[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    );
  }

  function factPillValue(value: string | number | boolean | string[] | null) {
    if (Array.isArray(value)) return value.map(labelForValue).join(', ');
    return labelForValue(String(value));
  }
</script>

<header class="border-b border-foreground/15 bg-card">
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

  {#if factPills.length}
    <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-6 pb-2 font-mono text-[10.5px]">
      {#each factPills as fact (fact.key)}
        <span
          class="inline-flex items-center gap-1.5 rounded-[3px] border border-foreground/15 bg-foreground/4 px-1.5 py-px tracking-[0.14em] text-foreground/90"
        >
          <SourceGlyph source={fact.source} />{factPillValue(fact.value)}
        </span>
      {/each}
    </div>
  {/if}

  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border/70 bg-muted/30 px-6 py-2.5 font-mono text-[12px] text-foreground"
  >
    {#each ribbon as stat (stat.key)}
      <span class="flex items-baseline gap-1.5">
        <SourceGlyph source={stat.metric!.source} class="self-center" />
        <span class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          >{stat.label}</span
        >
        <span class="font-semibold tabular-nums">
          {typeof stat.metric!.value === 'number'
            ? stat.metric!.value.toLocaleString()
            : (stat.metric!.value ?? '—')}
        </span>
      </span>
    {/each}
  </div>
</header>
