<script lang="ts">
  import SourceGlyph from './source-glyph.svelte';
  import SiteActionsMenu from './site-actions-menu.svelte';
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

  const RIBBON_KEYS = [
    'workstations',
    'servers',
    'networkAssets',
    'totalAssets',
    'openFindings',
    'connectedIntegrations',
  ] as const;

  const RIBBON_LABELS: Record<(typeof RIBBON_KEYS)[number], string> = {
    workstations: 'Workstations',
    servers: 'Servers',
    networkAssets: 'Network devices',
    totalAssets: 'Assets',
    openFindings: 'Open findings',
    connectedIntegrations: 'Integrations',
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

<header class="sw-briefing">
  <a class="sw-back" href="/sites">← All sites</a>
  <div class="sw-site-heading">
    <div>
      <h1>{siteName}</h1>
      {#if description}<p class="sw-description">{description}</p>{/if}
    </div>
    <SiteActionsMenu {siteId} {siteName} />
  </div>
  {#if factPills.length}
    <div class="sw-facts">
      {#each factPills as fact (fact.key)}<span
          ><SourceGlyph source={fact.source} />{factPillValue(fact.value)}</span
        >{/each}
    </div>
  {/if}
  <div class="sw-site-metrics">
    {#each ribbon as stat (stat.key)}
      {@const href =
        stat.key === 'openFindings'
          ? `/sites/${siteId}/findings`
          : stat.key === 'networkAssets'
            ? `/sites/${siteId}/network`
            : stat.key === 'connectedIntegrations'
              ? null
              : `/sites/${siteId}/assets`}
      {#snippet metric()}
        <span>{stat.label}</span><strong
          >{typeof stat.metric!.value === 'number'
            ? stat.metric!.value.toLocaleString()
            : (stat.metric!.value ?? '—')}</strong
        >
      {/snippet}
      {#if href}<a {href}>{@render metric()}<span aria-hidden="true">↗</span></a>{:else}<div>
          {@render metric()}
        </div>{/if}
    {/each}
  </div>
</header>
