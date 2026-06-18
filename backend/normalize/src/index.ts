import { closeRedis, createRedis } from "./redis.js";
import { env } from "./env.js";
import { serializeError } from "./errors.js";
import { logger } from "./logger.js";
import { createOrgWorkerManager } from "./workers/org-worker-manager.js";

const redis = createRedis();
const workerManager = createOrgWorkerManager(redis);

let workerRefreshInterval: ReturnType<typeof setInterval> | undefined;

async function shutdown(signal: string) {
  logger.info("Shutting down normalize service", { signal });

  if (workerRefreshInterval) clearInterval(workerRefreshInterval);

  await workerManager.close();
  await closeRedis(redis);
}

await workerManager.sync();

workerRefreshInterval = setInterval(() => {
  void workerManager.sync().catch((error) => {
    logger.error("Failed to sync normalize workers", {
      error: serializeError(error),
    });
  });
}, env.WORKER_REFRESH_INTERVAL_MS);

process.once("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});

logger.info("backend/normalize has started", {
  workerConcurrency: env.WORKER_CONCURRENCY,
  requireDevOrgs: env.REQUIRE_DEV_ORGS,
  runtimeEnvironment: env.RUNTIME_ENVIRONMENT,
});
