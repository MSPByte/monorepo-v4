import { Queue, Worker } from "bullmq";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import type { ProjectionJobData } from "@mspbyte/pipeline";
import { orgQueueName, pipelineJobPriority, QUEUES } from "@mspbyte/pipeline";
import { canProcessOrg, env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import {
  completeProjectionStage,
  failProjectionStage,
  failProjectionRun,
  projectRawBatch,
  startProjectionStage,
} from "../db/project.js";
import { projectionSteps } from "../contracts/registry.js";
import { runProjectionSteps } from "../contracts/runner.js";

export function createProjectionWorker(
  redis: RedisConnection,
  queueName: string,
): Worker {
  return new Worker<ProjectionJobData, void, string>(
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
          `Org ${data.orgId} is not marked is_dev; projection is restricted to development orgs in ${env.RUNTIME_ENVIRONMENT}`,
        );
      }

      const db = tenant.db;
      const bullmqJobId = String(job.id ?? data.rawBatchId);
      const stageId = await startProjectionStage(db, {
        syncRunId: data.syncRunId,
        provider: data.provider,
        type: data.type,
        bullmqJobId,
      });

      logger.debug("Projection job started", {
        orgId: data.orgId,
        linkId: data.linkId,
        provider: data.provider,
        type: data.type,
        syncRunId: data.syncRunId,
        rawBatchId: data.rawBatchId,
        jobId: bullmqJobId,
      });

      let projectStageCompleted = false;
      try {
        const metrics = await projectRawBatch(db, data);
        await completeProjectionStage(db, stageId, metrics);
        projectStageCompleted = true;

        if (metrics.runStatus === "completed") {
          await runProjectionSteps(
            { db, ...data },
            projectionSteps,
            bullmqJobId,
          );
          await enqueueNormalizeJob(redis, data, bullmqJobId);
        }

        logger.info("Projection job completed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          rawBatchId: data.rawBatchId,
          ...metrics,
        });
      } catch (error) {
        if (projectStageCompleted) {
          await failProjectionRun(db, data.syncRunId, error);
        } else {
          await failProjectionStage(
            db,
            stageId,
            data.syncRunId,
            data.rawBatchId,
            error,
          );
        }
        logger.error("Projection job failed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          rawBatchId: data.rawBatchId,
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

async function enqueueNormalizeJob(
  redis: RedisConnection,
  data: ProjectionJobData,
  bullmqJobId: string,
): Promise<void> {
  const queueName = orgQueueName(QUEUES.NORMALIZE, data.orgId);
  const queue = new Queue(queueName, { connection: redis as never });
  const jobId = `normalize_${data.syncRunId}_${data.type}`;

  try {
    await queue.add("normalize", data, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      priority: pipelineJobPriority(data.provider),
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
    logger.info("Normalize job enqueued", {
      orgId: data.orgId,
      linkId: data.linkId,
      provider: data.provider,
      type: data.type,
      syncRunId: data.syncRunId,
      projectionJobId: bullmqJobId,
      normalizeJobId: jobId,
      queueName,
    });
  } finally {
    await queue.close();
  }
}
