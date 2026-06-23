import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  assets,
  coveEndpoints,
  dattoEndpoints,
  entitySources,
  m365Devices,
  m365Identities,
  people,
  sophosEndpoints,
  sophosFirewalls,
  syncRuns,
  syncRunStages
} from '@mspbyte/drizzle';
import { ProviderFacet } from '@mspbyte/shared';

type Db = any;

export type NormalizeMetrics = {
  recordsIn: number;
  recordsOut: number;
  canonicalCreatedCt: number;
  canonicalUpdatedCt: number;
  sourceCreatedCt: number;
  sourceUpdatedCt: number;
  candidateCt: number;
  skippedCt: number;
};

type ConfidenceLabel = 'high' | 'medium' | 'low';
type SourceStatus = 'candidate' | 'confirmed' | 'rejected' | 'superseded';
type PersonMatch = {
  canonicalId: string | undefined;
  confidence: number;
  method: string;
  evidence: Record<string, unknown>;
};
type AssetMatch = PersonMatch;
type M365IdentityInput = typeof m365Identities.$inferSelect & { normalizedEmail: string };

const CONFIRMED_THRESHOLD = 85;

type AssetTable =
  | typeof m365Devices
  | typeof sophosEndpoints
  | typeof sophosFirewalls
  | typeof dattoEndpoints
  | typeof coveEndpoints;

type AssetInput = {
  vendorTable: string;
  canonicalType: 'asset';
  row: {
    id: string;
    linkId: string;
    siteId?: string | null;
    externalId: string;
    [key: string]: unknown;
  };
  displayName: string;
  hostname?: string;
  serialNumber?: string;
  os?: string;
  assetType: 'workstation' | 'server' | 'network' | 'mobile' | 'unknown';
  status: 'active' | 'inactive' | 'unknown';
  sourceConfidence: ConfidenceLabel;
  attributes: Record<string, unknown>;
  createMatchMethod: string;
  allowHostnameMatch?: boolean;
};

export async function startNormalizeStage(
  db: Db,
  params: {
    syncRunId: string;
    provider: string;
    type: string;
    bullmqJobId: string;
  }
): Promise<string> {
  await db.update(syncRuns).set({ status: 'normalizing' }).where(eq(syncRuns.id, params.syncRunId));

  const [row] = await db
    .insert(syncRunStages)
    .values({
      syncRunId: params.syncRunId,
      integrationId: params.provider,
      bullmqJobId: params.bullmqJobId,
      type: params.type,
      stage: 'normalize',
      status: 'running',
      startedAt: new Date().toISOString()
    })
    .returning({ id: syncRunStages.id });

  return row.id;
}

export async function completeNormalizeStage(
  db: Db,
  stageId: string,
  syncRunId: string,
  metrics: NormalizeMetrics
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: 'completed',
      finishedAt: new Date().toISOString(),
      recordsIn: metrics.recordsIn,
      recordsOut: metrics.recordsOut,
      createdCt: metrics.canonicalCreatedCt + metrics.sourceCreatedCt,
      updatedCt: metrics.canonicalUpdatedCt + metrics.sourceUpdatedCt,
      failedCt: 0,
      metrics
    })
    .where(eq(syncRunStages.id, stageId));

  await db
    .update(syncRuns)
    .set({
      status: 'policy_pending'
    })
    .where(eq(syncRuns.id, syncRunId));
}

export async function failNormalizeStage(
  db: Db,
  stageId: string,
  syncRunId: string,
  error: unknown
): Promise<void> {
  const message = errorMessage(error);
  await db
    .update(syncRunStages)
    .set({
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: message
    })
    .where(eq(syncRunStages.id, stageId));

  await db
    .update(syncRuns)
    .set({
      status: 'normalize_failed',
      finishedAt: new Date().toISOString()
    })
    .where(eq(syncRuns.id, syncRunId));
}

export async function normalizeProjectedRun(
  db: Db,
  params: {
    linkId: string;
    siteId?: string;
    provider: string;
    type: string;
  }
): Promise<NormalizeMetrics> {
  switch (params.type) {
    case ProviderFacet.M365Identities:
      return normalizeM365Identities(db, params);
    case ProviderFacet.M365Devices:
      //return normalizeM365Devices(db, params); // This is bloat, no usecase yet
      return emptyMetrics();
    case ProviderFacet.SophosEndpoints:
      return normalizeSophosEndpoints(db, params);
    case ProviderFacet.SophosFirewalls:
      return normalizeSophosFirewalls(db, params);
    case ProviderFacet.DattoEndpoints:
      return normalizeDattoEndpoints(db, params);
    case ProviderFacet.CoveEndpoints:
      return normalizeCoveEndpoints(db, params);
    default:
      return emptyMetrics();
  }
}

async function normalizeM365Identities(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string }
): Promise<NormalizeMetrics> {
  const rows = (await db
    .select()
    .from(m365Identities)
    .where(and(eq(m365Identities.linkId, params.linkId), isNull(m365Identities.deletedAt)))) as Array<
    typeof m365Identities.$inferSelect
  >;
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  const validRows: M365IdentityInput[] = [];
  for (const row of rows) {
    const normalizedEmail = normalizeEmail(row.email);
    if (!normalizedEmail) metrics.skippedCt++;
    else validRows.push({ ...row, normalizedEmail });
  }
  if (validRows.length === 0) return metrics;

  const existingSources = await findSourcesBatch(
    db,
    'm365_identities',
    validRows.map((row) => row.id)
  );
  const rowsNeedingMatch = validRows.filter((row) => !existingSources.has(row.id));
  const peopleMatches = await findPeopleMatchesBatch(
    db,
    rowsNeedingMatch.map((row) => ({
      email: row.normalizedEmail,
      siteId: row.siteId ?? params.siteId
    }))
  );

  const planned = validRows.map((row) => {
    const existingSource = existingSources.get(row.id);
    const match: PersonMatch = existingSource
      ? {
          canonicalId: existingSource.canonicalId,
          confidence: 100,
          method: 'existing_source',
          evidence: { entitySourceId: existingSource.id }
        }
      : (peopleMatches.get(siteEmailKey(row.siteId ?? params.siteId, row.normalizedEmail)) ?? {
          canonicalId: undefined,
          confidence: 0,
          method: 'no_match',
          evidence: { email: row.normalizedEmail }
        });
    const status: SourceStatus =
      match.confidence >= CONFIRMED_THRESHOLD ? 'confirmed' : 'candidate';

    if (match.canonicalId && status === 'candidate') metrics.candidateCt++;

    return {
      row,
      match,
      status,
      needsCreate: !match.canonicalId || status !== 'confirmed'
    };
  });

  const createInputs = uniqueBy(
    planned.filter((item) => item.needsCreate),
    (item) => siteEmailKey(item.row.siteId ?? params.siteId, item.row.normalizedEmail)
  );
  const createdPeople = await upsertPeopleBatch(
    db,
    createInputs.map(({ row }) => ({
      siteId: row.siteId ?? params.siteId,
      primaryEmail: row.normalizedEmail,
      displayName: row.name || row.normalizedEmail,
      status: personStatus(row.enabled),
      sourceConfidence: 'high',
      attributes: m365PersonAttributes(params.linkId, row)
    }))
  );
  metrics.canonicalCreatedCt += createdPeople.createdCt;
  metrics.canonicalUpdatedCt += createdPeople.updatedCt;

  const createdBySiteEmail = new Map(
    createdPeople.rows.map((row) => [siteEmailKey(row.siteId ?? undefined, row.primaryEmail), row.id])
  );

  const updateInputs = planned
    .filter((item) => !item.needsCreate && item.match.canonicalId)
    .map(({ row, match }) => ({
      id: match.canonicalId!,
      displayName: row.name || row.normalizedEmail,
      status: personStatus(row.enabled),
      sourceConfidence: confidenceLabel(match.confidence),
      attributes: m365PersonAttributes(params.linkId, row)
    }));
  const updatedPeopleCt = await updatePeopleBatch(db, updateInputs);
  metrics.canonicalUpdatedCt += updatedPeopleCt;

  const sourceRows = planned.flatMap(({ row, match, needsCreate }) => {
    const canonicalId = needsCreate
      ? createdBySiteEmail.get(siteEmailKey(row.siteId ?? params.siteId, row.normalizedEmail))
      : match.canonicalId;
    if (!canonicalId) return [];

    return [
      {
        canonicalType: 'person' as const,
        canonicalId,
        vendorTable: 'm365_identities',
        vendorRecordId: row.id,
        linkId: params.linkId,
        siteId: row.siteId ?? params.siteId,
        provider: params.provider,
        type: params.type,
        externalId: row.externalId,
        confidence: needsCreate ? 100 : match.confidence,
        matchMethod: needsCreate ? 'created_from_m365_identity' : match.method,
        matchEvidence: needsCreate
          ? { email: row.normalizedEmail, reason: 'no confirmed existing person match' }
          : match.evidence,
        status: 'confirmed' as const
      }
    ];
  });
  const sourceResult = await upsertEntitySourcesBatch(db, sourceRows);
  metrics.sourceCreatedCt += sourceResult.createdCt;
  metrics.sourceUpdatedCt += sourceResult.updatedCt;
  metrics.recordsOut += sourceRows.length;

  return metrics;
}

async function normalizeM365Devices(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string }
): Promise<NormalizeMetrics> {
  const rows = (await db
    .select()
    .from(m365Devices)
    .where(and(eq(m365Devices.linkId, params.linkId), isNull(m365Devices.deletedAt)))) as Array<
    typeof m365Devices.$inferSelect
  >;
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  await normalizeAssetsBatch(
    db,
    params,
    metrics,
    rows.map((row) => ({
      vendorTable: 'm365_devices',
      canonicalType: 'asset',
      row,
      displayName: row.displayName,
      hostname: row.displayName,
      os: normalizeAssetOs(row.operatingSystem),
      assetType: assetTypeFromOperatingSystem(row.operatingSystem),
      status: row.isManaged === false ? 'unknown' : 'active',
      sourceConfidence: 'medium',
      attributes: {
        m365: {
          linkId: params.linkId,
          externalId: row.externalId,
          hostname: normalizeHostname(row.displayName),
          displayName: row.displayName,
          os: normalizeAssetOs(row.operatingSystem)
        }
      },
      createMatchMethod: 'created_from_m365_device'
    }))
  );

  return metrics;
}

async function normalizeSophosEndpoints(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string }
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, sophosEndpoints, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  await normalizeAssetsBatch(
    db,
    params,
    metrics,
    rows.map((row) => ({
      vendorTable: 'sophos_endpoints',
      canonicalType: 'asset',
      row,
      displayName: row.hostname,
      hostname: row.hostname,
      os: normalizeAssetOs(row.osName),
      assetType: row.type === 'server' ? 'server' : 'workstation',
      status: row.online ? 'active' : 'inactive',
      sourceConfidence: 'high',
      attributes: {
        sophosEndpoint: {
          linkId: params.linkId,
          externalId: row.externalId,
          hostname: normalizeHostname(row.hostname),
          displayName: row.hostname,
          os: normalizeAssetOs(row.osName)
        }
      },
      createMatchMethod: 'created_from_sophos_endpoint'
    }))
  );

  return metrics;
}

async function normalizeSophosFirewalls(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string }
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, sophosFirewalls, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  await normalizeAssetsBatch(
    db,
    params,
    metrics,
    rows.map((row) => ({
      vendorTable: 'sophos_firewalls',
      canonicalType: 'asset',
      row,
      displayName: row.name || row.hostname || row.serialNumber || row.externalId,
      hostname: row.hostname,
      serialNumber: row.serialNumber,
      os: row.firmwareVersion,
      assetType: 'network',
      status: row.suspended ? 'inactive' : row.connected ? 'active' : 'unknown',
      sourceConfidence: 'high',
      attributes: {
        sophosFirewall: {
          linkId: params.linkId,
          externalId: row.externalId,
          name: row.name,
          hostname: normalizeHostname(row.hostname),
          serialNumber: row.serialNumber
        }
      },
      createMatchMethod: 'created_from_sophos_firewall',
      allowHostnameMatch: false
    }))
  );

  return metrics;
}

async function normalizeDattoEndpoints(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string }
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, dattoEndpoints, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  await normalizeAssetsBatch(
    db,
    params,
    metrics,
    rows.map((row) => ({
      vendorTable: 'datto_endpoints',
      canonicalType: 'asset',
      row,
      displayName: row.hostname,
      hostname: row.hostname,
      os: normalizeAssetOs(row.os),
      assetType: row.category === 'other' ? 'unknown' : row.category,
      status: row.online ? 'active' : 'inactive',
      sourceConfidence: 'high',
      attributes: {
        datto: {
          linkId: params.linkId,
          externalId: row.externalId,
          hostname: normalizeHostname(row.hostname),
          displayName: row.hostname,
          os: normalizeAssetOs(row.os)
        }
      },
      createMatchMethod: 'created_from_datto_endpoint'
    }))
  );

  return metrics;
}

async function normalizeCoveEndpoints(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string }
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, coveEndpoints, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  await normalizeAssetsBatch(
    db,
    params,
    metrics,
    rows.map((row) => ({
      vendorTable: 'cove_endpoints',
      canonicalType: 'asset',
      row,
      displayName: row.endpointName || row.hostname || row.externalId,
      hostname: row.hostname || row.endpointName,
      os: undefined,
      assetType: row.type,
      status: row.status === 'inactive' ? 'inactive' : 'active',
      sourceConfidence: 'medium',
      attributes: {
        cove: {
          linkId: params.linkId,
          externalId: row.externalId,
          endpointName: row.endpointName,
          hostname: normalizeHostname(row.hostname || row.endpointName)
        }
      },
      createMatchMethod: 'created_from_cove_endpoint'
    }))
  );

  return metrics;
}

async function normalizeAssetsBatch(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string },
  metrics: NormalizeMetrics,
  inputs: AssetInput[]
): Promise<void> {
  const validInputs = inputs.flatMap((input) => {
    const hostname = normalizeHostname(input.hostname);
    const serialNumber = normalizeSerial(input.serialNumber);
    if (!hostname && !serialNumber) {
      metrics.skippedCt++;
      return [];
    }

    return [
      {
        ...input,
        siteId: input.row.siteId ?? params.siteId,
        hostname,
        serialNumber
      }
    ];
  });
  if (validInputs.length === 0) return;

  const existingSources = await findSourcesBatch(
    db,
    validInputs[0]!.vendorTable,
    validInputs.map((input) => input.row.id)
  );
  const inputsNeedingMatch = validInputs.filter((input) => !existingSources.has(input.row.id));
  const assetMatches = await findAssetMatchesBatch(
    db,
    inputsNeedingMatch.map((input) => ({
      siteId: input.siteId,
      hostname: input.hostname,
      serialNumber: input.serialNumber,
      allowHostnameMatch: input.allowHostnameMatch !== false
    }))
  );

  const planned = validInputs.map((input) => {
    const existingSource = existingSources.get(input.row.id);
    const match: AssetMatch = existingSource
      ? {
          canonicalId: existingSource.canonicalId,
          confidence: 100,
          method: 'existing_source',
          evidence: { entitySourceId: existingSource.id }
        }
      : (assetMatches.get(assetMatchKey(input)) ?? {
          canonicalId: undefined,
          confidence: 0,
          method: 'no_match',
          evidence: { hostname: input.hostname, serialNumber: input.serialNumber }
        });
    const status: SourceStatus =
      match.confidence >= CONFIRMED_THRESHOLD ? 'confirmed' : 'candidate';

    if (match.canonicalId && status === 'candidate') metrics.candidateCt++;

    return {
      input,
      match,
      status,
      needsCreate: !match.canonicalId || status !== 'confirmed'
    };
  });

  const createInputs = uniqueBy(
    planned.filter((item) => item.needsCreate),
    (item) => assetCreateKey(item.input)
  );
  const createdAssets = await insertAssetsBatch(
    db,
    createInputs.map(({ input }) => ({
      siteId: input.siteId,
      displayName: input.displayName,
      hostname: input.hostname,
      serialNumber: input.serialNumber,
      os: input.os,
      assetType: input.assetType,
      status: input.status,
      sourceConfidence: input.sourceConfidence,
      attributes: input.attributes
    }))
  );
  metrics.canonicalCreatedCt += createdAssets.length;
  const createdByKey = new Map(
    createdAssets.map((row) => [assetCreateKey(row), row.id])
  );

  const updateInputs = planned
    .filter((item) => !item.needsCreate && item.match.canonicalId)
    .map(({ input, match }) => ({
      id: match.canonicalId!,
      displayName: input.displayName,
      hostname: input.hostname,
      serialNumber: input.serialNumber,
      os: input.os,
      assetType: input.assetType,
      status: input.status,
      sourceConfidence: confidenceLabel(match.confidence),
      attributes: input.attributes
    }));
  const updatedAssetCt = await updateAssetsBatch(db, updateInputs);
  metrics.canonicalUpdatedCt += updatedAssetCt;

  const sourceRows = planned.flatMap(({ input, match, needsCreate }) => {
    const canonicalId = needsCreate
      ? createdByKey.get(assetCreateKey(input))
      : match.canonicalId;
    if (!canonicalId) return [];

    return [
      {
        canonicalType: input.canonicalType,
        canonicalId,
        vendorTable: input.vendorTable,
        vendorRecordId: input.row.id,
        linkId: params.linkId,
        siteId: input.siteId,
        provider: params.provider,
        type: params.type,
        externalId: input.row.externalId,
        confidence: needsCreate ? 100 : match.confidence,
        matchMethod: needsCreate ? input.createMatchMethod : match.method,
        matchEvidence: needsCreate
          ? {
              hostname: input.hostname,
              serialNumber: input.serialNumber,
              reason: 'no confirmed existing asset match'
            }
          : match.evidence,
        status: 'confirmed' as const
      }
    ];
  });
  const sourceResult = await upsertEntitySourcesBatch(db, sourceRows);
  metrics.sourceCreatedCt += sourceResult.createdCt;
  metrics.sourceUpdatedCt += sourceResult.updatedCt;
  metrics.recordsOut += sourceRows.length;
}

async function activeVendorRows(db: Db, table: AssetTable, linkId: string): Promise<Array<any>> {
  return db
    .select()
    .from(table)
    .where(and(eq(table.linkId, linkId), isNull(table.deletedAt)));
}

async function findSourcesBatch(
  db: Db,
  vendorTable: string,
  vendorRecordIds: string[]
): Promise<Map<string, { id: string; canonicalId: string; status: string }>> {
  if (vendorRecordIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: entitySources.id,
      canonicalId: entitySources.canonicalId,
      vendorRecordId: entitySources.vendorRecordId,
      status: entitySources.status
    })
    .from(entitySources)
    .where(
      and(
        eq(entitySources.vendorTable, vendorTable),
        inArray(entitySources.vendorRecordId, unique(vendorRecordIds))
      )
    );

  return new Map(
    rows
      .filter((row: { status: string }) => row.status === 'confirmed')
      .map((row: { vendorRecordId: string; id: string; canonicalId: string; status: string }) => [
        row.vendorRecordId,
        row
      ])
  );
}

async function findPeopleMatchesBatch(
  db: Db,
  inputs: Array<{ siteId?: string; email: string }>
): Promise<Map<string, PersonMatch>> {
  if (inputs.length === 0) return new Map();

  const emails = unique(inputs.map((input) => input.email));
  const rows = (await db
    .select({ id: people.id, siteId: people.siteId, primaryEmail: people.primaryEmail })
    .from(people)
    .where(inArray(people.primaryEmail, emails))) as Array<{
    id: string;
    siteId: string | null;
    primaryEmail: string;
  }>;
  const byEmail = groupBy(rows, (row) => row.primaryEmail);
  const result = new Map<string, PersonMatch>();

  for (const input of inputs) {
    const candidates = byEmail.get(input.email) ?? [];
    const row =
      candidates.find((candidate) => candidate.siteId === input.siteId) ??
      candidates.find((candidate) => candidate.siteId == null) ??
      candidates[0];
    if (!row) {
      result.set(siteEmailKey(input.siteId, input.email), {
        canonicalId: undefined,
        confidence: 0,
        method: 'no_match',
        evidence: { email: input.email }
      });
      continue;
    }

    result.set(siteEmailKey(input.siteId, input.email), {
      canonicalId: row.id,
      confidence: row.siteId === input.siteId ? 95 : 90,
      method: row.siteId === input.siteId ? 'site_email' : 'email',
      evidence: { email: input.email, siteId: input.siteId }
    });
  }

  return result;
}

async function upsertPeopleBatch(
  db: Db,
  values: Array<typeof people.$inferInsert>
): Promise<{
  rows: Array<{ id: string; siteId: string | null; primaryEmail: string }>;
  createdCt: number;
  updatedCt: number;
}> {
  if (values.length === 0) return { rows: [], createdCt: 0, updatedCt: 0 };

  const now = new Date().toISOString();
  const rows = await db
    .insert(people)
    .values(values.map((value) => ({ ...value, updatedAt: now })))
    .onConflictDoUpdate({
      target: [people.siteId, people.primaryEmail],
      set: {
        displayName: sql`excluded.display_name`,
        status: sql`excluded.status`,
        sourceConfidence: sql`excluded.source_confidence`,
        attributes: sql`coalesce(${people.attributes}, '{}'::jsonb) || excluded.attributes`,
        updatedAt: now
      }
    })
    .returning({
      id: people.id,
      siteId: people.siteId,
      primaryEmail: people.primaryEmail,
      xmax: sql<string>`xmax::text`
    });
  const createdCt = rows.filter((row: { xmax?: string }) => row.xmax === '0').length;

  return {
    rows,
    createdCt,
    updatedCt: rows.length - createdCt
  };
}

async function updatePeopleBatch(
  db: Db,
  values: Array<{
    id: string;
    displayName: string;
    status: 'active' | 'inactive' | 'unknown';
    sourceConfidence: ConfidenceLabel;
    attributes: Record<string, unknown>;
  }>
): Promise<number> {
  const rows = uniqueBy(values, (value) => value.id);
  if (rows.length === 0) return 0;

  const returned = await db
    .update(people)
    .set({
      displayName: caseById(people.id, rows.map((row) => [row.id, row.displayName]), people.displayName),
      status: caseById(people.id, rows.map((row) => [row.id, row.status]), people.status),
      sourceConfidence: caseById(
        people.id,
        rows.map((row) => [row.id, row.sourceConfidence]),
        people.sourceConfidence
      ),
      attributes: sql`coalesce(${people.attributes}, '{}'::jsonb) || ${caseJsonById(
        people.id,
        rows.map((row) => [row.id, row.attributes]),
        sql`'{}'::jsonb`
      )}`,
      updatedAt: new Date().toISOString()
    })
    .where(inArray(people.id, rows.map((row) => row.id)))
    .returning({ id: people.id });

  return returned.length;
}

async function upsertEntitySourcesBatch(
  db: Db,
  values: Array<typeof entitySources.$inferInsert>
): Promise<{ createdCt: number; updatedCt: number }> {
  if (values.length === 0) return { createdCt: 0, updatedCt: 0 };

  const now = new Date().toISOString();
  const rows = await db
    .insert(entitySources)
    .values(values.map((value) => ({ ...value, updatedAt: now })))
    .onConflictDoUpdate({
      target: [entitySources.vendorTable, entitySources.vendorRecordId],
      set: {
        canonicalType: sql`excluded.canonical_type`,
        canonicalId: sql`excluded.canonical_id`,
        linkId: sql`excluded.link_id`,
        siteId: sql`excluded.site_id`,
        provider: sql`excluded.provider`,
        type: sql`excluded.type`,
        externalId: sql`excluded.external_id`,
        confidence: sql`excluded.confidence`,
        matchMethod: sql`excluded.match_method`,
        matchEvidence: sql`excluded.match_evidence`,
        status: sql`excluded.status`,
        updatedAt: now
      }
    })
    .returning({ xmax: sql<string>`xmax::text` });
  const createdCt = rows.filter((row: { xmax?: string }) => row.xmax === '0').length;

  return {
    createdCt,
    updatedCt: rows.length - createdCt
  };
}

async function findAssetMatchesBatch(
  db: Db,
  inputs: Array<{
    siteId?: string;
    hostname?: string;
    serialNumber?: string;
    allowHostnameMatch?: boolean;
  }>
): Promise<Map<string, AssetMatch>> {
  if (inputs.length === 0) return new Map();

  const serialNumbers = unique(inputs.flatMap((input) => (input.serialNumber ? [input.serialNumber] : [])));
  const hostnames = unique(
    inputs.flatMap((input) =>
      input.hostname && input.allowHostnameMatch !== false ? [input.hostname] : []
    )
  );
  const serialMatches = serialNumbers.length
    ? ((await db
        .select({
          id: assets.id,
          siteId: assets.siteId,
          serialNumber: assets.serialNumber
        })
        .from(assets)
        .where(inArray(assets.serialNumber, serialNumbers))) as Array<{
        id: string;
        siteId: string | null;
        serialNumber: string | null;
      }>)
    : [];
  const hostnameMatches = hostnames.length
    ? ((await db
        .select({
          id: assets.id,
          siteId: assets.siteId,
          hostname: assets.hostname,
          displayName: assets.displayName
        })
        .from(assets)
        .where(
          or(
            inArray(assets.hostname, hostnames),
            inArray(sql`lower(${assets.displayName})`, hostnames)
          )
        )) as Array<{
        id: string;
        siteId: string | null;
        hostname: string | null;
        displayName: string;
      }>)
    : [];

  const serialByValue = groupBy(
    serialMatches.filter((row) => row.serialNumber != null),
    (row) => row.serialNumber!
  );
  const hostnameByValue = groupBy(hostnameMatches, (row) => normalizeHostname(row.hostname) ?? '');
  const displayNameByValue = groupBy(hostnameMatches, (row) => normalizeHostname(row.displayName) ?? '');
  const result = new Map<string, AssetMatch>();

  for (const input of inputs) {
    if (input.serialNumber) {
      const row = bestSiteMatch(serialByValue.get(input.serialNumber) ?? [], input.siteId);
      if (row) {
        result.set(assetMatchKey(input), {
          canonicalId: row.id,
          confidence: row.siteId === input.siteId ? 98 : 93,
          method: 'serial_number',
          evidence: { serialNumber: input.serialNumber, siteId: input.siteId }
        });
        continue;
      }
    }

    if (!input.hostname || input.allowHostnameMatch === false) {
      result.set(assetMatchKey(input), {
        canonicalId: undefined,
        confidence: 0,
        method: 'no_match',
        evidence: { hostname: input.hostname, serialNumber: input.serialNumber }
      });
      continue;
    }

    const hostnameRow = bestSiteMatch(hostnameByValue.get(input.hostname) ?? [], input.siteId);
    const displayNameRow = bestSiteMatch(displayNameByValue.get(input.hostname) ?? [], input.siteId);
    const row = hostnameRow ?? displayNameRow;
    if (!row) {
      result.set(assetMatchKey(input), {
        canonicalId: undefined,
        confidence: 0,
        method: 'no_match',
        evidence: { hostname: input.hostname, serialNumber: input.serialNumber }
      });
      continue;
    }

    result.set(assetMatchKey(input), {
      canonicalId: row.id,
      confidence: row.siteId === input.siteId ? 90 : 85,
      method: normalizeHostname(row.hostname) === input.hostname ? 'hostname' : 'display_name',
      evidence: { hostname: input.hostname, serialNumber: input.serialNumber, siteId: input.siteId }
    });
  }

  return result;
}

async function insertAssetsBatch(
  db: Db,
  values: Array<typeof assets.$inferInsert>
): Promise<Array<{ id: string; siteId: string | null; hostname: string | null; serialNumber: string | null }>> {
  if (values.length === 0) return [];

  return db
    .insert(assets)
    .values(values)
    .returning({
      id: assets.id,
      siteId: assets.siteId,
      hostname: assets.hostname,
      serialNumber: assets.serialNumber
    });
}

async function updateAssetsBatch(
  db: Db,
  values: Array<{
    id: string;
    displayName: string;
    hostname?: string;
    serialNumber?: string;
    os?: string;
    assetType: 'workstation' | 'server' | 'network' | 'mobile' | 'unknown';
    status: 'active' | 'inactive' | 'unknown';
    sourceConfidence: ConfidenceLabel;
    attributes: Record<string, unknown>;
  }>
): Promise<number> {
  const rows = uniqueBy(values, (value) => value.id);
  if (rows.length === 0) return 0;

  const returned = await db
    .update(assets)
    .set({
      displayName: caseById(assets.id, rows.map((row) => [row.id, row.displayName]), assets.displayName),
      hostname: caseNullableById(assets.id, rows.map((row) => [row.id, row.hostname]), assets.hostname),
      serialNumber: caseNullableById(
        assets.id,
        rows.map((row) => [row.id, row.serialNumber]),
        assets.serialNumber
      ),
      os: caseNullableById(assets.id, rows.map((row) => [row.id, row.os]), assets.os),
      assetType: caseById(assets.id, rows.map((row) => [row.id, row.assetType]), assets.assetType),
      status: caseById(assets.id, rows.map((row) => [row.id, row.status]), assets.status),
      sourceConfidence: caseById(
        assets.id,
        rows.map((row) => [row.id, row.sourceConfidence]),
        assets.sourceConfidence
      ),
      attributes: sql`coalesce(${assets.attributes}, '{}'::jsonb) || ${caseJsonById(
        assets.id,
        rows.map((row) => [row.id, row.attributes]),
        sql`'{}'::jsonb`
      )}`,
      updatedAt: new Date().toISOString()
    })
    .where(inArray(assets.id, rows.map((row) => row.id)))
    .returning({ id: assets.id });

  return returned.length;
}

function emptyMetrics(): NormalizeMetrics {
  return {
    recordsIn: 0,
    recordsOut: 0,
    canonicalCreatedCt: 0,
    canonicalUpdatedCt: 0,
    sourceCreatedCt: 0,
    sourceUpdatedCt: 0,
    candidateCt: 0,
    skippedCt: 0
  };
}

function m365PersonAttributes(linkId: string, row: M365IdentityInput): Record<string, unknown> {
  return {
    m365: {
      linkId,
      externalId: row.externalId,
      email: row.normalizedEmail,
      displayName: row.name || row.normalizedEmail
    }
  };
}

function personStatus(enabled: boolean): 'active' | 'inactive' {
  return enabled ? 'active' : 'inactive';
}

function caseById(
  idColumn: unknown,
  values: Array<[string, unknown]>,
  fallback: unknown
) {
  return sql`case ${idColumn as never} ${sql.join(
    values.map(([id, value]) => sql`when ${id} then ${value}`),
    sql.raw(' ')
  )} else ${fallback as never} end`;
}

function caseNullableById(
  idColumn: unknown,
  values: Array<[string, unknown]>,
  fallback: unknown
) {
  return sql`case ${idColumn as never} ${sql.join(
    values.map(([id, value]) => sql`when ${id} then ${value ?? null}`),
    sql.raw(' ')
  )} else ${fallback as never} end`;
}

function caseJsonById(
  idColumn: unknown,
  values: Array<[string, unknown]>,
  fallback: unknown
) {
  return sql`case ${idColumn as never} ${sql.join(
    values.map(([id, value]) => sql`when ${id} then ${JSON.stringify(value)}::jsonb`),
    sql.raw(' ')
  )} else ${fallback as never} end`;
}

function siteEmailKey(siteId: string | undefined, email: string): string {
  return `${siteId ?? ''}:${email}`;
}

function assetMatchKey(input: {
  siteId?: string;
  hostname?: string;
  serialNumber?: string;
  allowHostnameMatch?: boolean;
}): string {
  return [
    input.siteId ?? '',
    input.serialNumber ?? '',
    input.allowHostnameMatch === false ? '' : (input.hostname ?? '')
  ].join(':');
}

function assetCreateKey(input: {
  siteId?: string | null;
  hostname?: string | null;
  serialNumber?: string | null;
}): string {
  return [input.siteId ?? '', input.serialNumber ?? '', input.hostname ?? ''].join(':');
}

function bestSiteMatch<T extends { siteId: string | null }>(
  rows: T[],
  siteId: string | undefined
): T | undefined {
  return rows.find((row) => row.siteId === siteId) ?? rows.find((row) => row.siteId == null) ?? rows[0];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [keyFn(value), value])).values()];
}

function groupBy<T>(values: T[], keyFn: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFn(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && email.includes('@') ? email : undefined;
}

function normalizeHostname(value: string | null | undefined): string | undefined {
  const hostname = value?.trim().toLowerCase().replace(/\.$/, '');
  if (!hostname) return undefined;
  return hostname.includes('.') ? hostname.split('.')[0] : hostname;
}

function normalizeSerial(value: string | null | undefined): string | undefined {
  const serial = value?.trim().toLowerCase();
  return serial || undefined;
}

function normalizeAssetOs(value: string | null | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  const compact = raw.replace(/\s+/g, ' ');
  const lower = compact.toLowerCase();

  if (lower.includes('windows')) {
    const server = lower.includes('server') ? ' Server' : '';
    const version =
      lower.match(/\b(11|10|8\.1|8|7|2025|2022|2019|2016|2012 r2|2012)\b/)?.[1] ?? undefined;
    return version ? `Windows${server} ${version}` : `Windows${server}`.trim();
  }

  if (lower.includes('mac os') || lower.includes('macos') || lower.includes('os x')) {
    return 'macOS';
  }

  if (lower.includes('ubuntu')) return 'Ubuntu Linux';
  if (lower.includes('debian')) return 'Debian Linux';
  if (lower.includes('red hat') || lower.includes('rhel')) return 'Red Hat Enterprise Linux';
  if (lower.includes('centos')) return 'CentOS Linux';
  if (lower.includes('linux')) return 'Linux';
  if (lower.includes('android')) return 'Android';
  if (lower === 'ios' || lower.includes('iphone') || lower.includes('ipad')) return 'iOS';

  return compact;
}

function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 90) return 'high';
  if (confidence >= 70) return 'medium';
  return 'low';
}

function assetTypeFromOperatingSystem(
  value: string | null | undefined
): 'workstation' | 'server' | 'network' | 'mobile' | 'unknown' {
  const os = value?.toLowerCase() ?? '';
  if (os.includes('ios') || os.includes('android')) return 'mobile';
  if (os.includes('server')) return 'server';
  if (os.includes('windows') || os.includes('mac') || os.includes('linux')) {
    return 'workstation';
  }
  return 'unknown';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
