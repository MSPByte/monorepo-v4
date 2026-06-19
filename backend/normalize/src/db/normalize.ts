import { and, eq, isNull, or, sql } from "drizzle-orm";
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
  syncRunStages,
} from "@mspbyte/drizzle";
import { ProviderFacet } from "@mspbyte/shared";

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

type ConfidenceLabel = "high" | "medium" | "low";
type SourceStatus = "candidate" | "confirmed" | "rejected" | "superseded";

const CONFIRMED_THRESHOLD = 85;

type AssetTable =
  | typeof m365Devices
  | typeof sophosEndpoints
  | typeof sophosFirewalls
  | typeof dattoEndpoints
  | typeof coveEndpoints;

type AssetInput = {
  vendorTable: string;
  canonicalType: "asset";
  row: {
    id: string;
    linkId: string;
    siteId: string | null;
    externalId: string;
    [key: string]: unknown;
  };
  displayName: string;
  hostname?: string;
  serialNumber?: string;
  os?: string;
  assetType: "workstation" | "server" | "network" | "mobile" | "unknown";
  status: "active" | "inactive" | "unknown";
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
  },
): Promise<string> {
  await db
    .update(syncRuns)
    .set({ status: "normalizing" })
    .where(eq(syncRuns.id, params.syncRunId));

  const [row] = await db
    .insert(syncRunStages)
    .values({
      syncRunId: params.syncRunId,
      integrationId: params.provider,
      bullmqJobId: params.bullmqJobId,
      type: params.type,
      stage: "normalize",
      status: "running",
      startedAt: new Date().toISOString(),
    })
    .returning({ id: syncRunStages.id });

  return row.id;
}

export async function completeNormalizeStage(
  db: Db,
  stageId: string,
  syncRunId: string,
  metrics: NormalizeMetrics,
): Promise<void> {
  await db
    .update(syncRunStages)
    .set({
      status: "completed",
      finishedAt: new Date().toISOString(),
      recordsIn: metrics.recordsIn,
      recordsOut: metrics.recordsOut,
      createdCt: metrics.canonicalCreatedCt + metrics.sourceCreatedCt,
      updatedCt: metrics.canonicalUpdatedCt + metrics.sourceUpdatedCt,
      failedCt: 0,
      metrics,
    })
    .where(eq(syncRunStages.id, stageId));

  await db
    .update(syncRuns)
    .set({
      status: "policy_pending",
    })
    .where(eq(syncRuns.id, syncRunId));
}

export async function failNormalizeStage(
  db: Db,
  stageId: string,
  syncRunId: string,
  error: unknown,
): Promise<void> {
  const message = errorMessage(error);
  await db
    .update(syncRunStages)
    .set({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: message,
    })
    .where(eq(syncRunStages.id, stageId));

  await db
    .update(syncRuns)
    .set({
      status: "normalize_failed",
      finishedAt: new Date().toISOString(),
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
  },
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
  params: { linkId: string; siteId?: string; provider: string; type: string },
): Promise<NormalizeMetrics> {
  const rows = await db
    .select()
    .from(m365Identities)
    .where(
      and(
        eq(m365Identities.linkId, params.linkId),
        isNull(m365Identities.deletedAt),
      ),
    );
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) {
      metrics.skippedCt++;
      continue;
    }

    const existingSource = await findSource(db, "m365_identities", row.id);
    const match = existingSource
      ? {
          canonicalId: existingSource.canonicalId,
          confidence: 100,
          method: "existing_source",
          evidence: { entitySourceId: existingSource.id },
        }
      : await matchPerson(db, row.siteId ?? params.siteId, email);
    const status: SourceStatus =
      match.confidence >= CONFIRMED_THRESHOLD ? "confirmed" : "candidate";
    if (match.canonicalId && status === "candidate") metrics.candidateCt++;

    let canonicalId = match.canonicalId;
    let canonicalCreated = false;
    if (!canonicalId || status !== "confirmed") {
      const created = await createPerson(db, {
        siteId: row.siteId ?? params.siteId,
        primaryEmail: email,
        displayName: row.name || email,
        status: row.enabled ? "active" : "inactive",
        sourceConfidence: "high",
        attributes: {
          m365: {
            linkId: params.linkId,
            externalId: row.externalId,
            email,
            displayName: row.name || email,
          },
        },
      });
      canonicalId = created.id;
      canonicalCreated = true;
    } else {
      await updatePerson(db, canonicalId, {
        displayName: row.name || email,
        status: row.enabled ? "active" : "inactive",
        sourceConfidence: confidenceLabel(match.confidence),
        attributes: {
          m365: {
            linkId: params.linkId,
            externalId: row.externalId,
            email,
            displayName: row.name || email,
          },
        },
      });
      metrics.canonicalUpdatedCt++;
    }

    if (canonicalCreated) metrics.canonicalCreatedCt++;
    const sourceResult = await upsertEntitySource(db, {
      canonicalType: "person",
      canonicalId,
      vendorTable: "m365_identities",
      vendorRecordId: row.id,
      linkId: params.linkId,
      siteId: row.siteId ?? params.siteId,
      provider: params.provider,
      type: params.type,
      externalId: row.externalId,
      confidence: canonicalCreated ? 100 : match.confidence,
      matchMethod: canonicalCreated
        ? "created_from_m365_identity"
        : match.method,
      matchEvidence: canonicalCreated
        ? { email, reason: "no confirmed existing person match" }
        : match.evidence,
      status: "confirmed",
    });
    if (sourceResult.created) metrics.sourceCreatedCt++;
    else metrics.sourceUpdatedCt++;
    metrics.recordsOut++;
  }

  return metrics;
}

async function normalizeM365Devices(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string },
): Promise<NormalizeMetrics> {
  const rows = await db
    .select()
    .from(m365Devices)
    .where(
      and(eq(m365Devices.linkId, params.linkId), isNull(m365Devices.deletedAt)),
    );
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  for (const row of rows) {
    const hostname = normalizeHostname(row.displayName);
    if (!hostname) {
      metrics.skippedCt++;
      continue;
    }

    const existingSource = await findSource(db, "m365_devices", row.id);
    const match = existingSource
      ? {
          canonicalId: existingSource.canonicalId,
          confidence: 100,
          method: "existing_source",
          evidence: { entitySourceId: existingSource.id },
        }
      : await matchAsset(db, {
          siteId: row.siteId ?? params.siteId,
          hostname,
        });
    const status: SourceStatus =
      match.confidence >= CONFIRMED_THRESHOLD ? "confirmed" : "candidate";
    if (match.canonicalId && status === "candidate") metrics.candidateCt++;

    let canonicalId = match.canonicalId;
    let canonicalCreated = false;
    if (!canonicalId || status !== "confirmed") {
      const created = await createAsset(db, {
        siteId: row.siteId ?? params.siteId,
        displayName: row.displayName,
        hostname,
        os: normalizeAssetOs(row.operatingSystem),
        assetType: assetTypeFromOperatingSystem(row.operatingSystem),
        status: row.isManaged === false ? "unknown" : "active",
        sourceConfidence: "medium",
        attributes: {
          m365: {
            linkId: params.linkId,
            externalId: row.externalId,
            hostname,
            displayName: row.displayName,
            os: normalizeAssetOs(row.operatingSystem),
          },
        },
      });
      canonicalId = created.id;
      canonicalCreated = true;
    } else {
      await updateAsset(db, canonicalId, {
        displayName: row.displayName,
        hostname,
        os: normalizeAssetOs(row.operatingSystem),
        assetType: assetTypeFromOperatingSystem(row.operatingSystem),
        status: row.isManaged === false ? "unknown" : "active",
        sourceConfidence: confidenceLabel(match.confidence),
        attributes: {
          m365: {
            linkId: params.linkId,
            externalId: row.externalId,
            hostname,
            displayName: row.displayName,
            os: normalizeAssetOs(row.operatingSystem),
          },
        },
      });
      metrics.canonicalUpdatedCt++;
    }

    if (canonicalCreated) metrics.canonicalCreatedCt++;
    const sourceResult = await upsertEntitySource(db, {
      canonicalType: "asset",
      canonicalId,
      vendorTable: "m365_devices",
      vendorRecordId: row.id,
      linkId: params.linkId,
      siteId: row.siteId ?? params.siteId,
      provider: params.provider,
      type: params.type,
      externalId: row.externalId,
      confidence: canonicalCreated ? 100 : match.confidence,
      matchMethod: canonicalCreated ? "created_from_m365_device" : match.method,
      matchEvidence: canonicalCreated
        ? { hostname, reason: "no confirmed existing asset match" }
        : match.evidence,
      status: "confirmed",
    });
    if (sourceResult.created) metrics.sourceCreatedCt++;
    else metrics.sourceUpdatedCt++;
    metrics.recordsOut++;
  }

  return metrics;
}

async function normalizeSophosEndpoints(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string },
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, sophosEndpoints, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  for (const row of rows) {
    await normalizeAsset(db, params, metrics, {
      vendorTable: "sophos_endpoints",
      canonicalType: "asset",
      row,
      displayName: row.hostname,
      hostname: row.hostname,
      os: normalizeAssetOs(row.osName),
      assetType: row.type === "server" ? "server" : "workstation",
      status: row.online ? "active" : "inactive",
      sourceConfidence: "high",
      attributes: {
        sophosEndpoint: {
          linkId: params.linkId,
          externalId: row.externalId,
          hostname: normalizeHostname(row.hostname),
          displayName: row.hostname,
          os: normalizeAssetOs(row.osName),
        },
      },
      createMatchMethod: "created_from_sophos_endpoint",
    });
  }

  return metrics;
}

async function normalizeSophosFirewalls(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string },
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, sophosFirewalls, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  for (const row of rows) {
    await normalizeAsset(db, params, metrics, {
      vendorTable: "sophos_firewalls",
      canonicalType: "asset",
      row,
      displayName:
        row.name || row.hostname || row.serialNumber || row.externalId,
      hostname: row.hostname,
      serialNumber: row.serialNumber,
      assetType: "network",
      status: row.suspended ? "inactive" : row.connected ? "active" : "unknown",
      sourceConfidence: "high",
      attributes: {
        sophosFirewall: {
          linkId: params.linkId,
          externalId: row.externalId,
          name: row.name,
          hostname: normalizeHostname(row.hostname),
          serialNumber: row.serialNumber,
        },
      },
      createMatchMethod: "created_from_sophos_firewall",
      allowHostnameMatch: false,
    });
  }

  return metrics;
}

async function normalizeDattoEndpoints(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string },
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, dattoEndpoints, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  for (const row of rows) {
    await normalizeAsset(db, params, metrics, {
      vendorTable: "datto_endpoints",
      canonicalType: "asset",
      row,
      displayName: row.hostname,
      hostname: row.hostname,
      os: normalizeAssetOs(row.os),
      assetType: row.category === "other" ? "unknown" : row.category,
      status: row.online ? "active" : "inactive",
      sourceConfidence: "high",
      attributes: {
        datto: {
          linkId: params.linkId,
          externalId: row.externalId,
          hostname: normalizeHostname(row.hostname),
          displayName: row.hostname,
          os: normalizeAssetOs(row.os),
        },
      },
      createMatchMethod: "created_from_datto_endpoint",
    });
  }

  return metrics;
}

async function normalizeCoveEndpoints(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string },
): Promise<NormalizeMetrics> {
  const rows = await activeVendorRows(db, coveEndpoints, params.linkId);
  const metrics = emptyMetrics();
  metrics.recordsIn = rows.length;

  for (const row of rows) {
    await normalizeAsset(db, params, metrics, {
      vendorTable: "cove_endpoints",
      canonicalType: "asset",
      row,
      displayName: row.endpointName || row.hostname || row.externalId,
      hostname: row.hostname || row.endpointName,
      os: undefined,
      assetType: row.type,
      status: row.status === "inactive" ? "inactive" : "active",
      sourceConfidence: "medium",
      attributes: {
        cove: {
          linkId: params.linkId,
          externalId: row.externalId,
          endpointName: row.endpointName,
          hostname: normalizeHostname(row.hostname || row.endpointName),
        },
      },
      createMatchMethod: "created_from_cove_endpoint",
    });
  }

  return metrics;
}

async function normalizeAsset(
  db: Db,
  params: { linkId: string; siteId?: string; provider: string; type: string },
  metrics: NormalizeMetrics,
  input: AssetInput,
): Promise<void> {
  const hostname = normalizeHostname(input.hostname);
  const serialNumber = normalizeSerial(input.serialNumber);

  if (!hostname && !serialNumber) {
    metrics.skippedCt++;
    return;
  }

  const siteId = input.row.siteId ?? params.siteId;
  const existingSource = await findSource(db, input.vendorTable, input.row.id);
  const match = existingSource
    ? {
        canonicalId: existingSource.canonicalId,
        confidence: 100,
        method: "existing_source",
        evidence: { entitySourceId: existingSource.id },
      }
    : await matchAsset(db, {
        siteId,
        hostname,
        serialNumber,
        allowHostnameMatch: input.allowHostnameMatch !== false,
      });
  const status: SourceStatus =
    match.confidence >= CONFIRMED_THRESHOLD ? "confirmed" : "candidate";
  if (match.canonicalId && status === "candidate") metrics.candidateCt++;

  let canonicalId = match.canonicalId;
  let canonicalCreated = false;
  if (!canonicalId || status !== "confirmed") {
    const created = await createAsset(db, {
      siteId,
      displayName: input.displayName,
      hostname,
      serialNumber,
      os: input.os,
      assetType: input.assetType,
      status: input.status,
      sourceConfidence: input.sourceConfidence,
      attributes: input.attributes,
    });
    canonicalId = created.id;
    canonicalCreated = true;
  } else {
    await updateAsset(db, canonicalId, {
      displayName: input.displayName,
      hostname,
      serialNumber,
      os: input.os,
      assetType: input.assetType,
      status: input.status,
      sourceConfidence: confidenceLabel(match.confidence),
      attributes: input.attributes,
    });
    metrics.canonicalUpdatedCt++;
  }

  if (canonicalCreated) metrics.canonicalCreatedCt++;
  const sourceResult = await upsertEntitySource(db, {
    canonicalType: input.canonicalType,
    canonicalId,
    vendorTable: input.vendorTable,
    vendorRecordId: input.row.id,
    linkId: params.linkId,
    siteId,
    provider: params.provider,
    type: params.type,
    externalId: input.row.externalId,
    confidence: canonicalCreated ? 100 : match.confidence,
    matchMethod: canonicalCreated ? input.createMatchMethod : match.method,
    matchEvidence: canonicalCreated
      ? {
          hostname,
          serialNumber,
          reason: "no confirmed existing asset match",
        }
      : match.evidence,
    status: "confirmed",
  });
  if (sourceResult.created) metrics.sourceCreatedCt++;
  else metrics.sourceUpdatedCt++;
  metrics.recordsOut++;
}

async function activeVendorRows(
  db: Db,
  table: AssetTable,
  linkId: string,
): Promise<Array<any>> {
  return db
    .select()
    .from(table)
    .where(and(eq(table.linkId, linkId), isNull(table.deletedAt)));
}

async function findSource(db: Db, vendorTable: string, vendorRecordId: string) {
  const [row] = await db
    .select({
      id: entitySources.id,
      canonicalId: entitySources.canonicalId,
      status: entitySources.status,
    })
    .from(entitySources)
    .where(
      and(
        eq(entitySources.vendorTable, vendorTable),
        eq(entitySources.vendorRecordId, vendorRecordId),
      ),
    )
    .limit(1);

  return row?.status === "confirmed" ? row : undefined;
}

async function matchPerson(db: Db, siteId: string | undefined, email: string) {
  const [row] = await db
    .select({ id: people.id, siteId: people.siteId })
    .from(people)
    .where(
      siteId
        ? and(
            eq(people.primaryEmail, email),
            or(eq(people.siteId, siteId), isNull(people.siteId)),
          )
        : eq(people.primaryEmail, email),
    )
    .limit(1);

  if (!row) {
    return {
      canonicalId: undefined,
      confidence: 0,
      method: "no_match",
      evidence: { email },
    };
  }

  return {
    canonicalId: row.id,
    confidence: row.siteId === siteId ? 95 : 90,
    method: row.siteId === siteId ? "site_email" : "email",
    evidence: { email, siteId },
  };
}

async function matchAsset(
  db: Db,
  options: {
    siteId: string | undefined;
    hostname?: string;
    serialNumber?: string;
    allowHostnameMatch?: boolean;
  },
) {
  const { siteId, hostname, serialNumber } = options;
  const allowHostnameMatch = options.allowHostnameMatch !== false;
  if (serialNumber) {
    const [row] = await db
      .select({
        id: assets.id,
        siteId: assets.siteId,
        serialNumber: assets.serialNumber,
      })
      .from(assets)
      .where(
        siteId
          ? and(
              eq(assets.serialNumber, serialNumber),
              or(eq(assets.siteId, siteId), isNull(assets.siteId)),
            )
          : eq(assets.serialNumber, serialNumber),
      )
      .limit(1);

    if (row) {
      return {
        canonicalId: row.id,
        confidence: row.siteId === siteId ? 98 : 93,
        method: "serial_number",
        evidence: { serialNumber, siteId },
      };
    }
  }

  if (!hostname || !allowHostnameMatch) {
    return {
      canonicalId: undefined,
      confidence: 0,
      method: "no_match",
      evidence: { hostname, serialNumber },
    };
  }

  const [row] = await db
    .select({
      id: assets.id,
      siteId: assets.siteId,
      hostname: assets.hostname,
      displayName: assets.displayName,
    })
    .from(assets)
    .where(
      siteId
        ? and(
            or(
              eq(assets.hostname, hostname),
              eq(sql`lower(${assets.displayName})`, hostname),
            ),
            or(eq(assets.siteId, siteId), isNull(assets.siteId)),
          )
        : or(
            eq(assets.hostname, hostname),
            eq(sql`lower(${assets.displayName})`, hostname),
          ),
    )
    .limit(1);

  if (!row) {
    return {
      canonicalId: undefined,
      confidence: 0,
      method: "no_match",
      evidence: { hostname, serialNumber },
    };
  }

  return {
    canonicalId: row.id,
    confidence: row.siteId === siteId ? 90 : 85,
    method: row.hostname === hostname ? "hostname" : "display_name",
    evidence: { hostname, serialNumber, siteId },
  };
}

async function createPerson(db: Db, values: typeof people.$inferInsert) {
  const [row] = await db
    .insert(people)
    .values(values)
    .returning({ id: people.id });
  return row;
}

async function updatePerson(
  db: Db,
  id: string,
  values: Partial<typeof people.$inferInsert>,
): Promise<void> {
  if (values.attributes) {
    values.attributes = await mergePersonAttributes(db, id, values.attributes);
  }
  await db
    .update(people)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(people.id, id));
}

async function createAsset(db: Db, values: typeof assets.$inferInsert) {
  const [row] = await db
    .insert(assets)
    .values(values)
    .returning({ id: assets.id });
  return row;
}

async function updateAsset(
  db: Db,
  id: string,
  values: Partial<typeof assets.$inferInsert>,
): Promise<void> {
  if (values.attributes) {
    values.attributes = await mergeAssetAttributes(db, id, values.attributes);
  }
  await db
    .update(assets)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(assets.id, id));
}

async function upsertEntitySource(
  db: Db,
  values: typeof entitySources.$inferInsert,
): Promise<{ created: boolean }> {
  const now = new Date().toISOString();
  const returned = await db
    .insert(entitySources)
    .values({ ...values, updatedAt: now })
    .onConflictDoUpdate({
      target: [entitySources.vendorTable, entitySources.vendorRecordId],
      set: {
        canonicalType: values.canonicalType,
        canonicalId: values.canonicalId,
        linkId: values.linkId,
        siteId: values.siteId,
        provider: values.provider,
        type: values.type,
        externalId: values.externalId,
        confidence: values.confidence,
        matchMethod: values.matchMethod,
        matchEvidence: values.matchEvidence,
        status: values.status,
        updatedAt: now,
      },
    })
    .returning({ xmax: sql<string>`xmax::text` });

  return { created: returned[0]?.xmax === "0" };
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
    skippedCt: 0,
  };
}

async function mergePersonAttributes(
  db: Db,
  id: string,
  incoming: unknown,
): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ attributes: people.attributes })
    .from(people)
    .where(eq(people.id, id))
    .limit(1);
  return mergeRecord(row?.attributes, incoming);
}

async function mergeAssetAttributes(
  db: Db,
  id: string,
  incoming: unknown,
): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ attributes: assets.attributes })
    .from(assets)
    .where(eq(assets.id, id))
    .limit(1);
  return mergeRecord(row?.attributes, incoming);
}

function mergeRecord(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  return {
    ...(isRecord(existing) ? existing : {}),
    ...(isRecord(incoming) ? incoming : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && email.includes("@") ? email : undefined;
}

function normalizeHostname(
  value: string | null | undefined,
): string | undefined {
  const hostname = value?.trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return undefined;
  return hostname.includes(".") ? hostname.split(".")[0] : hostname;
}

function normalizeSerial(value: string | null | undefined): string | undefined {
  const serial = value?.trim().toLowerCase();
  return serial || undefined;
}

function normalizeAssetOs(
  value: string | null | undefined,
): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  const compact = raw.replace(/\s+/g, " ");
  const lower = compact.toLowerCase();

  if (lower.includes("windows")) {
    const server = lower.includes("server") ? " Server" : "";
    const version =
      lower.match(
        /\b(11|10|8\.1|8|7|2025|2022|2019|2016|2012 r2|2012)\b/,
      )?.[1] ?? undefined;
    return version ? `Windows${server} ${version}` : `Windows${server}`.trim();
  }

  if (
    lower.includes("mac os") ||
    lower.includes("macos") ||
    lower.includes("os x")
  ) {
    return "macOS";
  }

  if (lower.includes("ubuntu")) return "Ubuntu Linux";
  if (lower.includes("debian")) return "Debian Linux";
  if (lower.includes("red hat") || lower.includes("rhel"))
    return "Red Hat Enterprise Linux";
  if (lower.includes("centos")) return "CentOS Linux";
  if (lower.includes("linux")) return "Linux";
  if (lower.includes("android")) return "Android";
  if (lower === "ios" || lower.includes("iphone") || lower.includes("ipad"))
    return "iOS";

  return compact;
}

function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 90) return "high";
  if (confidence >= 70) return "medium";
  return "low";
}

function assetTypeFromOperatingSystem(
  value: string | null | undefined,
): "workstation" | "server" | "network" | "mobile" | "unknown" {
  const os = value?.toLowerCase() ?? "";
  if (os.includes("ios") || os.includes("android")) return "mobile";
  if (os.includes("server")) return "server";
  if (os.includes("windows") || os.includes("mac") || os.includes("linux")) {
    return "workstation";
  }
  return "unknown";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
