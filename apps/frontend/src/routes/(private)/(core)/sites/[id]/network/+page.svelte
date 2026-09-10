<script lang="ts">
  import SectionPanel from '../../_components/site-panel.svelte';
  import SourceGlyph from '../_components/source-glyph.svelte';
  import { useSiteContext } from '../_components/site-context';
  import { formatRelativeDate } from '$lib/utils/format';

  const ctx = useSiteContext();
  const profile = $derived(ctx.profile!);

  const assets = $derived(profile.network.assets);
  const firewalls = $derived(profile.network.firewalls);
</script>

<div class="sw-page">
  <div class="sw-section-heading">
    <div>
      <h2>Network</h2>
      <p>Review linked firewalls and discovered network devices.</p>
    </div>
  </div>
  <SectionPanel title="Firewalls">
    {#snippet aside()}
      {firewalls.length} linked
    {/snippet}
    {#if firewalls.length}
      <div class="grid gap-3 xl:grid-cols-2">
        {#each firewalls as fw (fw.id)}
          <div class="rounded-xl border border-border bg-background p-5">
            <div class="mb-2 flex items-baseline justify-between gap-2">
              <div class="flex items-baseline gap-2">
                <SourceGlyph source="generated" />
                <span class="truncate text-sm font-semibold">{fw.name}</span>
              </div>
              <span
                class={`font-mono text-[10px] uppercase tracking-wider ${
                  fw.connected ? 'text-primary' : 'text-destructive'
                }`}
              >
                {fw.connected ? 'connected' : 'offline'}
                {#if fw.suspended}· suspended{/if}
              </span>
            </div>
            <dl class="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Hostname
              </dt>
              <dd class="truncate font-mono">{fw.hostname}</dd>
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Model
              </dt>
              <dd class="truncate">{fw.model}</dd>
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Serial
              </dt>
              <dd class="truncate font-mono">{fw.serialNumber}</dd>
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Firmware
              </dt>
              <dd class="truncate font-mono">
                {fw.firmwareVersion}
                {#if fw.upgradeToVersion}
                  <span class="text-warning/90">→ {fw.upgradeToVersion}</span>
                {/if}
              </dd>
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                External IP
              </dt>
              <dd class="truncate font-mono">{fw.externalIp}</dd>
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Managing
              </dt>
              <dd class="truncate">{fw.managing}</dd>
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Reporting
              </dt>
              <dd class="truncate">{fw.reporting}</dd>
              <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Last Seen
              </dt>
              <dd class="font-mono text-muted-foreground">
                {formatRelativeDate(fw.lastSeenAt)}
              </dd>
            </dl>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-xs leading-relaxed text-muted-foreground">
        No firewalls linked. Firewall details appear here when your integrations sync data for this
        site.
      </p>
    {/if}
  </SectionPanel>

  <SectionPanel title="Network assets">
    {#snippet aside()}
      {assets.length} discovered
    {/snippet}
    {#if assets.length}
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr
              class="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              <th class="py-1.5 pr-3">Name</th>
              <th class="py-1.5 pr-3">Hostname</th>
              <th class="py-1.5 pr-3">Status</th>
              <th class="py-1.5">Sources</th>
            </tr>
          </thead>
          <tbody>
            {#each assets as asset (asset.id)}
              <tr class="border-b border-border/40 last:border-b-0">
                <td class="py-1.5 pr-3">
                  <span class="flex items-center gap-2">
                    <SourceGlyph source="generated" />
                    <a class="sw-site-link" href={`/assets/${asset.id}`}>{asset.displayName}</a>
                  </span>
                </td>
                <td class="py-1.5 pr-3 font-mono text-[12px] text-muted-foreground">
                  {asset.hostname ?? '—'}
                </td>
                <td class="py-1.5 pr-3 font-mono text-[11px] uppercase tracking-wider">
                  {asset.status}
                </td>
                <td class="py-1.5 font-mono text-[11px] text-muted-foreground">
                  {asset.sources.length ? asset.sources.join(', ') : '—'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="text-xs leading-relaxed text-muted-foreground">
        No network devices linked. Devices appear here once they are discovered and assigned to this
        site.
      </p>
    {/if}
  </SectionPanel>
</div>
