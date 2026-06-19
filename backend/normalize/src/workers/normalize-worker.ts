import { Queue, Worker } from "bullmq";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import type { NormalizeJobData, PolicyJobData } from "@mspbyte/pipeline";
import { orgQueueName, QUEUES } from "@mspbyte/pipeline";
import { canProcessOrg, env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import {
  completeNormalizeStage,
  failNormalizeStage,
  normalizeProjectedRun,
  startNormalizeStage,
} from "../db/normalize.js";

export function createNormalizeWorker(
  redis: RedisConnection,
  queueName: string,
): Worker {
  return new Worker<NormalizeJobData, void, string>(
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
          `Org ${data.orgId} is not marked is_dev; normalize is restricted to development orgs in ${env.RUNTIME_ENVIRONMENT}`,
        );
      }

      const db = tenant.db;
      const bullmqJobId = String(job.id ?? data.syncRunId);
      const stageId = await startNormalizeStage(db, {
        syncRunId: data.syncRunId,
        provider: data.provider,
        type: data.type,
        bullmqJobId,
      });

      logger.debug("Normalize job started", {
        orgId: data.orgId,
        linkId: data.linkId,
        provider: data.provider,
        type: data.type,
        syncRunId: data.syncRunId,
        jobId: bullmqJobId,
      });

      try {
        const metrics = await normalizeProjectedRun(db, data);
        await enqueuePolicyJob(redis, data, bullmqJobId);
        await completeNormalizeStage(db, stageId, data.syncRunId, metrics);

        logger.info("Normalize job completed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          ...metrics,
        });
      } catch (error) {
        await failNormalizeStage(db, stageId, data.syncRunId, error);
        logger.error("Normalize job failed", {
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

async function enqueuePolicyJob(
  redis: RedisConnection,
  data: NormalizeJobData,
  bullmqJobId: string,
): Promise<void> {
  const queueName = orgQueueName(QUEUES.POLICY, data.orgId);
  const queue = new Queue<PolicyJobData, unknown, string>(queueName, {
    connection: redis as never,
  });
  const jobId = `policy_${data.syncRunId}_${data.type}`;

  try {
    await queue.add("policy", data, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
    logger.info("Policy job enqueued", {
      orgId: data.orgId,
      linkId: data.linkId,
      provider: data.provider,
      type: data.type,
      syncRunId: data.syncRunId,
      normalizeJobId: bullmqJobId,
      policyJobId: jobId,
      queueName,
    });
  } finally {
    await queue.close();
  }
}
