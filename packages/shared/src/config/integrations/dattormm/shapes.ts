import type { SchemaFields } from '../../../types/schema-registry.js';

export const DattoEndpointsShape: SchemaFields = {
  hostname: {
    label: 'Hostname',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'hostname',
    required: true
  },
  category: {
    label: 'Category',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'category',
    required: true,
    options: [
      { value: 'workstation', label: 'Workstation' },
      { value: 'server', label: 'Server' },
      { value: 'other', label: 'Other' }
    ]
  },
  os: {
    label: 'OS',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'os',
    required: true
  },
  online: {
    label: 'Online',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'online',
    required: true
  }
};
