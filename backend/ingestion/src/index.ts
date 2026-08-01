import { closeRedis, createRedis } from "./redis.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { serializeError } from "./errors.js";
import { registerBuiltInAdapters } from "./adapters/index.js";
import { scheduleDueIngestion } from "./scheduler.js";
import {
  acquireSchedulerLease,
  releaseSchedulerLease,
  schedulerInstanceId,
} from "./scheduler-lock.js";
import { createOrgWorkerManager } from "./workers/org-worker-manager.js";
import { closeQueuesFor } from "@mspbyte/pipeline";

registerBuiltInAdapters();

const redis = createRedis();
const workerManager = createOrgWorkerManager(redis);

let schedulerInterval: ReturnType<typeof setInterval> | undefined;
let workerRefreshInterval: ReturnType<typeof setInterval> | undefined;

async function shutdown(signal: string) {
  logger.info("Shutting down ingestion service", { signal });

  if (schedulerInterval) clearInterval(schedulerInterval);
  if (workerRefreshInterval) clearInterval(workerRefreshInterval);

  await workerManager.close();
  if (env.SCHEDULER_ENABLED) await releaseSchedulerLease(redis);
  await closeQueuesFor(redis);
  await closeRedis(redis);
}

async function runSchedulerTick(): Promise<void> {
  const lease = await acquireSchedulerLease(redis, env.SCHEDULER_LOCK_TTL_MS).catch((error) => {
    logger.error("Failed to acquire scheduler lease", { error: serializeError(error) });
    return { acquired: false };
  });
  if (!lease.acquired) {
    logger.debug("Scheduler lease held by another replica; skipping tick", {
      instanceId: schedulerInstanceId(),
    });
    return;
  }

  try {
    await scheduleDueIngestion(redis, "scheduled");
  } catch (error) {
    logger.error("Scheduled ingestion scan failed", { error: serializeError(error) });
  }
}

await workerManager.sync();

workerRefreshInterval = setInterval(() => {
  void workerManager.sync().catch((error) => {
    logger.error("Failed to sync ingestion workers", { error: serializeError(error) });
  });
}, env.WORKER_REFRESH_INTERVAL_MS);

if (env.SCHEDULER_ENABLED) {
  await runSchedulerTick();

  schedulerInterval = setInterval(() => {
    void runSchedulerTick();
  }, env.SCHEDULE_INTERVAL_MS);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});

logger.info("backend/ingestion has started", {
  schedulerEnabled: env.SCHEDULER_ENABLED,
  workerConcurrency: env.WORKER_CONCURRENCY,
});
