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
  },
  retentionPolicy: {
    label: 'Retention Policy',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'retentionPolicy',
    required: true
  },
  lsvStatus: {
    label: 'LocalSpeedVault Status',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'lsvStatus',
    required: false
  },
  errors: {
    label: 'Errors',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'errors',
    required: true
  },
  selectedSize: {
    label: 'Selected Size',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'selectedSize',
    required: true
  },
  usedStorage: {
    label: 'Used Storage',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'usedStorage',
    required: true
  },
  last28Days: {
    label: 'Last 28 Days',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'last28Days',
    required: true
  },
  lastSuccessAt: {
    label: 'Last Successful Backup',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'lastSuccessAt',
    required: false
  }
};
