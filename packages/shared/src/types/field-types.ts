/**
 * Canonical field vocabulary used across the product. A type captures both
 * representation and meaning: `timezone` is not merely a string, and a
 * `sophos_endpoint` is not merely a UUID. Packages are the first adopter;
 * facts and policy builders resolve through the same catalog below.
 */
export const FIELD_TYPES = {
  text: { label: 'Text', family: 'scalar' },
  boolean: { label: 'Boolean', family: 'scalar' },
  number: { label: 'Number', family: 'scalar' },
  text_list: { label: 'Text list', family: 'collection' },
  secret: { label: 'Secret text', family: 'scalar' },
  uuid: { label: 'UUID', family: 'semantic' },
  upn: { label: 'User principal name', family: 'semantic' },
  timezone: { label: 'Time zone', family: 'semantic' },
  postal_code: { label: 'Postal code', family: 'semantic' },
  city: { label: 'City', family: 'semantic' },
  country_code: { label: 'Country code', family: 'semantic' },
  region: { label: 'State / region', family: 'semantic' },
  site: { label: 'MSPByte site', family: 'resource' },
  integration_link: { label: 'Integration link', family: 'resource' },
  m365_identity: { label: 'Microsoft 365 identity', family: 'resource' },
  m365_identity_list: { label: 'Microsoft 365 identity list', family: 'resource' },
  m365_group: { label: 'Microsoft 365 group', family: 'resource' },
  m365_license: { label: 'Microsoft 365 license', family: 'resource' },
  m365_license_list: { label: 'Microsoft 365 license list', family: 'resource' },
  m365_role: { label: 'Microsoft 365 role', family: 'resource' },
  sophos_endpoint: { label: 'Sophos endpoint', family: 'resource' },
  halo_ticket: { label: 'HaloPSA ticket', family: 'resource' },
} as const;

export type FieldTypeId = keyof typeof FIELD_TYPES;

/**
 * The subset of platform types that can be stored as a site fact. This is the
 * single source of truth for field editors: it describes both the persisted
 * representation and the managed control a person interacts with. Technical
 * package-input hints such as UUID and UPN deliberately do not appear here.
 */
export const SITE_FACT_FIELD_TYPES = {
  text: {
    label: 'Text', description: 'Free-form text', family: 'MSPByte', type: 'string', valueMode: 'single',
  },
  number: {
    label: 'Number', description: 'A numeric value', family: 'MSPByte', type: 'number', valueMode: 'single',
  },
  boolean: {
    label: 'Yes / No', description: 'A true or false value', family: 'MSPByte', type: 'boolean', valueMode: 'single',
  },
  text_list: {
    label: 'Text list', description: 'One or more text values', family: 'MSPByte', type: 'string', valueMode: 'multiple',
  },
  secret: {
    label: 'Secret text', description: 'Sensitive free-form text', family: 'MSPByte', type: 'string', valueMode: 'single',
  },
  timezone: {
    label: 'Time zone', description: 'IANA time zone with UTC offset', family: 'MSPByte', type: 'string', valueMode: 'single',
  },
  postal_code: {
    label: 'Postal code', description: 'ZIP or postal code', family: 'MSPByte', type: 'string', valueMode: 'single',
  },
  city: {
    label: 'City', description: 'City or locality', family: 'MSPByte', type: 'string', valueMode: 'single',
  },
  country_code: {
    label: 'Country', description: 'ISO 3166-1 alpha-2 country code', family: 'MSPByte', type: 'string', valueMode: 'single',
  },
  region: {
    label: 'State / region', description: 'State, province, or region', family: 'MSPByte', type: 'string', valueMode: 'single',
  },
  m365_identity: {
    label: 'Microsoft 365 identity', description: 'An identity from this site\'s Microsoft 365 tenant', family: 'Microsoft 365', integrationId: 'microsoft-365', type: 'string', valueMode: 'single', entityType: 'm365_identity', supportsMultiple: true,
  },
  m365_identity_list: {
    label: 'Microsoft 365 identity list', description: 'One or more identities from this site\'s Microsoft 365 tenant', family: 'Microsoft 365', integrationId: 'microsoft-365', type: 'string', valueMode: 'multiple', entityType: 'm365_identity', baseType: 'm365_identity',
  },
  m365_license: {
    label: 'Microsoft 365 license', description: 'A license SKU from this site\'s Microsoft 365 tenant', family: 'Microsoft 365', integrationId: 'microsoft-365', type: 'string', valueMode: 'single', entityType: 'm365_license', supportsMultiple: true,
  },
  m365_license_list: {
    label: 'Microsoft 365 license list', description: 'One or more license SKUs from this site\'s Microsoft 365 tenant', family: 'Microsoft 365', integrationId: 'microsoft-365', type: 'string', valueMode: 'multiple', entityType: 'm365_license', baseType: 'm365_license',
  },
} as const satisfies Record<string, {
  label: string;
  description: string;
  family: string;
  integrationId?: string;
  type: 'string' | 'number' | 'boolean';
  valueMode: 'single' | 'multiple';
  entityType?: string;
  supportsMultiple?: boolean;
  baseType?: string;
}>;

export type SiteFactFieldTypeId = keyof typeof SITE_FACT_FIELD_TYPES;
export type SiteFactFieldType = {
  label: string;
  description: string;
  family: string;
  integrationId?: string;
  type: 'string' | 'number' | 'boolean';
  valueMode: 'single' | 'multiple';
  entityType?: string;
  supportsMultiple?: boolean;
  baseType?: string;
};

export function isSiteFactFieldType(value: unknown): value is SiteFactFieldTypeId {
  return typeof value === 'string' && value in SITE_FACT_FIELD_TYPES;
}

export function getSiteFactFieldType(type: SiteFactFieldTypeId): SiteFactFieldType {
  return SITE_FACT_FIELD_TYPES[type];
}

export function siteFactFieldTypesForIntegrations(enabledIntegrationIds: Iterable<string>) {
  const enabled = new Set(enabledIntegrationIds);
  return (Object.keys(SITE_FACT_FIELD_TYPES) as SiteFactFieldTypeId[]).map((id) => {
    const definition = getSiteFactFieldType(id);
    return {
    id,
    ...definition,
    enabled: !definition.integrationId || enabled.has(definition.integrationId),
    };
  });
}

const PACKAGE_HINT_TYPES: Record<string, FieldTypeId> = {
  text: 'text', boolean: 'boolean', number: 'number', stringArray: 'text_list',
  password: 'secret', upn: 'upn', postalCode: 'postal_code', city: 'city',
  countryCode: 'country_code', state: 'region', timezone: 'timezone', uuid: 'uuid',
};
const RESOURCE_TYPES: Record<string, FieldTypeId> = {
  site: 'site', integration_link: 'integration_link', m365_identity: 'm365_identity',
  m365_group: 'm365_group', m365_license: 'm365_license', m365_role: 'm365_role',
  sophos_endpoint: 'sophos_endpoint',
};
const PACKAGE_OUTPUT_TYPES: Record<string, FieldTypeId> = {
  'halopsa.ticketId': 'halo_ticket', 'mspbyte.siteId': 'site',
  'mspbyte.integrationLinkId': 'integration_link', 'sophos.endpointInternalId': 'sophos_endpoint',
};

export function fieldTypeLabel(type: FieldTypeId): string { return FIELD_TYPES[type].label; }

export function resolvePackageInputFieldType(meta: {
  valueType?: FieldTypeId; entityType?: string; typeHint?: string;
}): FieldTypeId {
  if (meta.valueType) return meta.valueType;
  const resource = meta.entityType ? RESOURCE_TYPES[meta.entityType] : undefined;
  if (resource) {
    const collectionType = `${resource}_list` as FieldTypeId;
    return meta.typeHint === 'stringArray' && collectionType in FIELD_TYPES ? collectionType : resource;
  }
  const hint = meta.typeHint ? PACKAGE_HINT_TYPES[meta.typeHint] : undefined;
  return hint ?? 'text';
}

export function resolvePackageOutputFieldType(meta: { valueType?: FieldTypeId; outputType?: string }): FieldTypeId {
  if (meta.valueType) return meta.valueType;
  return (meta.outputType ? PACKAGE_OUTPUT_TYPES[meta.outputType] : undefined) ?? 'text';
}

export function resolveSiteFactFieldType(field: {
  key: string; type?: string | null; valueMode?: string | null; valueType?: FieldTypeId | string | null;
}): SiteFactFieldTypeId {
  if (isSiteFactFieldType(field.valueType)) return field.valueType;
  // Semantic built-ins can be adopted without rewriting existing fact rows.
  if (field.key === 'time_zone') return 'timezone';
  if (field.valueMode === 'multiple') return 'text_list';
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'number') return 'number';
  return 'text';
}
