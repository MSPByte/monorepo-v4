import { and, eq, inArray } from "drizzle-orm";
import { rawRecords } from "@mspbyte/drizzle";
import { projectBatch, type ProjectBatchFailure } from "./project.js";
import { markRecordRecovered } from "./dead-letter.js";
import { logger } from "../logger.js";

type Db = any;

export type ReplayFilter = {
  linkId?: string;
  provider?: string;
  type?: string;
  limit?: number;
};

export type ReplayResult = {
  attempted: number;
  recovered: number;
  stillFailed: number;
  notes: string[];
};

/**
 * Re-runs projection on dead-lettered raw records. Groups by (linkId, type)
 * so each group hits projectBatch once with the same shape a live sync would
 * produce. On per-record success we mark that raw_record recovered; on
 * per-record failure we leave the row in place (with an updated error) so a
 * subsequent replay can try again after the next code fix.
 *
 * Whole-group exceptions (e.g. DB error) surface to the caller — the script
 * shows them per group and continues to the next.
 */
export async function replayFailedRecords(
  db: Db,
  filter: ReplayFilter = {},
): Promise<ReplayResult> {
  const conditions = [eq(rawRecords.projectionStatus, "failed")];
  if (filter.linkId) conditions.push(eq(rawRecords.linkId, filter.linkId));
  if (filter.provider) conditions.push(eq(rawRecords.provider, filter.provider));
  if (filter.type) conditions.push(eq(rawRecords.type, filter.type));

  const query = db
    .select({
      id: rawRecords.id,
      linkId: rawRecords.linkId,
      siteId: rawRecords.siteId,
      provider: rawRecords.provider,
      type: rawRecords.type,
      externalId: rawRecords.externalId,
      op: rawRecords.op,
      payload: rawRecords.payload,
      syncRunId: rawRecords.syncRunId,
    })
    .from(rawRecords)
    .where(and(...conditions))
    .orderBy(rawRecords.linkId, rawRecords.type, rawRecords.createdAt);

  const rows: Array<{
    id: string;
    linkId: string;
    siteId: string | null;
    provider: string;
    type: string;
    externalId: string;
    op: string;
    payload: unknown;
    syncRunId: string;
  }> = filter.limit ? await query.limit(filter.limit) : await query;

  if (rows.length === 0) {
    return { attempted: 0, recovered: 0, stillFailed: 0, notes: [] };
  }

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.linkId}::${row.type}`;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  let attempted = 0;
  let recovered = 0;
  let stillFailed = 0;
  const notes: string[] = [];

  for (const group of groups.values()) {
    const first = group[0]!;
    const envelopes = group.map((r) => ({
      externalId: r.externalId,
      op: (r.op === "delete" ? "delete" : "upsert") as "upsert" | "delete",
      payload: r.payload,
    }));

    let metrics;
    try {
      metrics = await projectBatch(
        db,
        {
          orgId: "replay",
          linkId: first.linkId,
          siteId: first.siteId ?? undefined,
          provider: first.provider,
          type: first.type,
          syncRunId: first.syncRunId,
          mode: "full",
          batchIndex: -1,
        },
        envelopes,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`${first.provider}/${first.type} link=${first.linkId} — group error: ${message}`);
      stillFailed += group.length;
      attempted += group.length;
      continue;
    }

    attempted += group.length;

    const failedExternalIds = new Set(metrics.failures.map((f: ProjectBatchFailure) => f.externalId));
    const recoveredIds: string[] = [];
    const stillFailedRows: Array<{ id: string; error: string }> = [];

    for (const row of group) {
      if (failedExternalIds.has(row.externalId)) {
        const failure = metrics.failures.find((f: ProjectBatchFailure) => f.externalId === row.externalId);
        const message = failure ? errorMessage(failure.error) : "unknown";
        stillFailedRows.push({ id: row.id, error: message });
      } else {
        recoveredIds.push(row.id);
      }
    }

    if (recoveredIds.length > 0) {
      await Promise.all(recoveredIds.map((id) => markRecordRecovered(db, id)));
      recovered += recoveredIds.length;
    }

    if (stillFailedRows.length > 0) {
      // Update the projection error on rows that still fail, so operators
      // see the current failure reason rather than the original one.
      await Promise.all(
        stillFailedRows.map((entry) =>
          db
            .update(rawRecords)
            .set({
              projectionError: entry.error,
              projectedAt: new Date().toISOString(),
            })
            .where(eq(rawRecords.id, entry.id)),
        ),
      );
      stillFailed += stillFailedRows.length;
    }
  }

  if (recovered > 0 || stillFailed > 0) {
    logger.info("Dead-letter replay completed", {
      filter,
      attempted,
      recovered,
      stillFailed,
    });
  }

  return { attempted, recovered, stillFailed, notes };
}

// Keep for potential future use if callers want to mark rows manually.
export { inArray };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
