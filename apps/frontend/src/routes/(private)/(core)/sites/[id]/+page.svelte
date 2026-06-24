<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';

  import SectionPanel from './_components/section-panel.svelte';
  import FieldRow from './_components/field-row.svelte';
  import FlagPill from './_components/flag-pill.svelte';
  import HealthMeter from './_components/health-meter.svelte';
  import TribalNote from './_components/tribal-note.svelte';
  import ContactRow from './_components/contact-row.svelte';
  import Legend from './_components/legend.svelte';
  import SourceGlyph from './_components/source-glyph.svelte';
  import { useSiteContext } from './_components/site-context';
  import { formatRelativeDate } from '$lib/utils/format';

  import Plus from '@lucide/svelte/icons/plus';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

  const ctx = useSiteContext();
  const profile = $derived(ctx.profile!);
  const site = $derived(ctx.site!);

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', { siteId: site?.id }],
    queryFn: () => trpc.integrationLinks.list.query({ siteId: site!.id }),
    enabled: !!site?.id,
  }));

  const parentQuery = createQuery(() => ({
    queryKey: ['sites.byId', site?.parentSiteId],
    queryFn: () => trpc.sites.byId.query({ id: site!.parentSiteId! }),
    enabled: !!site?.parentSiteId,
  }));

  function providerName(id: string) {
    return INTEGRATIONS[id as ProviderId]?.name ?? id;
  }
</script>

<div class="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
  <!-- Top legend strip -->
  <div class="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-card px-3 py-2">
    <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      CLIENT INTELLIGENCE PROFILE
      <span class="ml-2 text-foreground/70">·</span>
      <span class="ml-2">documentation {profile.documentationCompleteness.value}% complete</span>
    </div>
    <Legend />
  </div>

  <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
    <!-- LEFT COLUMN -->
    <div class="space-y-4">
      <SectionPanel code="01" title="EXECUTIVE">
        <dl>
          <FieldRow label="Legal Name" field={profile.legalName} />
          <FieldRow label="Status" field={profile.status} format={(v) => v.replace('_', ' ').toUpperCase()} />
          <FieldRow label="Support Tier" field={profile.supportTier} format={(v) => v.toUpperCase()} />
          <FieldRow label="Industry" field={profile.industry} />
          <FieldRow label="Description" field={profile.businessDescription} />
          <FieldRow label="Criticality" field={profile.criticality} format={(v) => v.replace('_', '-').toUpperCase()} />
          <FieldRow label="Support Hours" field={profile.supportHours} />
          <FieldRow label="Time Zone" field={profile.timeZone} />
          <FieldRow label="HQ Location" field={profile.primaryLocation} />
          <FieldRow label="Locations" field={profile.numberOfLocations} />
          <FieldRow label="Employees" field={profile.employeeCount} />
          <FieldRow label="Primary Domain" field={profile.primaryDomain} />
          <FieldRow label="M365 Tenant" field={profile.microsoftTenant} />
        </dl>
      </SectionPanel>

      <SectionPanel code="02" title="TECHNOLOGY STACK">
        <dl>
          <FieldRow label="PSA" field={profile.stack.psa} />
          <FieldRow label="RMM" field={profile.stack.rmm} />
          <FieldRow label="Identity" field={profile.stack.identityProvider} />
          <FieldRow label="Email" field={profile.stack.emailPlatform} />
          <FieldRow label="EDR" field={profile.stack.edrPlatform} />
          <FieldRow label="Backup" field={profile.stack.backupPlatform} />
          <FieldRow label="Firewall" field={profile.stack.firewallVendor} />
          <FieldRow label="DNS" field={profile.stack.dnsProvider} />
          <FieldRow label="Password Mgr" field={profile.stack.passwordManager} />
          <FieldRow label="Remote Access" field={profile.stack.remoteAccess} />
          <FieldRow label="VoIP" field={profile.stack.voipProvider} />
          <FieldRow label="Cloud" field={profile.stack.cloudProvider} />
          <FieldRow label="Primary ISP" field={profile.stack.primaryIsp} />
          <FieldRow label="Secondary ISP" field={profile.stack.secondaryIsp} />
        </dl>
      </SectionPanel>

      <SectionPanel code="03" title="INFRASTRUCTURE METRICS">
        {#snippet aside()}
          live · {formatRelativeDate(profile.lastDataSync.value)}
        {/snippet}
        <div class="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          <dl>
            <FieldRow label="Windows" field={profile.metrics.windowsEndpoints} />
            <FieldRow label="macOS" field={profile.metrics.macEndpoints} />
            <FieldRow label="Linux" field={profile.metrics.linuxEndpoints} />
            <FieldRow label="Mobile" field={profile.metrics.mobileDevices} />
            <FieldRow label="Physical Srv" field={profile.metrics.physicalServers} />
            <FieldRow label="Virtual Srv" field={profile.metrics.virtualServers} />
            <FieldRow label="Azure VMs" field={profile.metrics.azureVms} />
          </dl>
          <dl>
            <FieldRow label="Hypervisors" field={profile.metrics.hypervisors} />
            <FieldRow label="Active Alerts" field={profile.metrics.activeAlerts} />
            <FieldRow label="Failed Backups" field={profile.metrics.failedBackups} />
            <FieldRow label="Offline Devices" field={profile.metrics.offlineDevices} />
            <FieldRow label="Disk Warnings" field={profile.metrics.diskWarnings} />
            <FieldRow label="Expiring Certs" field={profile.metrics.expiringCertificates} />
            <FieldRow label="Expiring Domains" field={profile.metrics.expiringDomains} />
          </dl>
        </div>
      </SectionPanel>

      <SectionPanel code="04" title="BUSINESS CONTEXT">
        <dl>
          <FieldRow label="Line of Business" field={profile.business.lineOfBusiness} />
          <FieldRow label="Compliance" field={profile.business.complianceFramework} />
          <FieldRow label="Cyber Insurance" field={profile.business.cyberInsurance} format={(v) => v.toUpperCase()} />
          <FieldRow label="Revenue Band" field={profile.business.revenueBand} />
          <FieldRow label="Business Size" field={profile.business.businessSize} />
          <FieldRow label="After-Hours" field={profile.business.afterHoursSupport} format={(v) => v.replace('_', ' ').toUpperCase()} />
          <FieldRow label="Change Approval" field={profile.business.changeApprovalRequired} format={(v) => v.replace('_', ' ').toUpperCase()} />
          <FieldRow label="Freeze Windows" field={profile.business.changeFreezeWindows} />
        </dl>
      </SectionPanel>
    </div>

    <!-- RIGHT COLUMN -->
    <aside class="space-y-4">
      <SectionPanel code="H" title="HEALTH">
        <div class="space-y-4">
          <HealthMeter
            label="Environment Health"
            score={profile.healthScore.value}
            detail={profile.healthScore.origin}
          />
          <HealthMeter
            label="Documentation"
            score={profile.documentationCompleteness.value}
            detail="MSP-Byte completeness score"
          />
        </div>
      </SectionPanel>

      <SectionPanel code="!" title="SPECIAL HANDLING">
        <div class="space-y-2">
          {#each profile.flags as flag}
            <FlagPill {flag} />
          {/each}
        </div>
      </SectionPanel>

      <SectionPanel code="~" title="TRIBAL KNOWLEDGE">
        {#snippet aside()}
          <button class="inline-flex items-center gap-1 hover:text-foreground">
            <Plus class="size-3" /> note
          </button>
        {/snippet}
        <div class="space-y-2">
          {#each profile.tribal as note}
            <TribalNote {note} />
          {/each}
        </div>
      </SectionPanel>

      <SectionPanel code="@" title="KEY CONTACTS">
        <dl>
          {#each profile.contacts as contact}
            <ContactRow {contact} />
          {/each}
        </dl>
      </SectionPanel>

      <SectionPanel code="↳" title="HIERARCHY">
        <div class="space-y-2 text-sm">
          {#if site.parentSiteId}
            <div class="flex items-center gap-2 border-b border-border/40 pb-2">
              <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">PARENT</span>
              <a
                href={`/sites/${site.parentSiteId}`}
                class="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {parentQuery.data?.name ?? 'Loading…'}
                <ArrowUpRight class="size-3" />
              </a>
            </div>
          {:else}
            <div class="flex items-center justify-between">
              <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">PARENT</span>
              <span class="font-mono text-xs text-muted-foreground/60">— top-level —</span>
            </div>
          {/if}
          <div class="flex items-baseline justify-between">
            <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">SITE GROUPS</span>
            <span class="font-mono text-xs text-muted-foreground/60">— none yet —</span>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel code="≡" title="INTEGRATIONS">
        {#snippet aside()}
          {site.sources.length} active
        {/snippet}
        <div class="space-y-1">
          {#if linksQuery.data && linksQuery.data.length}
            {#each linksQuery.data as link}
              <div class="flex items-baseline justify-between gap-2 border-b border-border/40 py-1.5 text-sm last:border-b-0">
                <div class="flex min-w-0 items-baseline gap-2">
                  <span
                    class={`size-1.5 shrink-0 translate-y-px rounded-full ${
                      link.status === 'active' ? 'bg-primary' : link.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground'
                    }`}
                  ></span>
                  <span class="truncate">{link.name ?? providerName(link.integrationId)}</span>
                </div>
                <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {providerName(link.integrationId)}
                </span>
              </div>
            {/each}
          {:else if site.sources.length}
            {#each site.sources as src}
              <div class="flex items-center justify-between border-b border-border/40 py-1.5 text-sm last:border-b-0">
                <span class="flex items-center gap-2">
                  <SourceGlyph source="generated" />
                  {providerName(src)}
                </span>
                <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">active</span>
              </div>
            {/each}
          {:else}
            <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">no integrations linked</p>
          {/if}

          {#if profile.meta.missingIntegrations.value.length}
            <div class="mt-3 border-t border-dashed border-border pt-2">
              <div class="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-warning">
                <SourceGlyph source="generated" /> recommended · missing
              </div>
              <div class="flex flex-wrap gap-1">
                {#each profile.meta.missingIntegrations.value as name}
                  <span class="inline-flex items-center rounded-[3px] border border-dashed border-warning/40 px-1.5 py-px font-mono text-[10.5px] text-warning/90">
                    {name}
                  </span>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </SectionPanel>

      <SectionPanel code="$" title="OPERATIONAL METADATA">
        <dl>
          <FieldRow label="Onboarded" field={{ value: formatRelativeDate(profile.meta.firstOnboarded.value), source: 'generated', origin: profile.meta.firstOnboarded.origin }} />
          <FieldRow label="Last Reviewed" field={{ value: formatRelativeDate(profile.meta.lastReviewed.value), source: 'generated', origin: profile.meta.lastReviewed.origin }} />
          <FieldRow label="Manual Update" field={{ value: formatRelativeDate(profile.meta.lastManualUpdate.value), source: 'generated', origin: profile.meta.lastManualUpdate.origin }} />
          <FieldRow label="AI Refresh" field={{ value: formatRelativeDate(profile.meta.aiSummaryRefreshedAt.value), source: 'generated', origin: profile.meta.aiSummaryRefreshedAt.origin }} />
        </dl>
      </SectionPanel>
    </aside>
  </div>
</div>
