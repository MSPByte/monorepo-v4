import { ProviderFacet, PROVIDER_IDS } from '../../types/provider.js';
import type { ProviderId } from '../../types/provider.js';

export type BillingFilterKind = 'string' | 'boolean' | 'null' | 'enum';

export type BillingFilterColumn = {
  column: string;
  label: string;
  kind: BillingFilterKind;
  options?: Array<{ value: string; label: string }>;
};

export type BillingVendorFilter = {
  column: string;
  operator: 'eq' | 'neq' | 'is_null' | 'is_not_null';
  value?: string | boolean;
};

export type BillingFacetConfig = {
  facet: ProviderFacet;
  providerId: ProviderId;
  label: string;
  filterColumns: BillingFilterColumn[];
  defaultFilters?: BillingVendorFilter[];
};

export const BILLING_FACETS: Partial<Record<ProviderFacet, BillingFacetConfig>> = {
  [ProviderFacet.SophosEndpoints]: {
    facet: ProviderFacet.SophosEndpoints,
    providerId: PROVIDER_IDS.SOPHOS,
    label: 'Sophos Endpoints',
    filterColumns: [
      {
        column: 'type',
        label: 'Endpoint type',
        kind: 'enum',
        options: [
          { value: 'computer', label: 'computer' },
          { value: 'server', label: 'server' }
        ]
      },
      { column: 'hasMdr', label: 'Has MDR', kind: 'boolean' },
      { column: 'online', label: 'Online', kind: 'boolean' },
      { column: 'needsUpgrade', label: 'Needs upgrade', kind: 'boolean' },
      {
        column: 'tamperProtectionEnabled',
        label: 'Tamper protection',
        kind: 'boolean'
      },
      {
        column: 'health',
        label: 'Health',
        kind: 'enum',
        options: [
          { value: 'good', label: 'good' },
          { value: 'suspicious', label: 'suspicious' },
          { value: 'bad', label: 'bad' },
          { value: 'unknown', label: 'unknown' }
        ]
      }
    ]
  },
  [ProviderFacet.SophosFirewalls]: {
    facet: ProviderFacet.SophosFirewalls,
    providerId: PROVIDER_IDS.SOPHOS,
    label: 'Sophos Firewalls',
    filterColumns: [
      { column: 'connected', label: 'Connected', kind: 'boolean' },
      { column: 'suspended', label: 'Suspended', kind: 'boolean' },
      { column: 'model', label: 'Model', kind: 'string' }
    ]
  },
  [ProviderFacet.SophosLicenses]: {
    facet: ProviderFacet.SophosLicenses,
    providerId: PROVIDER_IDS.SOPHOS,
    label: 'Sophos Licenses',
    filterColumns: [
      { column: 'code', label: 'License code', kind: 'string' },
      { column: 'type', label: 'License type', kind: 'string' },
      { column: 'perpetual', label: 'Perpetual', kind: 'boolean' },
      { column: 'unlimited', label: 'Unlimited', kind: 'boolean' }
    ]
  },
  [ProviderFacet.DattoEndpoints]: {
    facet: ProviderFacet.DattoEndpoints,
    providerId: PROVIDER_IDS.DATTO,
    label: 'Datto Endpoints',
    filterColumns: [
      {
        column: 'category',
        label: 'Category',
        kind: 'enum',
        options: [
          { value: 'workstation', label: 'workstation' },
          { value: 'server', label: 'server' },
          { value: 'other', label: 'other' }
        ]
      },
      { column: 'online', label: 'Online', kind: 'boolean' },
      { column: 'os', label: 'OS', kind: 'string' }
    ]
  },
  [ProviderFacet.CoveEndpoints]: {
    facet: ProviderFacet.CoveEndpoints,
    providerId: PROVIDER_IDS.COVE,
    label: 'Cove Endpoints',
    filterColumns: [
      {
        column: 'type',
        label: 'Type',
        kind: 'enum',
        options: [
          { value: 'workstation', label: 'workstation' },
          { value: 'server', label: 'server' }
        ]
      },
      {
        column: 'status',
        label: 'Status',
        kind: 'enum',
        options: [
          { value: 'active', label: 'active' },
          { value: 'inactive', label: 'inactive' },
          { value: 'error', label: 'error' }
        ]
      },
      { column: 'profile', label: 'Profile', kind: 'string' }
    ]
  },
  [ProviderFacet.M365Identities]: {
    facet: ProviderFacet.M365Identities,
    providerId: PROVIDER_IDS.M365,
    label: 'M365 Identities',
    filterColumns: [
      {
        column: 'type',
        label: 'Identity type',
        kind: 'enum',
        options: [
          { value: 'member', label: 'member' },
          { value: 'guest', label: 'guest' },
          { value: 'service', label: 'service' }
        ]
      },
      { column: 'enabled', label: 'Enabled', kind: 'boolean' },
      { column: 'mfaEnforced', label: 'MFA enforced', kind: 'boolean' }
    ],
    defaultFilters: [
      { column: 'enabled', operator: 'eq', value: 'true' },
      { column: 'type', operator: 'eq', value: 'member' }
    ]
  },
  [ProviderFacet.M365Licenses]: {
    facet: ProviderFacet.M365Licenses,
    providerId: PROVIDER_IDS.M365,
    label: 'M365 Licenses',
    filterColumns: [
      { column: 'enabled', label: 'Enabled', kind: 'boolean' },
      { column: 'skuPartNumber', label: 'SKU part number', kind: 'string' },
      { column: 'friendlyName', label: 'Friendly name', kind: 'string' }
    ]
  },
  [ProviderFacet.M365Devices]: {
    facet: ProviderFacet.M365Devices,
    providerId: PROVIDER_IDS.M365,
    label: 'M365 Devices',
    filterColumns: [
      { column: 'isCompliant', label: 'Compliant', kind: 'boolean' },
      { column: 'isManaged', label: 'Managed', kind: 'boolean' },
      {
        column: 'deviceOwnership',
        label: 'Ownership',
        kind: 'string'
      },
      { column: 'operatingSystem', label: 'Operating system', kind: 'string' }
    ]
  }
};

export function getBillingFacet(facet: string): BillingFacetConfig | null {
  return BILLING_FACETS[facet as ProviderFacet] ?? null;
}

export function listBillingFacets(): BillingFacetConfig[] {
  return Object.values(BILLING_FACETS).filter((config): config is BillingFacetConfig =>
    Boolean(config)
  );
}

export function listBillingFacetsByProvider(providerId: ProviderId): BillingFacetConfig[] {
  return listBillingFacets().filter((config) => config.providerId === providerId);
}

export const BILLING_PROVIDER_IDS: ProviderId[] = Array.from(
  new Set(listBillingFacets().map((f) => f.providerId))
);
