import { Worker } from "bullmq";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import type { ProjectionJobData } from "@mspbyte/pipeline";
import { canProcessOrg, env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import {
  completeProjectionStage,
  failProjectionStage,
  projectRawBatch,
  startProjectionStage,
} from "../db/project.js";

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

      try {
        const metrics = await projectRawBatch(db, data);
        await completeProjectionStage(db, stageId, metrics);

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
        await failProjectionStage(db, stageId, data.rawBatchId, error);
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
