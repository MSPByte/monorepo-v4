import { Queue, UnrecoverableError, Worker } from "bullmq";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import { syncRuns } from "@mspbyte/drizzle";
import { eq } from "drizzle-orm";
import {
  assertBullMqName,
  orgQueueName,
  pipelineJobPriority,
  QUEUES,
  type IngestionJobData,
  type NormalizeJobData,
} from "@mspbyte/pipeline";
import { env, requireEncryptionKey } from "../env.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import { getAdapter } from "../adapters/registry.js";
import {
  completeRun,
  completeStage,
  failRun,
  failStage,
  recordFetchFailure,
  recordFetchSuccess,
  startStage,
} from "../db/stages.js";
import { projectBatch } from "../db/project.js";
import { projectionSteps } from "../contracts/registry.js";
import { runProjectionSteps } from "../contracts/runner.js";
import { serializeError } from "../errors.js";

export function createIngestionWorker(
  redis: RedisConnection,
  queueName: string,
): Worker {
  const normalizeQueues = new Map<
    string,
    Queue<NormalizeJobData, unknown, string>
  >();

  function getNormalizeQueue(
    orgId: string,
  ): Queue<NormalizeJobData, unknown, string> {
    const name = orgQueueName(QUEUES.NORMALIZE, orgId);
    const existing = normalizeQueues.get(name);
    if (existing) return existing;

    const queue = new Queue<NormalizeJobData, unknown, string>(name, {
      connection: redis as never,
    });
    normalizeQueues.set(name, queue);
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

      const db = tenant.db;
      const bullmqJobId = String(job.id ?? data.syncRunId);
      let ingestStageId: string | undefined;
      let projectStageId: string | undefined;
      let batchIndex = 0;
      let recordsIn = 0;
      const projectTotals = {
        recordsOut: 0,
        createdCt: 0,
        updatedCt: 0,
        failedCt: 0,
      };
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

      const [syncRun] = await db
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(eq(syncRuns.id, data.syncRunId))
        .limit(1);
      if (!syncRun) {
        logger.warn("Discarding orphaned ingestion job because sync run is missing", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          jobId: bullmqJobId,
        });
        throw new UnrecoverableError(
          `Ingestion sync run ${data.syncRunId} is missing for job ${bullmqJobId}`,
        );
      }

      try {
        ingestStageId = await startStage(db, {
          syncRunId: data.syncRunId,
          integrationId: data.integrationId,
          bullmqJobId,
          type: data.type,
          stage: "ingest",
        });
        projectStageId = await startStage(db, {
          syncRunId: data.syncRunId,
          integrationId: data.integrationId,
          bullmqJobId,
          type: data.type,
          stage: "project",
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
            const metrics = await projectBatch(
              db,
              {
                orgId: data.orgId,
                linkId: data.linkId,
                siteId: data.siteId,
                provider: data.provider,
                type: data.type,
                syncRunId: data.syncRunId,
              },
              records,
            );

            recordsIn += metrics.recordsIn;
            projectTotals.recordsOut += metrics.recordsOut;
            projectTotals.createdCt += metrics.createdCt;
            projectTotals.updatedCt += metrics.updatedCt;
            projectTotals.failedCt += metrics.failedCt;
            batchIndex++;
          }
        }

        await completeStage(db, ingestStageId, {
          recordsOut: recordsIn,
          metrics: { batches: batchIndex, nextCursor },
        });
        ingestStageId = undefined;

        await completeStage(db, projectStageId, {
          recordsIn,
          recordsOut: projectTotals.recordsOut,
          createdCt: projectTotals.createdCt,
          updatedCt: projectTotals.updatedCt,
          failedCt: projectTotals.failedCt,
        });
        projectStageId = undefined;

        // Post-project contract steps (linkers/enrichers). Run once per facet
        // after all batches are projected, same trigger as the old projection
        // worker's runStatus === "completed" branch.
        await runProjectionSteps(
          {
            db,
            orgId: data.orgId,
            linkId: data.linkId,
            provider: data.provider,
            type: data.type,
            syncRunId: data.syncRunId,
            rawBatchId: bullmqJobId,
          },
          projectionSteps,
          bullmqJobId,
        );

        await recordFetchSuccess(db, {
          linkId: data.linkId,
          integrationId: data.integrationId,
          type: data.type,
          mode: data.mode,
          cursor: nextCursor,
        });
        await completeRun(db, data.syncRunId);

        await enqueueNormalizeJob(getNormalizeQueue(data.orgId), data);

        logger.info("Ingestion job completed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId: data.syncRunId,
          recordsIn,
          projected: projectTotals,
          batches: batchIndex,
        });
      } catch (error) {
        if (projectStageId) await failStage(db, projectStageId, error);
        if (ingestStageId) await failStage(db, ingestStageId, error);
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

async function enqueueNormalizeJob(
  queue: Queue<NormalizeJobData, unknown, string>,
  data: IngestionJobData,
): Promise<void> {
  const jobId = assertBullMqName(
    `normalize_${data.syncRunId}_${data.type}`,
    "BullMQ job id",
  );
  await queue.add(
    "normalize",
    {
      orgId: data.orgId,
      linkId: data.linkId,
      siteId: data.siteId,
      provider: data.provider,
      type: data.type,
      syncRunId: data.syncRunId,
    },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      priority: pipelineJobPriority(data.provider),
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
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
