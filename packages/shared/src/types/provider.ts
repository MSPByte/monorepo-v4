import type { ZodSchema } from "zod";

export type AdapterContext = {
  linkMeta?: Record<string, unknown>;
  integrationConfig?: Record<string, unknown>;
  orgId?: string;
  tenantDb?: unknown;
};

export type FetchCursor = string | undefined | void;

export enum ProviderFacet {
  // Microsoft 365
  M365Identities = "m365_identities",
  M365Groups = "m365_groups",
  M365Licenses = "m365_licenses",
  M365CAPolicies = "m365_ca_policies",
  M365AuthMethods = "m365_auth_methods",
  M365Devices = "m365_devices",
  M365OAuthGrants = "m365_oauth_grants",
  M365DomainConfig = "m365_domain_config",
  M365TeamsConfig = "m365_teams_config",
  M365RiskyUsers = "m365_risky_users",
  M365MailboxForwarding = "m365_mailbox_forwarding",
  M365InboxRules = "m365_inbox_rules",
  M365ExchangeConfig = "m365_exchange_config",
  // Sophos Partner
  SophosEndpoints = "sophos_endpoints",
  SophosFirewalls = "sophos_firewalls",
  SophosLicenses = "sophos_licenses",
  SophosTamperProtection = "sophos_tamper_protection",
  // Datto RMM
  DattoEndpoints = "datto_endpoints",
  // Cove
  CoveEndpoints = "cove_endpoints",
}

export interface ProviderAdapter<TRaw = unknown, TNormalized = unknown> {
  readonly providerId: string;
  readonly facets: ProviderFacet[];
  getAuthHeaders(
    linkId: string,
    ctx?: AdapterContext,
  ): Promise<Record<string, string>>;
  fetchFacet(
    linkId: string,
    facet: ProviderFacet,
    cursor?: string,
    ctx?: AdapterContext,
  ): AsyncGenerator<TRaw[], FetchCursor>;
  normalize(raw: TRaw, facet: ProviderFacet): TNormalized;
  rawSchema: ZodSchema<TRaw>;
}

export const PROVIDER_IDS = {
  M365: "microsoft-365",
  SOPHOS: "sophos-partner",
  DATTO: "dattormm",
  COVE: "cove",
  MSPAGENT: "mspagent",
  HALOPSA: "halopsa",
} as const;

export type ProviderId = (typeof PROVIDER_IDS)[keyof typeof PROVIDER_IDS];

export const PROVIDER_FACETS: Record<string, ProviderFacet[]> = {
  [PROVIDER_IDS.M365]: [
    ProviderFacet.M365Identities,
    ProviderFacet.M365Groups,
    ProviderFacet.M365Licenses,
    ProviderFacet.M365CAPolicies,
    ProviderFacet.M365AuthMethods,
    ProviderFacet.M365Devices,
    ProviderFacet.M365OAuthGrants,
    ProviderFacet.M365RiskyUsers,
    ProviderFacet.M365ExchangeConfig,
    ProviderFacet.M365DomainConfig,
    ProviderFacet.M365TeamsConfig,
    ProviderFacet.M365MailboxForwarding,
    ProviderFacet.M365InboxRules,
  ],
  [PROVIDER_IDS.SOPHOS]: [
    ProviderFacet.SophosEndpoints,
    ProviderFacet.SophosFirewalls,
    ProviderFacet.SophosLicenses,
    ProviderFacet.SophosTamperProtection,
  ],
  [PROVIDER_IDS.DATTO]: [ProviderFacet.DattoEndpoints],
  [PROVIDER_IDS.COVE]: [ProviderFacet.CoveEndpoints],
};

export const MAX_CONSECUTIVE_FAILURES = 10;
export const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STALE_RUN_THRESHOLD_MS = 4 * 60 * 60 * 1000;

// Maps facet → drizzle vendorTableRegistry key — used in normalize.worker
export const FACET_TABLE_MAP: Partial<Record<ProviderFacet, string>> = {
  [ProviderFacet.M365Identities]: "m365Identities",
  [ProviderFacet.M365Groups]: "m365Groups",
  [ProviderFacet.M365Licenses]: "m365Licenses",
  [ProviderFacet.M365CAPolicies]: "m365Policies",
  [ProviderFacet.M365AuthMethods]: "m365AuthMethods",
  [ProviderFacet.M365Devices]: "m365Devices",
  [ProviderFacet.M365OAuthGrants]: "m365OAuthGrants",
  [ProviderFacet.M365DomainConfig]: "m365DomainConfig",
  [ProviderFacet.M365TeamsConfig]: "m365TeamsConfig",
  [ProviderFacet.M365RiskyUsers]: "m365RiskyUsers",
  [ProviderFacet.M365MailboxForwarding]: "m365MailboxForwarding",
  [ProviderFacet.M365InboxRules]: "m365InboxRules",
  [ProviderFacet.M365ExchangeConfig]: "m365ExchangeConfigs",
  [ProviderFacet.SophosEndpoints]: "sophosEndpoints",
  [ProviderFacet.SophosFirewalls]: "sophosFirewalls",
  [ProviderFacet.SophosLicenses]: "sophosLicenses",
  [ProviderFacet.SophosTamperProtection]: "sophosTamperProtection",
  [ProviderFacet.DattoEndpoints]: "dattoEndpoints",
  [ProviderFacet.CoveEndpoints]: "coveEndpoints",
};
