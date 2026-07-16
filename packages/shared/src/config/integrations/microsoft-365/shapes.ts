import type { SchemaFields } from '../../../types/schema-registry.js';

/**
 * Field keys mirror the drizzle camelCase column names on the corresponding
 * vendors.* table so consumers (billing filters, table-data queries, etc.)
 * can use the key as the DB column identifier without extra mapping.
 */

export const M365IdentitiesShape: SchemaFields = {
  name: {
    label: 'Display Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'name',
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
  type: {
    label: 'Identity Type',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'type',
    required: true,
    options: [
      { value: 'member', label: 'Member' },
      { value: 'guest', label: 'Guest' },
      { value: 'service', label: 'Service' }
    ]
  },
  enabled: {
    label: 'Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'enabled',
    required: true
  },
  mfaEnforced: {
    label: 'MFA Enforced',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'mfaEnforced',
    required: false
  }
};

export const M365GroupsShape: SchemaFields = {
  name: {
    label: 'Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'name',
    required: true
  },
  description: {
    label: 'Description',
    type: 'string',
    modality: 'single',
    trackable: false,
    ingestPath: 'description',
    required: false
  },
  mailEnabled: {
    label: 'Mail Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'mailEnabled',
    required: true
  },
  securityEnabled: {
    label: 'Security Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'securityEnabled',
    required: true
  }
};

export const M365LicensesShape: SchemaFields = {
  skuPartNumber: {
    label: 'SKU Part Number',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'skuPartNumber',
    required: true
  },
  friendlyName: {
    label: 'Friendly Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'friendlyName',
    required: true
  },
  enabled: {
    label: 'Enabled',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'enabled',
    required: true
  },
  totalUnits: {
    label: 'Total Units',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'totalUnits',
    required: true
  },
  consumedUnits: {
    label: 'Consumed Units',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'consumedUnits',
    required: true
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
  operatingSystem: {
    label: 'Operating System',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'operatingSystem',
    required: false
  },
  isCompliant: {
    label: 'Compliant',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'isCompliant',
    required: false
  },
  isManaged: {
    label: 'Managed',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'isManaged',
    required: false
  },
  deviceOwnership: {
    label: 'Ownership',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'deviceOwnership',
    required: false
  }
};
