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
  ipAddress: {
    label: 'Internal IP Address',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'ipAddress',
    required: true
  },
  extAddress: {
    label: 'External IP Address',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'extAddress',
    required: true
  },
  online: {
    label: 'Online',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'online',
    required: true
  },
  udfs: {
    label: 'User-Defined Fields',
    type: 'object',
    modality: 'single',
    trackable: false,
    ingestPath: 'udfs',
    required: true
  },
  lastRebootAt: {
    label: 'Last Reboot',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'lastRebootAt',
    required: true
  },
  lastHeartbeatAt: {
    label: 'Last Heartbeat',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'lastHeartbeatAt',
    required: false
  }
};
