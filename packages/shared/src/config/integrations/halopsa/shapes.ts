import type { SchemaFields } from '../../../types/schema-registry.js';

export const HaloPsaRecurringItemsShape: SchemaFields = {
  externalClientId: {
    label: 'Client ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'externalClientId',
    required: false
  },
  externalSiteId: {
    label: 'Site ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'externalSiteId',
    required: false
  },
  externalContractId: {
    label: 'Contract ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'externalContractId',
    required: false
  },
  externalInvoiceId: {
    label: 'Invoice ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'externalInvoiceId',
    required: false
  },
  externalItemId: {
    label: 'Item ID',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'externalItemId',
    required: false
  },
  itemName: {
    label: 'Item Name',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'itemName',
    required: true
  },
  description: {
    label: 'Description',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'description',
    required: false
  },
  quantity: {
    label: 'Quantity',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'quantity',
    required: true
  },
  unitPrice: {
    label: 'Unit Price',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'unitPrice',
    required: true
  },
  cost: {
    label: 'Cost',
    type: 'number',
    modality: 'single',
    trackable: true,
    ingestPath: 'cost',
    required: false
  },
  recurringPeriod: {
    label: 'Recurring Period',
    type: 'string',
    modality: 'single',
    trackable: true,
    ingestPath: 'recurringPeriod',
    required: false
  }
};
