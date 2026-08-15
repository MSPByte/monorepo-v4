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
  m365_group: { label: 'Microsoft 365 group', family: 'resource' },
  m365_license: { label: 'Microsoft 365 license', family: 'resource' },
  m365_role: { label: 'Microsoft 365 role', family: 'resource' },
  sophos_endpoint: { label: 'Sophos endpoint', family: 'resource' },
  halo_ticket: { label: 'HaloPSA ticket', family: 'resource' },
} as const;

export type FieldTypeId = keyof typeof FIELD_TYPES;

const PACKAGE_HINT_TYPES: Record<string, FieldTypeId> = {
  text: 'text', boolean: 'boolean', number: 'number', stringArray: 'text_list',
  password: 'secret', upn: 'upn', postalCode: 'postal_code', city: 'city',
  countryCode: 'country_code', state: 'region',
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
  if (resource) return resource;
  const hint = meta.typeHint ? PACKAGE_HINT_TYPES[meta.typeHint] : undefined;
  return hint ?? 'text';
}

export function resolvePackageOutputFieldType(meta: { valueType?: FieldTypeId; outputType?: string }): FieldTypeId {
  if (meta.valueType) return meta.valueType;
  return (meta.outputType ? PACKAGE_OUTPUT_TYPES[meta.outputType] : undefined) ?? 'text';
}

export function resolveSiteFactFieldType(field: {
  key: string; type?: string | null; valueMode?: string | null; valueType?: FieldTypeId;
}): FieldTypeId {
  if (field.valueType) return field.valueType;
  // Semantic built-ins can be adopted without rewriting existing fact rows.
  if (field.key === 'time_zone') return 'timezone';
  if (field.valueMode === 'multiple') return 'text_list';
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'number') return 'number';
  return 'text';
}
