import type { SchemaFields } from '../types/schema-registry.js';
import { INTEGRATIONS } from './integrations/index.js';
import { M365PoliciesShape } from './integrations/microsoft-365/policies.js';

export type PolicyTableShape = {
  table: string;
  label: string;
  resourceType: string;
  targetType: 'tenant' | 'site' | 'integration_link' | 'person' | 'asset' | 'vendor';
  providerId?: string;
  canonicalResourceTypes?: ('person' | 'asset')[];
  /**
   * Where this table is browsable in the UI. `path` is the data-table route and
   * `searchField` is the column to filter on (operator `eq`) to isolate a single
   * record, e.g. when deep-linking to the row behind a finding.
   */
  route?: {
    path: string;
    searchField: string;
  };
  shape: SchemaFields;
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

export const CanonicalPeopleShape: SchemaFields = {
  displayName: {
    label: 'Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'displayName',
    required: true
  },
  email: {
    label: 'Email',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'email',
    required: false
  },
  enabled: {
    label: 'Status',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'status',
    required: false,
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'unknown', label: 'Unknown' }
    ]
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
  type: {
    label: 'Person Type',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'type',
    required: false
  },
  lastSignInAt: {
    label: 'Last Sign-In',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'lastSignInAt',
    required: false
  }
};

export const M365IdentitiesShape: SchemaFields = {
  displayName: {
    label: 'Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'displayName',
    required: true
  },
  email: {
    label: 'Email',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'email',
    required: false
  },
  enabled: {
    label: 'Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'enabled',
    required: false
  },
  mfaEnforced: {
    label: 'MFA Enforced',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'mfaEnforced',
    required: false
  },
  type: {
    label: 'User Type',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'type',
    required: false,
    options: [
      { value: 'Member', label: 'Member' },
      { value: 'Guest', label: 'Guest' }
    ]
  }
};

export const M365DevicesShape: SchemaFields = {
  displayName: {
    label: 'Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'displayName',
    required: true
  },
  enabled: {
    label: 'Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'enabled',
    required: false
  },
  compliant: {
    label: 'Compliant',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'compliant',
    required: false
  },
  operatingSystem: {
    label: 'Operating System',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'operatingSystem',
    required: false
  }
};

export const SophosPartnerEndpointShape: SchemaFields = {
  externalId: {
    label: 'External ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'externalId',
    required: true
  },
  hostname: {
    label: 'Hostname',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'hostname',
    required: false
  },
  lastHeartbeatAt: {
    label: 'Last Heartbeat',
    type: 'string',
    modality: 'single',
    trackable: true,
    required: false,
    ingestPath: 'lastHeartbeatAt'
  }
};

export const VendorAssetSourceShape: SchemaFields = {
  externalId: {
    label: 'External ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'externalId',
    required: true
  },
  hostname: {
    label: 'Hostname',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'hostname',
    required: false
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

export const PolicyTableShapes: PolicyTableShape[] = [
  {
    table: 'assets',
    label: 'Assets',
    resourceType: 'asset',
    targetType: 'asset',
    shape: CanonicalAssetsShape
  },
  {
    table: 'people',
    label: 'People',
    resourceType: 'person',
    targetType: 'person',
    shape: CanonicalPeopleShape
  },
  {
    table: 'm365Identities',
    label: 'M365 Identities',
    resourceType: 'm365_identity',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    canonicalResourceTypes: ['person'],
    route: { path: '/microsoft-365/identities', searchField: 'externalId' },
    shape: M365IdentitiesShape
  },
  {
    table: 'm365Policies',
    label: 'M365 Conditional Access Policies',
    resourceType: 'm365_policy',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    shape: M365PoliciesShape
  },
  {
    table: 'm365Devices',
    label: 'M365 Devices',
    resourceType: 'm365_device',
    targetType: 'vendor',
    providerId: 'microsoft-365',
    canonicalResourceTypes: ['asset'],
    route: { path: '/microsoft-365/devices', searchField: 'externalId' },
    shape: M365DevicesShape
  },
  {
    table: 'sophosEndpoints',
    label: 'Sophos Endpoints',
    resourceType: 'sophos_endpoint',
    targetType: 'vendor',
    providerId: 'sophos-partner',
    canonicalResourceTypes: ['asset'],
    route: { path: '/sophos-partner/endpoints', searchField: 'externalId' },
    shape: VendorAssetSourceShape
  },
  {
    table: 'sophosFirewalls',
    label: 'Sophos Firewalls',
    resourceType: 'sophos_firewall',
    targetType: 'vendor',
    providerId: 'sophos-partner',
    canonicalResourceTypes: ['asset'],
    route: { path: '/sophos-partner/firewalls', searchField: 'externalId' },
    shape: VendorAssetSourceShape
  },
  {
    table: 'dattoEndpoints',
    label: 'Datto RMM Endpoints',
    resourceType: 'datto_endpoint',
    targetType: 'vendor',
    providerId: 'dattormm',
    canonicalResourceTypes: ['asset'],
    route: { path: '/dattormm/endpoints', searchField: 'externalId' },
    shape: VendorAssetSourceShape
  },
  {
    table: 'coveEndpoints',
    label: 'Cove Endpoints',
    resourceType: 'cove_endpoint',
    targetType: 'vendor',
    providerId: 'cove',
    canonicalResourceTypes: ['asset'],
    route: { path: '/cove/endpoints', searchField: 'externalId' },
    shape: VendorAssetSourceShape
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
