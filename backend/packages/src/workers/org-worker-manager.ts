import type { Worker } from "bullmq";
import { getCatalogDb, organization, pipelineOrgWhere } from "@mspbyte/drizzle-catalog";
import { getOrCreateQueue, orgQueueName, QUEUES } from "@mspbyte/pipeline";
import { env } from "../env.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import { createPackageWorker, TTL_CLEANUP_JOB_NAME } from "./package-worker.js";
import { createPendingRunsPoller } from "./pending-runs-poller.js";

export function createOrgWorkerManager(redis: RedisConnection) {
  const workers = new Map<string, Worker>();
  const pollers = new Map<string, { stop: () => void }>();

  async function sync(): Promise<void> {
    const catalogDb = getCatalogDb(env.CATALOG_DATABASE_URL);
    const activeOrgs = await catalogDb
      .select({ id: organization.id, isDev: organization.isDev })
      .from(organization)
      .where(
        pipelineOrgWhere({
          isProduction: env.IS_PRODUCTION,
          targetOrgIds: env.TARGET_ORG_IDS,
        }),
      );
    const activeOrgIds = new Set(activeOrgs.map((org) => org.id));

    for (const orgId of activeOrgIds) {
      if (workers.has(orgId)) continue;
      const queueName = orgQueueName(QUEUES.PACKAGE, orgId);
      const worker = createPackageWorker(redis, orgId, queueName);
      workers.set(orgId, worker);
      await ensureTtlCleanupScheduled(orgId, queueName);
      const poller = createPendingRunsPoller(redis, orgId);
      pollers.set(orgId, poller);
      logger.info("Started package worker for organization", {
        orgId,
        queueName,
        runtimeEnvironment: env.RUNTIME_ENVIRONMENT,
      });
    }

    for (const [orgId, worker] of workers) {
      if (activeOrgIds.has(orgId)) continue;
      workers.delete(orgId);
      pollers.get(orgId)?.stop();
      pollers.delete(orgId);
      await worker.close();
      logger.info("Stopped package worker for inactive organization", { orgId });
    }
  }

  async function close(): Promise<void> {
    for (const poller of pollers.values()) poller.stop();
    pollers.clear();
    await Promise.all([...workers.values()].map((worker) => worker.close()));
    workers.clear();
  }

  // Adds a repeatable hourly cron job on the org's PACKAGE queue. BullMQ
  // deduplicates by jobId + repeat opts so calling this on every sync is a
  // no-op after the first registration.
  async function ensureTtlCleanupScheduled(
    orgId: string,
    queueName: string,
  ): Promise<void> {
    const queue = getOrCreateQueue(redis, queueName);
    try {
      await queue.add(
        TTL_CLEANUP_JOB_NAME,
        { orgId, packageRunId: "" },
        {
          repeat: { pattern: "0 * * * *" },
          jobId: `ttl-cleanup__${orgId}`,
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      logger.warn("Failed to schedule TTL cleanup", {
        orgId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { sync, close };
}
