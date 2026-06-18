import { Queue, Worker } from "bullmq";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import {
  assertBullMqName,
  orgQueueName,
  QUEUES,
  type IngestionJobData,
  type ProjectionJobData,
} from "@mspbyte/pipeline";
import { canProcessOrg, env, requireEncryptionKey } from "../env.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import { getAdapter } from "../adapters/registry.js";
import {
  completeStage,
  createRawBatch,
  failRun,
  failStage,
  insertRawRecords,
  markRunIngested,
  recordFetchFailure,
  recordFetchSuccess,
  startStage,
} from "../db/stages.js";
import { serializeError } from "../errors.js";

export function createIngestionWorker(
  redis: RedisConnection,
  queueName: string,
): Worker {
  const projectionQueues = new Map<
    string,
    Queue<ProjectionJobData, unknown, string>
  >();

  function getProjectionQueue(
    orgId: string,
  ): Queue<ProjectionJobData, unknown, string> {
    const name = orgQueueName(QUEUES.PROJECT, orgId);
    const existing = projectionQueues.get(name);
    if (existing) return existing;

    const queue = new Queue<ProjectionJobData, unknown, string>(name, {
      connection: redis as never,
    });
    projectionQueues.set(name, queue);
    return queue;
  }

  return new Worker<IngestionJobData, void, string>(
    queueName,
    async (job) => {
      const data = job.data;
      const adapter = getAdapter(data.provider);
      const tenant = await getTenantServiceDbByOrgId(
        data.orgId,
        requireEncryptionKey(),
        env.CATALOG_DATABASE_URL,
      );
      if (!canProcessOrg(tenant.org)) {
        throw new Error(
          `Org ${data.orgId} is not marked is_dev; ingestion is restricted to development orgs in ${env.RUNTIME_ENVIRONMENT}`,
        );
      }

      const db = tenant.db;
      const bullmqJobId = String(job.id ?? data.syncRunId);
      let stageId: string | undefined;
      let batchIndex = 0;
      let recordCount = 0;
      let nextCursor: string | undefined;

      logger.info("Ingestion job started", {
        orgId: data.orgId,
        linkId: data.linkId,
        provider: data.provider,
        type: data.type,
        mode: data.mode,
        syncRunId: data.syncRunId,
        jobId: bullmqJobId,
      });

      try {
        stageId = await startStage(db, {
          syncRunId: data.syncRunId,
          integrationId: data.integrationId,
          bullmqJobId,
          type: data.type,
          stage: "ingest",
        });

        const pages = adapter.fetch(data.type, data.mode, data.cursor, {
          orgId: data.orgId,
          linkId: data.linkId,
          linkMeta: data.linkMeta,
          integrationConfig: data.integrationConfig,
          tenantDb: db,
        });

        while (true) {
          const result = await pages.next();
          if (result.done) {
            nextCursor =
              typeof result.value === "string" ? result.value : undefined;
            break;
          }

          const page = result.value;
          const batches = chunk(page.records, env.RAW_BATCH_SIZE);

          for (const records of batches) {
            const rawBatchId = await createRawBatch(db, {
              syncRunId: data.syncRunId,
              linkId: data.linkId,
              siteId: data.siteId,
              provider: data.provider,
              type: data.type,
              mode: data.mode,
              batchIndex,
              recordCount: records.length,
              cursorIn: page.cursorIn,
              cursorOut: page.cursorOut,
            });

            await insertRawRecords(db, {
              rawBatchId,
              syncRunId: data.syncRunId,
              linkId: data.linkId,
              siteId: data.siteId,
              provider: data.provider,
              type: data.type,
              records,
            });

            const projectQueue = getProjectionQueue(data.orgId);
            await projectQueue.add(
              assertBullMqName(
                `project_${data.provider}_${data.type}_${data.syncRunId}_${batchIndex}`,
                "BullMQ job name",
              ),
              {
                orgId: data.orgId,
                linkId: data.linkId,
                siteId: data.siteId,
                provider: data.provider,
                type: data.type,
                syncRunId: data.syncRunId,
                rawBatchId,
              },
              {
                jobId: assertBullMqName(
                  `project_${rawBatchId}`,
                  "BullMQ job id",
                ),
                attempts: 3,
                backoff: { type: "exponential", delay: 5_000 },
                removeOnComplete: 100,
                removeOnFail: 500,
              },
            );

            recordCount += records.length;
            batchIndex++;
          }
        }

        await completeStage(db, stageId, {
          recordsOut: recordCount,
          metrics: { batches: batchIndex, nextCursor },
        });
        await recordFetchSuccess(db, {
          linkId: data.linkId,
          integrationId: data.integrationId,
          type: data.type,
          mode: data.mode,
          cursor: nextCursor,
        });
        await markRunIngested(db, data.syncRunId);

        logger.info("Ingestion job completed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          records: recordCount,
          batches: batchIndex,
        });
      } catch (error) {
        if (stageId) await failStage(db, stageId, error);
        await recordFetchFailure(db, {
          linkId: data.linkId,
          integrationId: data.integrationId,
          type: data.type,
          error,
        });
        await failRun(db, data.syncRunId, error);

        logger.error("Ingestion job failed", {
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
