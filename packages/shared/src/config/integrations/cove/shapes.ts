import type { SchemaFields } from '../../../types/schema-registry.js';

export const CoveEndpointsShape: SchemaFields = {
  endpointName: {
    label: 'Endpoint Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'endpointName',
    required: true
  },
  hostname: {
    label: 'Hostname',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'hostname',
    required: true
  },
  type: {
    label: 'Type',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'type',
    required: true,
    options: [
      { value: 'workstation', label: 'Workstation' },
      { value: 'server', label: 'Server' }
    ]
  },
  status: {
    label: 'Status',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'status',
    required: true,
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'error', label: 'Error' }
    ]
  },
  profile: {
    label: 'Profile',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'profile',
    required: true
  }
};
