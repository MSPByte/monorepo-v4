import type { SchemaFields } from '../../../types/schema-registry.js';

export const SophosEndpointsShape: SchemaFields = {
  hostname: {
    label: 'Hostname',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'hostname',
    required: true
  },
  type: {
    label: 'Endpoint Type',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'type',
    required: true,
    options: [
      { value: 'computer', label: 'Computer' },
      { value: 'server', label: 'Server' }
    ]
  },
  platform: {
    label: 'Platform',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'platform',
    required: true
  },
  osName: {
    label: 'OS Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'osName',
    required: true
  },
  health: {
    label: 'Health',
    type: 'enum',
    modality: 'single',
    trackable: true,
    ingestPath: 'health',
    required: true,
    options: [
      { value: 'good', label: 'Good' },
      { value: 'suspicious', label: 'Suspicious' },
      { value: 'bad', label: 'Bad' },
      { value: 'unknown', label: 'Unknown' }
    ]
  },
  online: {
    label: 'Online',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'online',
    required: true
  },
  needsUpgrade: {
    label: 'Needs Upgrade',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'needsUpgrade',
    required: true
  },
  hasMdr: {
    label: 'Has MDR',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'hasMdr',
    required: true
  },
  tamperProtectionEnabled: {
    label: 'Tamper Protection',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'tamperProtectionEnabled',
    required: true
  }
};

export const SophosFirewallsShape: SchemaFields = {
  name: {
    label: 'Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'name',
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
  model: {
    label: 'Model',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'model',
    required: true
  },
  firmwareVersion: {
    label: 'Firmware Version',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'firmwareVersion',
    required: true
  },
  connected: {
    label: 'Connected',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'connected',
    required: true
  },
  suspended: {
    label: 'Suspended',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'suspended',
    required: true
  }
};

export const SophosLicensesShape: SchemaFields = {
  name: {
    label: 'Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'name',
    required: true
  },
  code: {
    label: 'License Code',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'code',
    required: true
  },
  type: {
    label: 'License Type',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'type',
    required: true
  },
  perpetual: {
    label: 'Perpetual',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'perpetual',
    required: true
  },
  unlimited: {
    label: 'Unlimited',
    type: 'boolean',
    modality: 'single',
    trackable: true,
    ingestPath: 'unlimited',
    required: true
  }
};
