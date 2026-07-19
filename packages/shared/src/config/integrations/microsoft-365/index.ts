import type { Integration } from '../../../types/integration.js';
import { ProviderFacet } from '../../../types/provider.js';
import { SyncIntervals } from '../intervals.js';
import { passthroughLinkMetaSchema } from '../link-meta-passthrough.js';
import { M365PoliciesShape } from './policies.js';

const M365_LINK_META_VERSION = 1;
import {
  M365DevicesShape,
  M365GroupsShape,
  M365IdentitiesShape,
  M365LicensesShape
} from './shapes.js';

export const CONSENT_VERSION = 4;

export const REQUIRED_DIRECTORY_ROLES: Record<string, string> = {
  'Exchange Administrator': '29232cdf-9323-42fd-ade2-1d097af3e4de',
  'Teams Administrator': '69091246-20e8-4a56-aa4d-066075b2a7a8'
};

export const MS_GRAPH_CAPABILITIES = {
  signInActivity: 'signInActivity',
  conditionalAccess: 'conditionalAccess',
  identityProtection: 'identityProtection'
} as const;
export type MSGraphCapabilities =
  (typeof MS_GRAPH_CAPABILITIES)[keyof typeof MS_GRAPH_CAPABILITIES];

export const CAPABILITY_PLANS: Record<MSGraphCapabilities, string[]> = {
  signInActivity: ['AAD_PREMIUM', 'AAD_PREMIUM_P2'],
  conditionalAccess: ['AAD_PREMIUM', 'AAD_PREMIUM_P2'],
  identityProtection: ['AAD_PREMIUM_P2']
};

export const M365_BLOAT_LICENSES = [
  'MCOPSTNC',
  'POWER_BI_STANDARD',
  'WINDOWS_STORE',
  'RIGHTSMANAGEMENT_ADHOC',
  'FLOW_FREE',
  'DYN365_ENTERPRISE_P1_IW',
  'POWERAPPS_VIRAL'
];

export const M365_INTEGRATION_CONFIG: Integration = {
  id: 'microsoft-365',
  name: 'Microsoft 365',
  category: 'security',
  scope: 'link',
  supportedFacets: [
    {
      facet: ProviderFacet.M365Identities,
      scopeLevel: 'link',
      db: { table: 'm365Identities', name: 'M365 Identities', shape: M365IdentitiesShape },
      sync: {
        supportsIncremental: true,
        incrementalIntervalMs: SyncIntervals['1_HOURS'],
        fullIntervalMs: SyncIntervals['24_HOURS'],
        dependencies: [ProviderFacet.M365CAPolicies, ProviderFacet.M365Groups]
      }
    },
    {
      facet: ProviderFacet.M365Groups,
      scopeLevel: 'link',
      db: { table: 'm365Groups', name: 'M365 Groups', shape: M365GroupsShape },
      sync: {
        intervalMs: SyncIntervals['8_HOURS']
      }
    },
    {
      facet: ProviderFacet.M365Licenses,
      scopeLevel: 'link',
      db: { table: 'm365Licenses', name: 'M365 Licenses', shape: M365LicensesShape },
      sync: {
        intervalMs: SyncIntervals['24_HOURS']
      }
    },
    {
      facet: ProviderFacet.M365CAPolicies,
      scopeLevel: 'link',
      db: {
        table: 'm365Policies',
        name: 'M365 CA Policies',
        shape: M365PoliciesShape
      },
      sync: {
        intervalMs: SyncIntervals['24_HOURS'],
        dependencies: [ProviderFacet.M365Identities, ProviderFacet.M365Groups]
      }
    },
    {
      facet: ProviderFacet.M365ExchangeConfig,
      scopeLevel: 'link',
      db: { table: 'm365ExchangeConfigs', name: 'M365 Exchange', shape: {} },
      sync: { intervalMs: SyncIntervals['24_HOURS'] }
    },
    {
      facet: ProviderFacet.M365Devices,
      scopeLevel: 'link',
      db: { table: 'm365Devices', name: 'M365 Devices', shape: M365DevicesShape },
      sync: { intervalMs: SyncIntervals['24_HOURS'] }
    },
    {
      facet: ProviderFacet.M365OAuthGrants,
      scopeLevel: 'link',
      db: { table: 'm365OAuthGrants', name: 'M365 OAuth Grants', shape: {} },
      sync: { intervalMs: SyncIntervals['24_HOURS'] }
    },
    {
      facet: ProviderFacet.M365DomainConfig,
      scopeLevel: 'link',
      db: { table: 'm365DomainConfig', name: 'M365 Domains', shape: {} },
      sync: { intervalMs: SyncIntervals['24_HOURS'] }
    },
    {
      facet: ProviderFacet.M365TeamsConfig,
      scopeLevel: 'link',
      db: { table: 'm365TeamsConfig', name: 'M365 Teams', shape: {} },
      sync: { intervalMs: SyncIntervals['24_HOURS'] }
    },
    {
      facet: ProviderFacet.M365RiskyUsers,
      scopeLevel: 'link',
      db: { table: 'm365RiskyUsers', name: 'M365 Risky Users', shape: {} },
      sync: { intervalMs: SyncIntervals['2_HOURS'] }
    },
    {
      facet: ProviderFacet.M365MailboxForwarding,
      scopeLevel: 'link',
      db: {
        table: 'm365MailboxForwarding',
        name: 'M365 Mailbox Forwarding',
        shape: {}
      },
      sync: { intervalMs: SyncIntervals['8_HOURS'] }
    },
    {
      facet: ProviderFacet.M365InboxRules,
      scopeLevel: 'link',
      db: { table: 'm365InboxRules', name: 'M365 Inbox Rules', shape: {} },
      sync: { intervalMs: SyncIntervals['12_HOURS'] }
    }
  ],
  navigation: [
    { label: 'Identities', route: '/identities', isNullable: false },
    { label: 'Groups', route: '/groups', isNullable: false },
    { label: 'Devices', route: '/devices', isNullable: false },
    { label: 'Licenses', route: '/licenses', isNullable: false },
    { label: 'Roles', route: '/roles', isNullable: true },
    { label: 'Policies', route: '/policies', isNullable: false },
    { label: 'OAuth Grants', route: '/oauth-grants', isNullable: false },
    { label: 'Domain Security', route: '/domain-security', isNullable: false },
    { label: 'Teams', route: '/teams', isNullable: false },
    { label: 'Exchange', route: '/exchange', isNullable: false },
    { label: 'Security', route: '/security', isNullable: false },
    { label: 'Compliance', route: '/compliance', isNullable: false }
  ],
  linkMetaSchema: passthroughLinkMetaSchema,
  linkMetaVersion: M365_LINK_META_VERSION
};
