import type { FieldType, SchemaFields } from '../types/schema-registry.js';
import { ProviderFacet } from '../types/provider.js';
import { getFacetShape, INTEGRATIONS } from './integrations/index.js';

/**
 * Declarative joins so Reports (and any other consumer of PolicyTableShapes)
 * can surface fields from related tables as if they were native columns —
 * without requiring per-source decorator functions. Joins are display-only in
 * v1: they appear in the columns picker and get hydrated at query time, but
 * cannot be used in the filter builder. Callers who need to filter by tenant,
 * license, etc. use the underlying source column (linkId, assignedLicenses).
 */
export type JoinBase = {
  /** Column key set on each output row. */
  key: string;
  label: string;
  type: FieldType;
  /** `array` for junction-style joins that yield multiple values per row. */
  modality: 'single' | 'array';
  description?: string;
};

/** Follow a scalar FK on the source row to a single value in another table. */
export type LinkScalarJoin = JoinBase & {
  kind: 'link_scalar';
  /** Column on the source row holding the foreign key. */
  via: string;
  /** Table registered in the reports join runner. */
  from: string;
  /** Column in `from` to match `via` against. */
  match: string;
  /** Column in `from` whose value is returned as the join result. */
  display: string;
};

/**
 * Follow a junction table (e.g. m365IdentityGroups) to collect display values
 * from a target table (e.g. m365Groups.name). Always yields an array.
 */
export type JunctionJoin = JoinBase & {
  kind: 'junction';
  modality: 'array';
  /** Column on the source row (typically `id`) to match against the junction. */
  localKey: string;
  through: string;
  throughLocal: string;
  throughRemote: string;
  from: string;
  match: string;
  display: string;
};

/**
 * Rewrite an array column of identifiers on the source row (e.g.
 * assignedLicenses = [externalId, …]) into an array of display values from a
 * reference table (e.g. m365Licenses.friendlyName).
 */
export type ArrayReferenceJoin = JoinBase & {
  kind: 'array_reference';
  modality: 'array';
  sourceColumn: string;
  from: string;
  match: string;
  display: string;
};

/**
 * Compute a display value from other columns on the same row without any
 * cross-table lookup. Used for post-hydrated booleans, string joins, etc.
 * The compute function runs after other joins so it can observe them.
 */
export type ComputedJoin = JoinBase & {
  kind: 'computed';
  compute: (row: Record<string, unknown>) => unknown;
};

export type JoinDefinition =
  | LinkScalarJoin
  | JunctionJoin
  | ArrayReferenceJoin
  | ComputedJoin;

export type PolicyTableShape = {
  table: string;
  label: string;
  resourceType: string;
  targetType: 'tenant' | 'site' | 'integration_link' | 'asset' | 'vendor';
  providerId?: string;
  facet?: ProviderFacet;
  /**
   * Where this table is browsable in the UI. `path` is the data-table route and
   * `searchField` is the column to filter on (operator `eq`) to isolate a single
   * record, e.g. when deep-linking to the row behind a finding.
   */
  route?: {
    path: string;
    searchField: string;
  };
  /**
   * How the Reports engine resolves this table's rows to a `site_id` for scope
   * filtering. `direct` = column on the base table (e.g. canonical.assets.site_id);
   * `link` = join through public.integration_links via `column` (the FK to
   * integration_links.id) and filter on integration_links.site_id. Omit for
   * tables that are not scope-filterable at the site level.
   */
  siteScope?: {
    via: 'direct' | 'link';
    column: string;
  };
  shape: SchemaFields;
  /**
   * Optional related-table fields the Reports runner hydrates into each row.
   * Display-only: not surfaced in the filter builder.
   */
  joins?: JoinDefinition[];
};

export type PolicyScopeTag = {
  label: string;
  ingestPath: string;
  group: string;
};

export const PolicyScopeTags: PolicyScopeTag[] = [
  {
    label: 'Integration link name',
    ingestPath: 'integrationLink.name',
    group: 'Integration link'
  },
  {
    label: 'Integration link external ID',
    ingestPath: 'integrationLink.externalId',
    group: 'Integration link'
  },
  { label: 'Site name', ingestPath: 'site.name', group: 'Site' }
];

const sourceOptions = Object.values(INTEGRATIONS).map((integration) => ({
  value: integration.id,
  label: integration.name
}));

export const CanonicalAssetsShape: SchemaFields = {
  hostname: {
    label: 'Hostname',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'hostname',
    required: true
  },
  displayName: {
    label: 'Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'displayName',
    required: false
  },
  type: {
    label: 'Asset Type',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'assetType',
    required: false,
    options: [
      { value: 'server', label: 'Server' },
      { value: 'workstation', label: 'Workstation' },
      { value: 'network', label: 'Network' },
      { value: 'mobile', label: 'Mobile' },
      { value: 'unknown', label: 'Unknown' }
    ]
  },
  status: {
    label: 'Status',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'status',
    required: false
  },
  sources: {
    label: 'Sources',
    type: 'string',
    modality: 'array',
    trackable: true,
    ingestPath: 'sources',
    required: false,
    options: sourceOptions
  },
  lastSeenAt: {
    label: 'Last Seen',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'lastSeenAt',
    required: false
  }
};

// -- Shared join fragments --------------------------------------------------
//
// Every vendor table on this platform has a `link_id` foreign key back to
// `public.integration_links`, so the "tenant name" (Microsoft 365 tenant,
// Sophos partner tenant, HaloPSA instance, etc.) is always derivable through
// the same scalar join. The same is true for the human-readable site name,
// which lives on `public.sites`. Centralising these fragments keeps every
// vendor shape from re-declaring the same lookup.

const tenantNameJoin: JoinDefinition = {
  kind: 'link_scalar',
  key: 'tenantName',
  label: 'Tenant',
  type: 'string',
  modality: 'single',
  via: 'linkId',
  from: 'integrationLinks',
  match: 'id',
  display: 'name',
  description: 'Name of the integration link this row was ingested from.'
};

const siteNameJoin: JoinDefinition = {
  kind: 'link_scalar',
  key: 'siteName',
  label: 'Site',
  type: 'string',
  modality: 'single',
  via: 'siteId',
  from: 'sites',
  match: 'id',
  display: 'name',
  description: 'Human-readable site this row is attributed to.'
};

const linkSiteJoins: JoinDefinition[] = [tenantNameJoin, siteNameJoin];

const identityGroupsJoin: JoinDefinition = {
  kind: 'junction',
  key: 'groupNames',
  label: 'Group memberships',
  type: 'string',
  modality: 'array',
  localKey: 'id',
  through: 'm365IdentityGroups',
  throughLocal: 'identityId',
  throughRemote: 'groupId',
  from: 'm365Groups',
  match: 'id',
  display: 'name',
  description: 'Every Entra ID group this identity is a member of.'
};

const identityPoliciesJoin: JoinDefinition = {
  kind: 'junction',
  key: 'assignedPolicyNames',
  label: 'Assigned CA policies',
  type: 'string',
  modality: 'array',
  localKey: 'id',
  through: 'm365PolicyIdentities',
  throughLocal: 'identityId',
  throughRemote: 'policyId',
  from: 'm365Policies',
  match: 'id',
  display: 'name',
  description: 'Conditional Access policies that name this identity directly.'
};

const groupPoliciesJoin: JoinDefinition = {
  kind: 'junction',
  key: 'assignedPolicyNames',
  label: 'Assigned CA policies',
  type: 'string',
  modality: 'array',
  localKey: 'id',
  through: 'm365PolicyGroups',
  throughLocal: 'groupId',
  throughRemote: 'policyId',
  from: 'm365Policies',
  match: 'id',
  display: 'name',
  description: 'Conditional Access policies scoped to this group.'
};

export const PolicyTableShapes: PolicyTableShape[] = [
  {
    table: 'assets',
    label: 'Assets',
    resourceType: 'asset',
    targetType: 'asset',
    siteScope: { via: 'direct', column: 'siteId' },
    shape: CanonicalAssetsShape,
    joins: [siteNameJoin]
  },
  {
    table: 'm365Identities',
    label: 'M365 Identities',
    resourceType: 'm365_identity',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365Identities,
    route: { path: '/microsoft-365/identities', searchField: 'externalId' },
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365Identities),
    joins: [...linkSiteJoins, identityGroupsJoin, identityPoliciesJoin]
  },
  {
    table: 'm365Groups',
    label: 'M365 Groups',
    resourceType: 'm365_group',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365Groups,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365Groups),
    joins: [...linkSiteJoins, groupPoliciesJoin]
  },
  {
    table: 'm365Licenses',
    label: 'M365 Licenses',
    resourceType: 'm365_license',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365Licenses,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365Licenses),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365Policies',
    label: 'M365 Conditional Access Policies',
    resourceType: 'm365_policy',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365CAPolicies,
    route: { path: '/microsoft-365/policies', searchField: 'externalId' },
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365CAPolicies),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365Devices',
    label: 'M365 Devices',
    resourceType: 'm365_device',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365Devices,
    route: { path: '/microsoft-365/devices', searchField: 'externalId' },
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365Devices),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365OAuthGrants',
    label: 'M365 OAuth Grants',
    resourceType: 'm365_oauth_grant',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365OAuthGrants,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365OAuthGrants),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365DomainConfig',
    label: 'M365 Domain Security',
    resourceType: 'm365_domain',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365DomainConfig,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365DomainConfig),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365TeamsConfig',
    label: 'M365 Teams Config',
    resourceType: 'm365_teams',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365TeamsConfig,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365TeamsConfig),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365ExchangeConfigs',
    label: 'M365 Exchange Config',
    resourceType: 'm365_exchange',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365ExchangeConfig,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365ExchangeConfig),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365RiskyUsers',
    label: 'M365 Risky Users',
    resourceType: 'm365_risky_user',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365RiskyUsers,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365RiskyUsers),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365MailboxForwarding',
    label: 'M365 Mailbox Forwarding',
    resourceType: 'm365_mailbox_forwarding',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365MailboxForwarding,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365MailboxForwarding),
    joins: [...linkSiteJoins]
  },
  {
    table: 'm365InboxRules',
    label: 'M365 Inbox Rules',
    resourceType: 'm365_inbox_rule',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    facet: ProviderFacet.M365InboxRules,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.M365InboxRules),
    joins: [...linkSiteJoins]
  },
  {
    table: 'sophosEndpoints',
    label: 'Sophos Endpoints',
    resourceType: 'sophos_endpoint',
    targetType: 'vendor',
    providerId: 'sophos-partner',
    facet: ProviderFacet.SophosEndpoints,
    route: { path: '/sophos-partner/endpoints', searchField: 'externalId' },
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.SophosEndpoints),
    joins: [...linkSiteJoins]
  },
  {
    table: 'sophosFirewalls',
    label: 'Sophos Firewalls',
    resourceType: 'sophos_firewall',
    targetType: 'vendor',
    providerId: 'sophos-partner',
    facet: ProviderFacet.SophosFirewalls,
    route: { path: '/sophos-partner/firewalls', searchField: 'externalId' },
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.SophosFirewalls),
    joins: [tenantNameJoin]
  },
  {
    table: 'sophosLicenses',
    label: 'Sophos Licenses',
    resourceType: 'sophos_license',
    targetType: 'vendor',
    providerId: 'sophos-partner',
    facet: ProviderFacet.SophosLicenses,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.SophosLicenses),
    joins: [...linkSiteJoins]
  },
  {
    table: 'sophosFirewallLicenses',
    label: 'Sophos Firewall Licenses',
    resourceType: 'sophos_firewall_license',
    targetType: 'vendor',
    providerId: 'sophos-partner',
    facet: ProviderFacet.SophosFirewallLicenses,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.SophosFirewallLicenses),
    joins: [...linkSiteJoins]
  },
  {
    table: 'dattoEndpoints',
    label: 'Datto RMM Endpoints',
    resourceType: 'datto_endpoint',
    targetType: 'vendor',
    providerId: 'dattormm',
    facet: ProviderFacet.DattoEndpoints,
    route: { path: '/dattormm/endpoints', searchField: 'externalId' },
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.DattoEndpoints),
    joins: [...linkSiteJoins]
  },
  {
    table: 'coveEndpoints',
    label: 'Cove Endpoints',
    resourceType: 'cove_endpoint',
    targetType: 'vendor',
    providerId: 'cove',
    facet: ProviderFacet.CoveEndpoints,
    route: { path: '/cove/endpoints', searchField: 'externalId' },
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.CoveEndpoints),
    joins: [...linkSiteJoins]
  },
  {
    table: 'haloPsaRecurringItems',
    label: 'HaloPSA Recurring Items',
    resourceType: 'halopsa_recurring_item',
    targetType: 'vendor',
    providerId: 'halopsa',
    facet: ProviderFacet.HaloPsaRecurringItems,
    siteScope: { via: 'link', column: 'linkId' },
    shape: getFacetShape(ProviderFacet.HaloPsaRecurringItems),
    joins: [...linkSiteJoins]
  }
];

/**
 * Resolve a PolicyTableShape from a table identifier in any common form:
 * camelCase ("m365Identities"), snake_case ("m365_identities"), or
 * schema-qualified ("vendors.m365_identities").
 */
export function getPolicyTableShape(table: string): PolicyTableShape | undefined {
  const base = (table.includes('.') ? table.split('.').pop()! : table).toLowerCase();
  return PolicyTableShapes.find((shape) => {
    const snake = shape.table.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return shape.table.toLowerCase() === base || snake.toLowerCase() === base;
  });
}
