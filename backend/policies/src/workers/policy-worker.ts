import { Worker } from "bullmq";
import { integrationLinkSiteAssignments } from "@mspbyte/drizzle";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import { eq } from "drizzle-orm";
import type { PolicyJobData } from "@mspbyte/pipeline";
import { env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import {
  completePolicyStage,
  evaluatePolicies,
  failPolicyStage,
  startPolicyStage,
} from "../db/policies.js";
import { evaluateFactRules } from "../db/fact-rules.js";

export function createPolicyWorker(
  redis: RedisConnection,
  queueName: string,
): Worker {
  return new Worker<PolicyJobData, void, string>(
    queueName,
    async (job) => {
      const data = job.data;
      const tenant = await getTenantServiceDbByOrgId(
        data.orgId,
        requireEncryptionKey(),
        env.CATALOG_DATABASE_URL,
      );

      const db = tenant.db;
      const bullmqJobId = String(job.id ?? data.syncRunId);
      const stageId = await startPolicyStage(db, {
        syncRunId: data.syncRunId,
        provider: data.provider,
        type: data.type,
        bullmqJobId,
      });

      logger.debug("Policy job started", {
        orgId: data.orgId,
        linkId: data.linkId,
        provider: data.provider,
        type: data.type,
        syncRunId: data.syncRunId,
        jobId: bullmqJobId,
      });

      try {
        const assignedSiteIds = data.provider === "microsoft-365" && !data.siteId
          ? (await db
              .select({ siteId: integrationLinkSiteAssignments.siteId })
              .from(integrationLinkSiteAssignments)
              .where(eq(integrationLinkSiteAssignments.linkId, data.linkId)))
              .map((assignment: { siteId: string }) => assignment.siteId)
          : [];
        const evaluationTargets = assignedSiteIds.length
          ? assignedSiteIds.map((siteId: string) => ({ ...data, siteId }))
          : [data];
        // This is intentionally serial: it adds no provider/API calls, avoids
        // a burst of duplicate tenant-table reads, and keeps a large tenant's
        // policy job within one predictable DB-work stream.
        const metrics = { assignmentsEvaluated: 0, policiesEvaluated: 0, findingsOpen: 0, findingsResolved: 0, failedCt: 0 };
        for (const target of evaluationTargets) {
          const current = await evaluatePolicies(db, target);
          await evaluateFactRules(db, target);
          metrics.assignmentsEvaluated += current.assignmentsEvaluated;
          metrics.policiesEvaluated += current.policiesEvaluated;
          metrics.findingsOpen += current.findingsOpen;
          metrics.findingsResolved += current.findingsResolved;
          metrics.failedCt += current.failedCt;
        }
        await completePolicyStage(db, stageId, data.syncRunId, metrics);

        logger.info("Policy job completed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          ...metrics,
        });
      } catch (error) {
        await failPolicyStage(db, stageId, data.syncRunId, error);
        logger.error("Policy job failed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          error: serializeError(error),
        });
        throw error;
      }
    },
    {
      connection: redis as never,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: env.WORKER_LOCK_DURATION_MS,
    },
  );
}
