import { and, count, eq } from "drizzle-orm";
import { rawRecords } from "@mspbyte/drizzle";
import { replayFailedRecords } from "ingestion/replay";
import type { HealthCheckContext, HealthReport } from "./index.js";

/**
 * Reports and (with --fix) replays projection dead-letter records. Fast path:
 * a single COUNT query per tenant; only opens the replay path when there's
 * work to do.
 */
export async function checkDeadLetter(ctx: HealthCheckContext): Promise<HealthReport> {
  const db = ctx.tenantDb as any;

  const [countRow] = await db
    .select({ n: count() })
    .from(rawRecords)
    .where(eq(rawRecords.projectionStatus, "failed"));
  const total = Number(countRow?.n ?? 0);

  if (total === 0) {
    return { check: "dead-letter", status: "ok", details: "no failed records" };
  }

  if (!ctx.fix) {
    return {
      check: "dead-letter",
      status: "issues",
      details: `${total} failed record(s) awaiting replay`,
      metrics: { failed: total },
    };
  }

  const result = await replayFailedRecords(db);
  const notes = result.notes.length > 0 ? ` — ${result.notes.slice(0, 3).join("; ")}` : "";
  return {
    check: "dead-letter",
    status: result.stillFailed === 0 ? "fixed" : "issues",
    details: `${result.recovered}/${result.attempted} recovered, ${result.stillFailed} still failing${notes}`,
    metrics: {
      attempted: result.attempted,
      recovered: result.recovered,
      stillFailed: result.stillFailed,
    },
  };
}
