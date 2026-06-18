import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  assets,
  entitySources,
  m365Devices,
  m365Identities,
  people,
  syncRuns,
  syncRunStages,
} from "@mspbyte/drizzle";

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
      status: "completed",
      finishedAt: new Date().toISOString(),
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
  if (!["m365", "microsoft-365"].includes(params.provider)) {
    return emptyMetrics();
  }

  switch (params.type) {
    case "m365_identities":
    case "identities":
    case "identity":
    case "m365Identities":
      return normalizeM365Identities(db, params);
    case "m365_devices":
    case "devices":
    case "m365Devices":
      return normalizeM365Devices(db, params);
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
            externalId: row.externalId,
            type: row.type,
            mfaEnforced: row.mfaEnforced,
            assignedLicenses: row.assignedLicenses ?? [],
            lastSignInAt: row.lastSignInAt,
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
            externalId: row.externalId,
            type: row.type,
            mfaEnforced: row.mfaEnforced,
            assignedLicenses: row.assignedLicenses ?? [],
            lastSignInAt: row.lastSignInAt,
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
      : await matchAsset(db, row.siteId ?? params.siteId, hostname);
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
        assetType: assetTypeFromOperatingSystem(row.operatingSystem),
        status: row.isManaged === false ? "unknown" : "active",
        sourceConfidence: "medium",
        attributes: {
          m365: {
            externalId: row.externalId,
            operatingSystem: row.operatingSystem,
            operatingSystemVersion: row.operatingSystemVersion,
            isCompliant: row.isCompliant,
            isManaged: row.isManaged,
            deviceOwnership: row.deviceOwnership,
            approximateLastSignInAt: row.approximateLastSignInAt,
          },
        },
      });
      canonicalId = created.id;
      canonicalCreated = true;
    } else {
      await updateAsset(db, canonicalId, {
        displayName: row.displayName,
        hostname,
        assetType: assetTypeFromOperatingSystem(row.operatingSystem),
        status: row.isManaged === false ? "unknown" : "active",
        sourceConfidence: confidenceLabel(match.confidence),
        attributes: {
          m365: {
            externalId: row.externalId,
            operatingSystem: row.operatingSystem,
            operatingSystemVersion: row.operatingSystemVersion,
            isCompliant: row.isCompliant,
            isManaged: row.isManaged,
            deviceOwnership: row.deviceOwnership,
            approximateLastSignInAt: row.approximateLastSignInAt,
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
  siteId: string | undefined,
  hostname: string,
) {
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
      evidence: { hostname },
    };
  }

  return {
    canonicalId: row.id,
    confidence: row.siteId === siteId ? 90 : 85,
    method: row.hostname === hostname ? "hostname" : "display_name",
    evidence: { hostname, siteId },
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

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && email.includes("@") ? email : undefined;
}

function normalizeHostname(
  value: string | null | undefined,
): string | undefined {
  const hostname = value?.trim().toLowerCase();
  return hostname || undefined;
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
