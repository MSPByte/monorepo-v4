import { HaloPSAConnector, type HaloPSARecurringInvoice } from '@mspbyte/connectors';
import { Encryption } from '@mspbyte/encryption';
import { getHaloPsaRawSchema, PROVIDER_IDS, ProviderFacet } from '@mspbyte/shared';
import type {
  FetchPage,
  FetchResultCursor,
  IngestionAdapter,
  IngestionAdapterContext,
  RawRecordEnvelope,
  ResolveLinkMetaContext
} from '@mspbyte/pipeline';
import { requireEncryptionKey } from '../../env.js';
import { logger } from '../../logger.js';
import { serializeError } from '../../errors.js';

type RecurringItemPayload = {
  _external_id: string;
  _invoice: Record<string, unknown>;
  _line: Record<string, unknown>;
};

export const haloPsaAdapter: IngestionAdapter = {
  providerId: PROVIDER_IDS.HALOPSA,
  types: [ProviderFacet.HaloPsaRecurringItems],

  async *fetch(type, _mode, _cursor, context): AsyncGenerator<FetchPage, FetchResultCursor> {
    const facet = type as ProviderFacet;
    if (facet !== ProviderFacet.HaloPsaRecurringItems) {
      throw new Error(`Unsupported HaloPSA ingestion facet: ${type}`);
    }

    const connector = createConnector(context);
    const invoices = await fetchRecurringInvoices(connector, context);
    yield page(facet, flattenRecurringItems(invoices));
  },

  async resolveLinkMeta(ctx: ResolveLinkMetaContext): Promise<Record<string, unknown>> {
    const connector = createConnectorFromConfig(ctx.integrationConfig, ctx.linkId);
    const sites = await connector.site.list();
    const externalIdStr = String(ctx.externalId);
    const site = sites.find((s) => String(s.id) === externalIdStr);
    if (!site) {
      throw new Error(
        `HaloPSA site ${ctx.externalId} not found while resolving link meta for link ${ctx.linkId}`
      );
    }
    return { clientId: site.client_id };
  }
};

function createConnector(context: IngestionAdapterContext): HaloPSAConnector {
  return createConnectorFromConfig(context.integrationConfig, context.linkId);
}

function createConnectorFromConfig(
  integrationConfig: Record<string, unknown> | undefined,
  linkId: string
): HaloPSAConnector {
  const url = stringFromConfig(integrationConfig, 'url', linkId).replace(/\/+$/, '');
  const clientId = stringFromConfig(integrationConfig, 'clientId', linkId);
  const clientSecretEnc = stringFromConfig(integrationConfig, 'clientSecret', linkId);
  const clientSecret = Encryption.decrypt(clientSecretEnc, requireEncryptionKey());
  if (!clientSecret) {
    throw new Error(`HaloPSA client secret could not be decrypted for link ${linkId}`);
  }
  return new HaloPSAConnector(url, clientId, clientSecret);
}

function stringFromConfig(
  integrationConfig: Record<string, unknown> | undefined,
  key: string,
  linkId: string
): string {
  const value = integrationConfig?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`HaloPSA integrationConfig.${key} missing for link ${linkId}`);
  }
  return value;
}

async function fetchRecurringInvoices(
  connector: HaloPSAConnector,
  context: IngestionAdapterContext
): Promise<HaloPSARecurringInvoice[]> {
  const clientId = numberMeta(context, 'clientId');
  const siteId = stringMeta(context, 'externalId');

  if (!clientId) {
    logger.warn(
      'HaloPSA link missing clientId in linkMeta; skipping recurring invoice fetch to avoid cross-tenant leakage',
      {
        linkId: context.linkId
      }
    );
    return [];
  }

  let invoices = await connector.recurringInvoice.list({
    clientId,
    includeLines: true,
    fullObjects: false
  });

  const rows: HaloPSARecurringInvoice[] = [];
  for (const invoice of invoices.filter(
    (i) => invoiceAppliesToClient(i, clientId) && invoiceAppliesToSite(i, siteId)
  )) {
    if (recurringLines(invoice).length > 0) {
      rows.push(invoice);
      continue;
    }

    const id = invoice.id;
    if (id == null) {
      rows.push(invoice);
      continue;
    }

    try {
      rows.push(await connector.recurringInvoice.get(id, true));
    } catch (error) {
      logger.warn('HaloPSA recurring invoice detail fetch failed', {
        linkId: context.linkId,
        invoiceId: id,
        error: serializeError(error)
      });
      rows.push(invoice);
    }
  }

  const recurringItemCt = rows.reduce(
    (count, invoice) => count + recurringLines(invoice).length,
    0
  );
  if (invoices.length > 0 && recurringItemCt === 0) {
    const sample = asRecord(rows[0] ?? invoices[0]);
    logger.warn('HaloPSA recurring invoices contained no detected line arrays', {
      linkId: context.linkId,
      invoiceCt: invoices.length,
      sampleKeys: Object.keys(sample).slice(0, 50),
      arrayKeys: Object.entries(sample)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => ({ key, length: (value as unknown[]).length }))
    });
  }

  return rows;
}

function flattenRecurringItems(invoices: HaloPSARecurringInvoice[]): RecurringItemPayload[] {
  const records: RecurringItemPayload[] = [];

  for (const invoice of invoices) {
    const invoiceRecord = asRecord(invoice);
    const invoiceId = stringId(invoiceRecord.id);
    if (!invoiceId) continue;
    const invoiceSummary = summarizeInvoice(invoiceRecord);

    const lines = recurringLines(invoiceRecord);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const lineId = stringId(line.id) ?? String(index + 1);
      records.push({
        _external_id: `${invoiceId}:${lineId}`,
        _invoice: invoiceSummary,
        _line: summarizeLine(line)
      });
    }
  }

  return records;
}

function invoiceAppliesToClient(invoice: HaloPSARecurringInvoice, clientId: number): boolean {
  const record = asRecord(invoice);
  const invoiceClientId = stringId(record.client_id) ?? stringId(record.clientid);
  // If HaloPSA returned an invoice with no client id at all, keep it (rare) — the site-level check will still gate it.
  if (!invoiceClientId) return true;
  return invoiceClientId === stringId(clientId);
}

function invoiceAppliesToSite(
  invoice: HaloPSARecurringInvoice,
  siteId: string | undefined
): boolean {
  if (!siteId) return true;
  const record = asRecord(invoice);
  const invoiceSiteId =
    stringId(record.site_id) ??
    stringId(record.siteid) ??
    stringId(record.clientsite_id) ??
    stringId(record.clientsiteid) ??
    stringId(record.sitenumber) ??
    stringId(record.site_number);
  // HaloPSA uses sitenumber/site_id = 0 to mean "applies to every site under the client".
  if (!invoiceSiteId || invoiceSiteId === '0') return true;
  return invoiceSiteId === siteId;
}

function summarizeInvoice(invoice: Record<string, unknown>): Record<string, unknown> {
  const summary = pickFields(invoice, [
    'id',
    'client_id',
    'clientid',
    'client_name',
    'site_id',
    'siteid',
    'sitenumber',
    'site_number',
    'site_name',
    'contract_id',
    'contractid',
    'contract_ref',
    'name',
    'type',
    'use',
    'period',
    'recurring_period',
    'invoicenumber'
  ]);
  summary.applies_to_all_sites =
    isClientWideSiteRef(summary.site_id) &&
    isClientWideSiteRef(summary.siteid) &&
    isClientWideSiteRef(summary.sitenumber) &&
    isClientWideSiteRef(summary.site_number);
  return summary;
}

function isClientWideSiteRef(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return value === '' || value === '0';
  return false;
}

function summarizeLine(line: Record<string, unknown>): Record<string, unknown> {
  return pickFields(line, [
    'id',
    '_itemid',
    'item_name',
    'item_shortdescription',
    'item_longdescription',
    'qty_order',
    'unit_price',
    'unit_cost',
    'contract_id'
  ]);
}

function pickFields(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (
      value == null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      output[key] = value ?? null;
    }
  }
  return output;
}

function recurringLines(invoice: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(invoice.lines)) {
    return invoice.lines.filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === 'object' && !Array.isArray(entry)
    );
  }
  return [];
}

function page(facet: ProviderFacet, records: RecurringItemPayload[]): FetchPage {
  return {
    records: records.map((record) => envelope(facet, record))
  };
}

function envelope(facet: ProviderFacet, record: RecurringItemPayload): RawRecordEnvelope {
  const schema = getHaloPsaRawSchema(facet);
  if (schema) schema.parse(record);

  return {
    externalId: record._external_id,
    op: 'upsert',
    payload: record
  };
}

function stringMeta(context: IngestionAdapterContext, key: string): string | undefined {
  const value = context.linkMeta?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberMeta(context: IngestionAdapterContext, key: string): number | undefined {
  const value = context.linkMeta?.[key];
  return typeof value === 'number' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
