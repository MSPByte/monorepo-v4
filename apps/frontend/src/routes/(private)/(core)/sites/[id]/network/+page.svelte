<script lang="ts">
  import SectionPanel from '../_components/section-panel.svelte';
  import FieldRow from '../_components/field-row.svelte';
  import { useSiteContext } from '../_components/site-context';
  import type { Field } from '../_profile/client-profile.types';

  const ctx = useSiteContext();
  const site = $derived(ctx.site!);

  // Mock network data — replace with real source when network ingest exists.
  function g<T>(value: T, origin: string): Field<T> {
    return { value, source: 'generated', origin };
  }
  function free<T>(value: T): Field<T> {
    return { value, source: 'user_free' };
  }
  function opt<T extends string | number>(value: T): Field<T> {
    return { value, source: 'user_options' };
  }

  const locations = [
    {
      callsign: 'HQ',
      name: 'Headquarters · Cedar Rapids, IA',
      fields: {
        firewall: g('FortiGate 60F', 'Fortinet FortiManager'),
        firmware: g('7.2.10', 'Fortinet FortiManager'),
        wan: free('AT&T Fiber · 1 Gbps symmetric'),
        publicIp: g('45.32.190.211', 'Fortinet WAN1'),
        vpnPeers: g(3, 'IPsec gateway'),
        vlans: free('10 (corp) · 20 (voice) · 30 (guest) · 40 (legacy)'),
        subnets: free('10.10.0.0/22'),
        sdwan: opt('enabled'),
      },
    },
    {
      callsign: 'BR1',
      name: 'Branch · Dubuque, IA',
      fields: {
        firewall: free('Meraki MX68'),
        firmware: g('18.211.2', 'Meraki Dashboard'),
        wan: free('Mediacom Cable · 500/35'),
        publicIp: g('72.10.184.5', 'Meraki Dashboard'),
        vpnPeers: g(2, 'Meraki AutoVPN'),
        vlans: free('10 (corp) · 30 (guest)'),
        subnets: free('10.20.0.0/24'),
        sdwan: opt('enabled'),
      },
    },
    {
      callsign: 'BR2',
      name: 'Plant 2 · Davenport, IA',
      fields: {
        firewall: free('Meraki MX67'),
        firmware: g('18.211.2', 'Meraki Dashboard'),
        wan: free('Spectrum Business · 300/20 + LTE failover'),
        publicIp: g('98.166.43.12', 'Meraki Dashboard'),
        vpnPeers: g(2, 'Meraki AutoVPN'),
        vlans: free('10 (corp) · 50 (PLC) · 60 (cameras)'),
        subnets: free('10.30.0.0/24'),
        sdwan: opt('failover-only'),
      },
    },
  ];
</script>

<div class="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
  <!-- Topology diagram -->
  <SectionPanel code="N·0" title="TOPOLOGY">
    {#snippet aside()}
      mock · awaiting network ingest pipeline
    {/snippet}
    <pre class="overflow-x-auto whitespace-pre py-1 font-mono text-[12px] leading-relaxed text-foreground/85"
>{`        ┌──────────── INTERNET ────────────┐
        │                                  │
   AT&T Fiber                       Mediacom · Spectrum
        │                                  │
  ┌─────┴─────┐               ┌──────┬─────┴──────┐
  │ HQ · FW   │ ◄── IPsec ──► │ BR1  │   BR2      │
  │ FG-60F    │               │ MX68 │   MX67     │
  └─────┬─────┘               └───┬──┘─────┬──────┘
        │                         │        │
  ┌─────┴───── VLANs ──────┐  ┌───┴──┐ ┌───┴──── VLAN 50 ────┐
  │ 10 corp · 20 voice ·   │  │  10  │ │  PLCs · isolated     │
  │ 30 guest · 40 legacy   │  │  30  │ │  no internet egress  │
  └────────────────────────┘  └──────┘ └──────────────────────┘`}</pre>
  </SectionPanel>

  <div class="grid gap-4 xl:grid-cols-2">
    {#each locations as loc}
      <SectionPanel code={loc.callsign} title={loc.name}>
        <dl>
          <FieldRow label="Firewall" field={loc.fields.firewall} />
          <FieldRow label="Firmware" field={loc.fields.firmware} />
          <FieldRow label="WAN" field={loc.fields.wan} />
          <FieldRow label="Public IP" field={loc.fields.publicIp} />
          <FieldRow label="VPN Peers" field={loc.fields.vpnPeers} />
          <FieldRow label="VLANs" field={loc.fields.vlans} />
          <FieldRow label="Subnets" field={loc.fields.subnets} />
          <FieldRow label="SD-WAN" field={loc.fields.sdwan} />
        </dl>
      </SectionPanel>
    {/each}
  </div>

  <SectionPanel code="N·X" title="UNCLAIMED NETWORK DATA">
    {#snippet aside()}
      site {site.id.slice(0, 4).toUpperCase()}
    {/snippet}
    <p class="max-w-2xl text-sm leading-snug text-muted-foreground">
      A future Firewall/Switch integration will populate these fields automatically from
      Fortinet, Meraki, and Cisco APIs. Until then, edit free-form values inline and the
      glyph will switch from <span class="font-mono">▯</span> to <span class="font-mono text-primary">●</span> once a connector reports a matching value.
    </p>
  </SectionPanel>
</div>
