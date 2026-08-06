import { and, isNull, lt } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { packageRuns, packageRunSteps } from "@mspbyte/drizzle";
import { getCapability } from "@mspbyte/capabilities";
import { logger } from "../logger.js";
import { serializeError } from "../errors.js";

// Nulls out sensitive fields on package_run_steps whose parent package_runs
// row has passed its 48h retention window. The row itself and non-sensitive
// data remain forever — only the encrypted-at-rest secrets are dropped.
export async function purgeExpiredSensitiveOutputs(
  db: any,
  orgId: string,
  batchSize = 500,
): Promise<{ runsPurged: number; stepsMutated: number }> {
  const expired = await db
    .select({ id: packageRuns.id })
    .from(packageRuns)
    .where(
      and(
        lt(packageRuns.outputsExpiresAt, new Date().toISOString()),
        isNull(packageRuns.sensitiveOutputsPurgedAt),
      ),
    )
    .limit(batchSize);

  if (expired.length === 0) return { runsPurged: 0, stepsMutated: 0 };

  let stepsMutated = 0;
  for (const run of expired as Array<{ id: string }>) {
    try {
      const steps = await db
        .select()
        .from(packageRunSteps)
        .where(eq(packageRunSteps.packageRunId, run.id));

      for (const step of steps as Array<{
        id: string;
        capabilityId: string;
        outputs: unknown;
        resolvedInputs: unknown;
      }>) {
        const capability = getCapability(step.capabilityId);
        if (!capability) continue;

        const outputs = { ...((step.outputs ?? {}) as Record<string, unknown>) };
        const resolvedInputs = {
          ...((step.resolvedInputs ?? {}) as Record<string, unknown>),
        };
        let changed = false;
        for (const [key, meta] of Object.entries(capability.outputMeta)) {
          if (meta.sensitive && outputs[key] != null) {
            outputs[key] = null;
            changed = true;
          }
        }
        for (const [key, meta] of Object.entries(capability.inputMeta)) {
          if (meta.sensitive && resolvedInputs[key] != null) {
            resolvedInputs[key] = null;
            changed = true;
          }
        }
        if (!changed) continue;
        await db
          .update(packageRunSteps)
          .set({ outputs, resolvedInputs })
          .where(eq(packageRunSteps.id, step.id));
        stepsMutated++;
      }

      await db
        .update(packageRuns)
        .set({ sensitiveOutputsPurgedAt: new Date().toISOString() })
        .where(eq(packageRuns.id, run.id));
    } catch (err) {
      logger.error("Failed to purge sensitive outputs for run", {
        orgId,
        packageRunId: run.id,
        error: serializeError(err),
      });
    }
  }

  return { runsPurged: expired.length, stepsMutated };
}
