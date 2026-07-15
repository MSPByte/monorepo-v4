import {
  HaloPsaRecurringItemSchema,
  ProviderFacet,
  type HaloPsaRecurringItem
} from '@mspbyte/shared';

type RecordValue = Record<string, unknown>;

export function normalizeHaloPsa(facet: string, raw: unknown): RecordValue {
  if (facet !== ProviderFacet.HaloPsaRecurringItems) {
    throw new Error(`Unsupported HaloPSA projection facet: ${facet}`);
  }
  return normalizeRecurringItem(HaloPsaRecurringItemSchema.parse(raw));
}

function normalizeRecurringItem(raw: HaloPsaRecurringItem): RecordValue {
  const invoice = raw._invoice as Record<string, unknown>;
  const line = raw._line as Record<string, unknown>;

  return {
    externalId: raw._external_id,
    externalClientId: stringValue(invoice.client_id) ?? stringValue(invoice.clientid),
    externalSiteId:
      stringValue(invoice.site_id) ??
      stringValue(invoice.siteid) ??
      stringValue(invoice.sitenumber) ??
      stringValue(invoice.site_number),
    externalContractId:
      stringValue(line.contract_id) ??
      stringValue(invoice.contract_id) ??
      stringValue(invoice.contractid),
    externalInvoiceId: stringValue(invoice.id),
    externalItemId: stringValue(line._itemid) ?? stringValue(line.id),
    itemName: stringValue(line.item_name) ?? 'Unknown recurring item',
    description:
      stringValue(line.item_longdescription) ?? stringValue(line.item_shortdescription),
    quantity: integerValue(line.qty_order),
    unitPrice: decimalString(line.unit_price),
    cost: nullableDecimalString(line.unit_cost),
    recurringPeriod:
      stringValue(invoice.period) ?? stringValue(invoice.recurring_period)
  };
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function integerValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return 0;
}

function decimalString(value: unknown): string {
  return nullableDecimalString(value) ?? '0';
}

function nullableDecimalString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[$,]/g, ''));
    if (Number.isFinite(parsed)) return parsed.toFixed(2);
  }
  return null;
}
