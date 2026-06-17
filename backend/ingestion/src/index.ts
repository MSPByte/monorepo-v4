import { closeRedis, createRedis } from "./redis.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { serializeError } from "./errors.js";
import { registerBuiltInAdapters } from "./adapters/index.js";
import { scheduleDueIngestion } from "./scheduler.js";
import { createOrgWorkerManager } from "./workers/org-worker-manager.js";

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
  await closeRedis(redis);
}

await workerManager.sync();

workerRefreshInterval = setInterval(() => {
  void workerManager.sync().catch((error) => {
    logger.error("Failed to sync ingestion workers", { error: serializeError(error) });
  });
}, env.WORKER_REFRESH_INTERVAL_MS);

if (env.SCHEDULER_ENABLED) {
  await scheduleDueIngestion(redis, "scheduled");

  schedulerInterval = setInterval(() => {
    void scheduleDueIngestion(redis, "scheduled").catch((error) => {
      logger.error("Scheduled ingestion scan failed", { error: serializeError(error) });
    });
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
