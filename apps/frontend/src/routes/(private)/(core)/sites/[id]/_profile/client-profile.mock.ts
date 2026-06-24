import type { ClientProfile, Field, FieldSource } from './client-profile.types';

function g<T>(value: T, origin: string, updatedAt?: string): Field<T> {
  return { value, source: 'generated', origin, updatedAt };
}
function opt<T extends string | number>(value: T): Field<T> {
  return { value, source: 'user_options' };
}
function free<T>(value: T): Field<T> {
  return { value, source: 'user_free' };
}

const nowIso = new Date().toISOString();
const dayAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

type Counts = {
  assetCount: number;
  peopleCount: number;
  sources: string[];
};

/**
 * Builds a Client Intelligence Profile by hydrating mock fields with real
 * counts where we have them. When the backend lands, swap this for a real
 * query; the consuming UI doesn't need to change.
 */
export function buildClientProfile(
  site: { id: string; name: string; description: string | null; createdAt: string },
  counts: Counts
): ClientProfile {
  const endpoints = Math.max(0, counts.assetCount - 8); // pretend 8 are servers
  const servers = Math.min(8, counts.assetCount);
  const sources = counts.sources ?? [];
  const hasM365 = sources.includes('microsoft-365');
  const hasNinja = sources.some((s) => s.includes('ninja') || s.includes('rmm'));
  const hasSophos = sources.includes('sophos-partner');
  const hasCove = sources.includes('cove');

  return {
    legalName: free(`${site.name}, Inc.`),
    status: opt('active'),
    supportTier: opt('premium'),
    industry: opt('Manufacturing'),
    businessDescription: free(
      site.description ?? 'Multi-site manufacturing operation with on-prem ERP and cloud productivity.'
    ),
    timeZone: opt('America/Chicago'),
    primaryLocation: free('Cedar Rapids, IA'),
    numberOfLocations: g(3, 'sites table'),
    employeeCount: free(84),
    managedUsers: g(counts.peopleCount, hasM365 ? 'Microsoft Entra ID' : 'IdP', nowIso),
    managedEndpoints: g(endpoints, hasNinja ? 'NinjaRMM' : 'RMM', nowIso),
    managedServers: g(servers, hasNinja ? 'NinjaRMM' : 'RMM', nowIso),
    managedNetworkDevices: g(4, 'Fortinet FortiManager', dayAgo(1)),
    primaryDomain: g(hasM365 ? `${slug(site.name)}.com` : null, 'Microsoft 365', nowIso),
    microsoftTenant: g(hasM365 ? `${slug(site.name)}.onmicrosoft.com` : null, 'Microsoft 365', nowIso),
    supportHours: opt('Business hours · 06:00–20:00 CST'),
    criticality: opt('high'),
    lastDataSync: g(nowIso, 'pipeline'),
    documentationCompleteness: g(72, 'computed', nowIso),
    healthScore: g(91, 'computed', nowIso),
    aiSummary: g(
      `${site.name} is a multi-site manufacturing client with ${counts.peopleCount} managed users and ` +
        `${counts.assetCount} endpoints. The environment runs ${hasM365 ? 'Microsoft 365 with Entra ID' : 'an on-prem identity stack'}, ` +
        `${hasSophos ? 'Sophos endpoint protection' : 'an EDR product pending integration'}, and ${hasCove ? 'Cove backups (healthy)' : 'a backup vendor not yet linked'}. ` +
        `MFA coverage is strong, no critical alerts are open. Production reboots must be avoided during business hours; firewall ` +
        `changes require third-party approval.`,
      'Claude Sonnet · daily refresh',
      dayAgo(1)
    ),

    stack: {
      psa: free('HaloPSA'),
      rmm: g(hasNinja ? 'NinjaRMM' : 'NinjaRMM (mocked)', 'integration links'),
      identityProvider: g(hasM365 ? 'Microsoft Entra ID' : 'Active Directory', 'integration links'),
      emailPlatform: g(hasM365 ? 'Microsoft 365 (Exchange)' : 'Google Workspace', 'integration links'),
      backupPlatform: g(hasCove ? 'N-able Cove' : 'Veeam (mocked)', 'integration links'),
      edrPlatform: g(hasSophos ? 'Sophos Intercept X' : 'Huntress (mocked)', 'integration links'),
      firewallVendor: free('Fortinet'),
      dnsProvider: free('Cloudflare'),
      passwordManager: free('1Password Business'),
      remoteAccess: free('Fortinet SSL-VPN + Entra SSO'),
      voipProvider: free('RingCentral'),
      cloudProvider: free('Azure (primary)'),
      primaryIsp: free('AT&T Fiber · 1G'),
      secondaryIsp: free('Spectrum · 500/35 LTE failover'),
    },

    metrics: {
      windowsEndpoints: g(Math.floor(endpoints * 0.86), 'RMM'),
      macEndpoints: g(Math.floor(endpoints * 0.08), 'RMM'),
      linuxEndpoints: g(Math.max(0, endpoints - Math.floor(endpoints * 0.86) - Math.floor(endpoints * 0.08)), 'RMM'),
      mobileDevices: g(12, 'Intune'),
      physicalServers: g(Math.max(1, Math.floor(servers * 0.4)), 'RMM'),
      virtualServers: g(Math.max(0, servers - Math.floor(servers * 0.4)), 'RMM'),
      azureVms: g(3, 'Azure'),
      hypervisors: g(2, 'RMM'),
      activeAlerts: g(0, 'policy engine'),
      failedBackups: g(hasCove ? 0 : 1, 'Cove'),
      offlineDevices: g(2, 'RMM'),
      diskWarnings: g(4, 'RMM'),
      expiringCertificates: g(1, 'cert monitor'),
      expiringDomains: g(0, 'DNS provider'),
    },

    business: {
      lineOfBusiness: opt('Manufacturing'),
      complianceFramework: opt('CMMC 2.0 · Level 1'),
      cyberInsurance: opt('yes'),
      revenueBand: opt('$25M–$100M'),
      businessSize: opt('Mid-market'),
      afterHoursSupport: opt('on_call'),
      changeApprovalRequired: opt('cab_only'),
      changeFreezeWindows: free('Last business day of each month · Accounting close'),
    },

    flags: [
      {
        label: 'Production freeze',
        description: 'No reboots on manufacturing PCs during shift hours (06:00–22:00).',
        source: 'user_options',
        severity: 'critical',
      },
      {
        label: 'CAB approval required',
        description: 'All firewall changes must be approved by the third-party network vendor.',
        source: 'user_options',
        severity: 'warn',
      },
      {
        label: 'Sensitive environment',
        description: 'ITAR-adjacent data on shared file server. Audit any access changes.',
        source: 'user_options',
        severity: 'warn',
      },
      {
        label: '24/7 operations',
        description: 'Plant runs three shifts. Out-of-hours work needs floor manager sign-off.',
        source: 'user_options',
        severity: 'info',
      },
    ],

    tribal: [
      {
        category: 'quirk',
        body: 'CEO travels weekly and routinely needs emergency MFA resets. Use the executive break-glass procedure, not standard reset.',
        author: 'D. Bates',
        recordedAt: dayAgo(13),
      },
      {
        category: 'maintenance',
        body: 'Legacy scanner on VLAN 40 requires SMBv1. Do not enable SMB hardening on FILE01 without scheduling a swap.',
        author: 'M. Park',
        recordedAt: dayAgo(42),
      },
      {
        category: 'procedure',
        body: 'Accounting closes books on the last day of each month. Avoid any reboots or pushes after 16:00 CST that day.',
        author: 'D. Bates',
        recordedAt: dayAgo(26),
      },
      {
        category: 'escalation',
        body: 'Domain registrar managed by the marketing agency (Bright River). Contact: hello@brightriver.co · 24h SLA.',
        author: 'D. Bates',
        recordedAt: dayAgo(60),
      },
    ],

    contacts: [
      {
        role: 'primary',
        name: free('Sarah Lin'),
        email: free('sarah.lin@example.com'),
        phone: free('+1 (319) 555-0142'),
      },
      {
        role: 'technical',
        name: free('Marcus Park'),
        email: free('marcus@example.com'),
      },
      {
        role: 'executive',
        name: free('David Bates · CEO'),
        email: free('dbates@example.com'),
      },
      {
        role: 'billing',
        name: free('Accounts Payable'),
        email: free('ap@example.com'),
      },
      {
        role: 'emergency',
        name: free('Sarah Lin (after-hours: 319-555-0188)'),
      },
      {
        role: 'third_party_it',
        name: free('Bright River — networking/DNS'),
        email: free('noc@brightriver.co'),
      },
    ],

    meta: {
      firstOnboarded: g(site.createdAt, 'sites table'),
      lastReviewed: g(dayAgo(8), 'audit log'),
      lastManualUpdate: g(dayAgo(2), 'audit log'),
      connectedIntegrations: g(sources.length, 'integration links'),
      missingIntegrations: g(
        ['HaloPSA', 'Cloudflare DNS', '1Password Business'].filter(Boolean),
        'gap analysis'
      ),
      aiSummaryRefreshedAt: g(dayAgo(1), 'Claude Sonnet'),
    },
  };
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
}

export type { FieldSource };
