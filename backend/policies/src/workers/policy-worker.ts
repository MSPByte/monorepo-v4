import { Worker } from "bullmq";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import type { PolicyJobData } from "@mspbyte/pipeline";
import { canProcessOrg, env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import {
  completePolicyStage,
  evaluatePolicies,
  failPolicyStage,
  startPolicyStage,
} from "../db/policies.js";

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
      if (!canProcessOrg(tenant.org)) {
        throw new Error(
          `Org ${data.orgId} is not marked is_dev; policy is restricted to development orgs in ${env.RUNTIME_ENVIRONMENT}`,
        );
      }

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
        const metrics = await evaluatePolicies(db, data);
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
    },
  );
}
