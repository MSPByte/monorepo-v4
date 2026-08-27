import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { capabilityCandidates } from '@mspbyte/drizzle-catalog';
import {
  buildOpenApiRequest,
  WRITE_BACK_ALLOWED_TABLES,
  type OutputFieldDef,
  type WriteBackConfig,
} from '@mspbyte/capabilities';
import type { M365Connector } from '@mspbyte/connectors';
import type { CapabilityResult } from '@mspbyte/capabilities';
import { logger } from './logger.js';

export type CatalogCandidate = {
  id: string;
  name: string;
  lifecycleStatus: string;
  integration: unknown;
  operation: unknown;
  inputMeta: unknown;
  outputMeta: unknown;
};

/** Loads a candidate from the catalog DB and returns it if executable.
 *  By default only approved/live candidates are returned; pass `allowUnreviewed: true`
 *  to also load generated/rejected candidates (used by dev test runs). */
export async function loadCatalogCandidate(
  catalogDb: any,
  candidateId: string,
  options?: { allowUnreviewed?: boolean },
): Promise<CatalogCandidate | null> {
  const [row] = await catalogDb
    .select()
    .from(capabilityCandidates)
    .where(eq(capabilityCandidates.id, candidateId))
    .limit(1);
  if (!row) return null;
  if (!options?.allowUnreviewed && row.lifecycleStatus !== 'approved' && row.lifecycleStatus !== 'live') return null;
  return row as CatalogCandidate;
}

/** Executes an approved/live catalog candidate against the appropriate connector.
 *  This is the dynamic executor: manifest → request → connector → write-back. */
export async function executeCatalogCandidate(args: {
  candidate: CatalogCandidate;
  inputs: Record<string, unknown>;
  linkId: string | null;
  getM365Connector: (linkId: string) => Promise<M365Connector>;
  tenantDb: any;
}): Promise<CapabilityResult<Record<string, unknown>>> {
  const { candidate, inputs, linkId, getM365Connector, tenantDb } = args;
  const integration = candidate.integration as { integrationId: string; connection: 'configured' | 'activeLink' };
  const operation = candidate.operation as Parameters<typeof buildOpenApiRequest>[0] & { writeBack?: WriteBackConfig };
  const inputMeta = (candidate.inputMeta ?? {}) as Record<string, { required?: boolean; valueType?: string }>;

  const parsed = buildInputSchema(inputMeta).safeParse(inputs);
  if (!parsed.success) {
    return { outcome: 'fail', errorClass: 'input_validation', message: parsed.error.message };
  }

  // Build the HTTP request from the manifest
  let request: ReturnType<typeof buildOpenApiRequest>;
  try {
    request = buildOpenApiRequest(operation, inputs);
  } catch (e) {
    return {
      outcome: 'fail',
      errorClass: 'input_validation',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  // Route to the appropriate connector
  let responseData: unknown;
  let responseStatus: number;

  if (integration.integrationId === 'microsoft-365') {
    if (!linkId && integration.connection === 'activeLink') {
      return {
        outcome: 'fail',
        errorClass: 'handler_threw',
        message: 'This capability requires an active M365 link but the package run has no linkId.',
      };
    }
    let connector: M365Connector;
    try {
      connector = await getM365Connector(linkId!);
    } catch (e) {
      return {
        outcome: 'fail',
        errorClass: 'vendor_error',
        message: e instanceof Error ? e.message : String(e),
        retryable: false,
      };
    }

    let response: { data: unknown; status: number };
    try {
      response = await connector.operations.execute({
        method: request.method,
        path: request.path,
        query: request.query,
        headers: request.headers,
        body: request.body,
      });
    } catch (e) {
      return {
        outcome: 'fail',
        errorClass: 'handler_threw',
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
      };
    }
    responseData = response.data;
    responseStatus = response.status;
  } else {
    return {
      outcome: 'fail',
      errorClass: 'capability_missing',
      message: `Integration '${integration.integrationId}' does not have a dynamic executor yet.`,
    };
  }

  // Build named outputs from outputMeta, then add raw fallbacks.
  const outputMeta = (candidate.outputMeta ?? {}) as Record<string, OutputFieldDef>;
  const outputs: Record<string, unknown> = {
    data: responseData,
    status: responseStatus,
  };
  for (const [key, def] of Object.entries(outputMeta)) {
    if (key === 'data' || key === 'status' || !def.source) continue;
    if (def.source === 'input' && def.inputKey) {
      outputs[key] = inputs[def.inputKey];
    } else if (def.source === 'response' && def.path) {
      outputs[key] = getNestedValue(responseData, def.path);
    }
  }

  // Apply write-back on success
  const wb = operation.writeBack;
  if (wb && wb.effect !== 'none' && wb.table && wb.key) {
    try {
      await applyWriteBack({ db: tenantDb, wb, inputs, responseData });
    } catch (e) {
      // Write-back failure is non-fatal — the vendor API call succeeded.
      // Log it so engineers can diagnose mapping issues.
      logger.warn('Write-back failed after successful API call', {
        candidateId: candidate.id,
        table: wb.table,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { outcome: 'success', outputs };
}

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, seg) => {
    if (acc !== null && typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
    return undefined;
  }, obj);
}

function buildInputSchema(
  inputMeta: Record<string, { required?: boolean; valueType?: string }>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, meta] of Object.entries(inputMeta)) {
    let field: z.ZodTypeAny;
    switch (meta.valueType) {
      case 'number': field = z.number(); break;
      case 'boolean': field = z.boolean(); break;
      case 'text_list': field = z.array(z.string()); break;
      case 'uuid': field = z.string().uuid(); break;
      default: field = z.string();
    }
    shape[key] = meta.required ? field : field.optional();
  }
  return z.object(shape);
}

function resolveValue(
  source: 'inputs' | 'response',
  field: string,
  inputs: Record<string, unknown>,
  responseData: unknown,
): unknown {
  const root = source === 'inputs' ? inputs : (responseData as Record<string, unknown> ?? {});
  return field.split('.').reduce<unknown>((acc, seg) => {
    if (acc !== null && typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
    return undefined;
  }, root);
}

async function applyWriteBack(args: {
  db: any;
  wb: WriteBackConfig;
  inputs: Record<string, unknown>;
  responseData: unknown;
}): Promise<void> {
  const { db, wb, inputs, responseData } = args;

  if (!wb.table || !wb.key) return;

  const tableInfo = WRITE_BACK_ALLOWED_TABLES[wb.table];
  if (!tableInfo) throw new Error(`Write-back table '${wb.table}' is not in the allowed list`);

  if (!tableInfo.allowedKeyColumns.includes(wb.key.column)) {
    throw new Error(`Write-back key column '${wb.key.column}' is not allowed for table '${wb.table}'`);
  }

  const keyValue = resolveValue(wb.key.source, wb.key.field, inputs, responseData);
  if (keyValue === undefined || keyValue === null) return;

  if (wb.effect === 'delete') {
    await db.execute(
      sql`DELETE FROM vendors.${sql.raw(wb.table)} WHERE ${sql.raw(wb.key.column)} = ${keyValue}`,
    );
    return;
  }

  if ((wb.effect === 'patch' || wb.effect === 'insert') && wb.mappings?.length) {
    const updates: Array<{ col: string; value: unknown }> = [];
    for (const m of wb.mappings) {
      if (!m.field || !m.column) continue;
      if (!tableInfo.columns.some(c => c.name === m.column)) continue;
      const v = resolveValue(m.source, m.field, inputs, responseData);
      if (v === undefined || v === null) continue;
      updates.push({ col: m.column, value: v });
    }
    if (updates.length === 0) return;

    const now = new Date().toISOString();
    const setClauses = sql.join(
      [
        ...updates.map(({ col, value }) => sql`${sql.raw(col)} = ${value}`),
        sql`updated_at = ${now}`,
      ],
      sql`, `,
    );

    await db.execute(
      sql`UPDATE vendors.${sql.raw(wb.table)} SET ${setClauses} WHERE ${sql.raw(wb.key.column)} = ${keyValue}`,
    );
  }
}
