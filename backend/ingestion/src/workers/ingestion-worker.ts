import { UnrecoverableError, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import { syncRuns } from "@mspbyte/drizzle";
import {
  assertBullMqName,
  getOrCreateQueue,
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
import {
  deadLetterBatchFailure,
  deadLetterPerRecordFailures,
} from "../db/dead-letter.js";
import { projectionSteps } from "../contracts/registry.js";
import { runProjectionSteps } from "../contracts/runner.js";
import { serializeError } from "../errors.js";
import { scheduleNextRun } from "../schedule-planner.js";

export function createIngestionWorker(
  redis: RedisConnection,
  queueName: string,
): Worker {
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
      // Delayed / self-scheduled jobs don't create a syncRuns row up front
      // (they'd otherwise sit as "pending" for hours). Create one on demand
      // when the job actually starts running.
      const syncRunId = data.syncRunId ?? (await createSyncRunAtStart(db, data, String(job.id)));
      const bullmqJobId = String(job.id ?? syncRunId);
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
        syncRunId,
        jobId: bullmqJobId,
      });

      if (data.syncRunId) {
        // Pre-created row (manual / immediate enqueue) — confirm it exists.
        const [existing] = await db
          .select({ id: syncRuns.id })
          .from(syncRuns)
          .where(eq(syncRuns.id, data.syncRunId))
          .limit(1);
        if (!existing) {
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
      }

      try {
        ingestStageId = await startStage(db, {
          syncRunId,
          integrationId: data.integrationId,
          bullmqJobId,
          type: data.type,
          stage: "ingest",
        });
        projectStageId = await startStage(db, {
          syncRunId,
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
            const batchParams = {
              orgId: data.orgId,
              linkId: data.linkId,
              siteId: data.siteId,
              provider: data.provider,
              type: data.type,
              syncRunId,
              mode: data.mode,
              batchIndex,
            };

            try {
              const metrics = await projectBatch(db, batchParams, records);

              recordsIn += metrics.recordsIn;
              projectTotals.recordsOut += metrics.recordsOut;
              projectTotals.createdCt += metrics.createdCt;
              projectTotals.updatedCt += metrics.updatedCt;
              projectTotals.failedCt += metrics.failedCt;

              // Per-record failures are deterministic (bad payload → bad
              // normalize/validate). Dead-letter immediately so they can be
              // replayed after a code fix; retrying the whole batch wouldn't
              // help.
              if (metrics.failures.length > 0) {
                await deadLetterPerRecordFailures(db, batchParams, metrics.failures);
              }
            } catch (batchError) {
              // Whole-batch failure. On non-final attempts, rethrow so BullMQ
              // retries the whole facet. On the final attempt, dead-letter
              // this batch and continue with the next — partial success is
              // better than losing everything to one bad batch.
              const attempt = (job.attemptsMade ?? 0) + 1;
              const maxAttempts = job.opts?.attempts ?? 1;
              if (attempt < maxAttempts) {
                throw batchError;
              }
              await deadLetterBatchFailure(db, batchParams, records, batchError);
              projectTotals.failedCt += records.length;
            }
            batchIndex++;
          }
        }

        await completeStage(db, ingestStageId, {
          recordsOut: recordsIn,
          metrics: { batches: batchIndex, nextCursor },
        });
        ingestStageId = undefined;

        // Escalate if too much of the job dead-lettered — a broken projector
        // (e.g. schema drift) can otherwise silently send 100% of records to
        // dead-letter and complete "successfully". Records are still
        // preserved for replay after the fix.
        if (
          recordsIn >= env.DEAD_LETTER_MIN_SAMPLES &&
          projectTotals.failedCt / recordsIn > env.DEAD_LETTER_FAILURE_RATIO
        ) {
          throw new UnrecoverableError(
            `Projection failure rate ${projectTotals.failedCt}/${recordsIn} exceeds threshold ${env.DEAD_LETTER_FAILURE_RATIO} for ${data.provider}/${data.type}`,
          );
        }

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
            syncRunId,
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
        await completeRun(db, syncRunId);

        await enqueueNormalizeJob(
          getOrCreateQueue<NormalizeJobData>(
            redis,
            orgQueueName(QUEUES.NORMALIZE, data.orgId),
          ),
          data,
          syncRunId,
        );

        logger.info("Ingestion job completed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId,
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
        await failRun(db, syncRunId, error);

        logger.error("Ingestion job failed", {
          orgId: data.orgId,
          linkId: data.linkId,
          provider: data.provider,
          type: data.type,
          syncRunId,
          error: serializeError(error),
        });

        throw error;
      } finally {
        // Self-schedule the next run for this (link, facet). Fires on both
        // success and terminal failure so a broken integration continues to
        // retry on its backoff schedule instead of stalling forever. Errors
        // here are logged but never thrown — the safety-net poller will
        // catch a missing schedule within a few minutes anyway.
        try {
          await scheduleNextRun(redis, db, {
            orgId: data.orgId,
            linkId: data.linkId,
            integrationId: data.integrationId,
            siteId: data.siteId,
            externalId:
              typeof data.linkMeta?.externalId === "string"
                ? (data.linkMeta.externalId as string)
                : null,
            linkMeta: data.linkMeta,
            integrationConfig: data.integrationConfig,
            facet: data.type,
          });
        } catch (scheduleError) {
          logger.error("Failed to schedule next ingestion run", {
            orgId: data.orgId,
            linkId: data.linkId,
            provider: data.provider,
            type: data.type,
            error: serializeError(scheduleError),
          });
        }
      }
    },
    {
      connection: redis as never,
      concurrency: env.WORKER_CONCURRENCY,
      // Ingestion runs can span several minutes on large tenants (M365 full
      // sync, PowerShell facets). BullMQ's default 30s lock would let another
      // worker steal the job and cause duplicate ingestion. BullMQ auto-renews
      // the lock in the background — this is just the timeout if renewal
      // fails.
      lockDuration: env.WORKER_LOCK_DURATION_MS,
    },
  );
}

async function enqueueNormalizeJob(
  queue: ReturnType<typeof getOrCreateQueue<NormalizeJobData>>,
  data: IngestionJobData,
  syncRunId: string,
): Promise<void> {
  const jobId = assertBullMqName(
    `normalize_${syncRunId}_${data.type}`,
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
      syncRunId,
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

// Creates the syncRuns row on demand for delayed / self-scheduled jobs that
// arrive without a pre-created row. Immediate-enqueue paths (manual runs,
// tRPC) still create the row up front so the frontend can show "queued"
// state immediately after the API call.
async function createSyncRunAtStart(
  db: any,
  data: IngestionJobData,
  bullmqJobId: string,
): Promise<string> {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(syncRuns)
    .values({
      linkId: data.linkId,
      integrationId: data.integrationId,
      bullmqJobId,
      type: data.type,
      status: "running",
      mode: data.mode,
      startedAt: now,
    })
    .returning({ id: syncRuns.id });
  return row.id;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
