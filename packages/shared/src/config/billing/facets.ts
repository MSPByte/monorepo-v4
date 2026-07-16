import type { FieldDefinition, SchemaFields } from '../../types/schema-registry.js';
import { ProviderFacet, PROVIDER_IDS } from '../../types/provider.js';
import type { ProviderId } from '../../types/provider.js';
import { getFacetRoute, getFacetShape } from '../integrations/index.js';

export type BillingFilterKind = 'string' | 'boolean' | 'null' | 'enum' | 'number';

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
  /**
   * Whitelist of field keys (from the facet's SchemaFields) that should be
   * filterable in the billing rule editor. When omitted, every single-modality
   * non-object field in the shape is exposed.
   */
  filterableFields?: string[];
  defaultFilters?: BillingVendorFilter[];
};

/**
 * Billing rules count rows in vendor tables and reconcile against PSA line
 * items. Each entry references a facet whose SchemaFields (declared in the
 * integration registry) is the single source of truth for the filter UI —
 * column names, labels, kinds, and enum options all come from there.
 */
export const BILLING_FACETS: Partial<Record<ProviderFacet, BillingFacetConfig>> = {
  [ProviderFacet.SophosEndpoints]: {
    facet: ProviderFacet.SophosEndpoints,
    providerId: PROVIDER_IDS.SOPHOS,
    filterableFields: [
      'type',
      'hasMdr',
      'online',
      'needsUpgrade',
      'tamperProtectionEnabled',
      'health'
    ]
  },
  [ProviderFacet.SophosFirewalls]: {
    facet: ProviderFacet.SophosFirewalls,
    providerId: PROVIDER_IDS.SOPHOS,
    filterableFields: ['connected', 'suspended', 'model']
  },
  [ProviderFacet.SophosLicenses]: {
    facet: ProviderFacet.SophosLicenses,
    providerId: PROVIDER_IDS.SOPHOS,
    filterableFields: ['code', 'type', 'perpetual', 'unlimited']
  },
  [ProviderFacet.DattoEndpoints]: {
    facet: ProviderFacet.DattoEndpoints,
    providerId: PROVIDER_IDS.DATTO,
    filterableFields: ['category', 'online', 'os']
  },
  [ProviderFacet.CoveEndpoints]: {
    facet: ProviderFacet.CoveEndpoints,
    providerId: PROVIDER_IDS.COVE,
    filterableFields: ['type', 'status', 'profile']
  },
  [ProviderFacet.M365Identities]: {
    facet: ProviderFacet.M365Identities,
    providerId: PROVIDER_IDS.M365,
    filterableFields: ['type', 'enabled', 'mfaEnforced'],
    defaultFilters: [
      { column: 'enabled', operator: 'eq', value: 'true' },
      { column: 'type', operator: 'eq', value: 'member' }
    ]
  },
  [ProviderFacet.M365Licenses]: {
    facet: ProviderFacet.M365Licenses,
    providerId: PROVIDER_IDS.M365,
    filterableFields: ['enabled', 'skuPartNumber', 'friendlyName']
  },
  [ProviderFacet.M365Devices]: {
    facet: ProviderFacet.M365Devices,
    providerId: PROVIDER_IDS.M365,
    filterableFields: ['isCompliant', 'isManaged', 'deviceOwnership', 'operatingSystem']
  }
};

/**
 * Map a FieldDefinition to the operator/value semantics used by the billing
 * rule editor. Array-modality and object-typed fields aren't supported.
 */
function fieldToFilterColumn(column: string, field: FieldDefinition): BillingFilterColumn | null {
  if (field.modality !== 'single') return null;
  if (field.type === 'object') return null;

  const options = field.options?.map((o) => ({ value: o.value, label: o.label }));

  const kind: BillingFilterKind =
    field.type === 'enum'
      ? 'enum'
      : field.type === 'boolean'
        ? 'boolean'
        : field.type === 'number'
          ? 'number'
          : 'string';

  return {
    column,
    label: field.label,
    kind,
    ...(options ? { options } : {})
  };
}

export function getBillingFilterColumns(facet: ProviderFacet): BillingFilterColumn[] {
  const config = BILLING_FACETS[facet];
  if (!config) return [];
  const shape: SchemaFields = getFacetShape(facet);
  const allowed = config.filterableFields;
  const keys = allowed ?? Object.keys(shape);
  return keys
    .map((key) => (shape[key] ? fieldToFilterColumn(key, shape[key]) : null))
    .filter((col): col is BillingFilterColumn => col != null);
}

export function getBillingFacetLabel(facet: ProviderFacet): string {
  return getFacetRoute(facet)?.name ?? String(facet);
}

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
