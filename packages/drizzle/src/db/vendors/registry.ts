import {
  m365Identities,
  m365Groups,
  m365Policies,
  m365Licenses,
  m365ExchangeConfigs,
  m365Devices,
  m365OAuthGrants,
  m365DomainConfig,
  m365TeamsConfig,
  m365RiskyUsers,
  m365MailboxForwarding,
  m365InboxRules,
  sophosEndpoints,
  sophosFirewalls,
  sophosLicenses,
  sophosTamperProtection,
  dattoEndpoints,
  coveEndpoints
} from './index.js';

// Vendor tables that use the (link_id, external_id) unique conflict target.
// Join tables (m365_identity_groups, m365_identity_roles, etc.) are managed
// directly by their respective adapters and are not in this registry.
export const vendorTableRegistry = {
  m365Identities: {
    table: m365Identities,
    conflictTarget: [m365Identities.linkId, m365Identities.externalId] as const
  },
  m365Groups: {
    table: m365Groups,
    conflictTarget: [m365Groups.linkId, m365Groups.externalId] as const
  },
  m365Policies: {
    table: m365Policies,
    conflictTarget: [m365Policies.linkId, m365Policies.externalId] as const
  },
  m365Licenses: {
    table: m365Licenses,
    conflictTarget: [m365Licenses.linkId, m365Licenses.externalId] as const
  },
  m365ExchangeConfigs: {
    table: m365ExchangeConfigs,
    conflictTarget: [m365ExchangeConfigs.linkId, m365ExchangeConfigs.externalId] as const
  },
  m365Devices: {
    table: m365Devices,
    conflictTarget: [m365Devices.linkId, m365Devices.externalId] as const
  },
  m365OAuthGrants: {
    table: m365OAuthGrants,
    conflictTarget: [m365OAuthGrants.linkId, m365OAuthGrants.externalId] as const
  },
  m365DomainConfig: {
    table: m365DomainConfig,
    conflictTarget: [m365DomainConfig.linkId, m365DomainConfig.externalId] as const
  },
  m365TeamsConfig: {
    table: m365TeamsConfig,
    conflictTarget: [m365TeamsConfig.linkId, m365TeamsConfig.externalId] as const
  },
  m365RiskyUsers: {
    table: m365RiskyUsers,
    conflictTarget: [m365RiskyUsers.linkId, m365RiskyUsers.externalId] as const
  },
  m365MailboxForwarding: {
    table: m365MailboxForwarding,
    conflictTarget: [m365MailboxForwarding.linkId, m365MailboxForwarding.externalId] as const
  },
  m365InboxRules: {
    table: m365InboxRules,
    conflictTarget: [m365InboxRules.linkId, m365InboxRules.externalId] as const
  },
  sophosEndpoints: {
    table: sophosEndpoints,
    conflictTarget: [sophosEndpoints.linkId, sophosEndpoints.externalId] as const
  },
  sophosFirewalls: {
    table: sophosFirewalls,
    conflictTarget: [sophosFirewalls.linkId, sophosFirewalls.externalId] as const
  },
  sophosLicenses: {
    table: sophosLicenses,
    conflictTarget: [sophosLicenses.linkId, sophosLicenses.externalId] as const
  },
  sophosTamperProtection: {
    table: sophosTamperProtection,
    conflictTarget: [sophosTamperProtection.endpointId] as const
  },
  dattoEndpoints: {
    table: dattoEndpoints,
    conflictTarget: [dattoEndpoints.linkId, dattoEndpoints.externalId] as const
  },
  coveEndpoints: {
    table: coveEndpoints,
    conflictTarget: [coveEndpoints.linkId, coveEndpoints.externalId] as const
  }
} as const;

export type VendorTableName = keyof typeof vendorTableRegistry;
