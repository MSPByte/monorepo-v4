import type { Worker } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";
import { getCatalogDb, organization } from "@mspbyte/drizzle-catalog";
import { orgQueueName, QUEUES } from "@mspbyte/pipeline";
import { env } from "../env.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import { createProjectionWorker } from "./projection-worker.js";

export function createOrgWorkerManager(redis: RedisConnection) {
  const workers = new Map<string, Worker>();

  async function sync(): Promise<void> {
    const catalogDb = getCatalogDb(env.CATALOG_DATABASE_URL);
    const activeOrgs = await catalogDb
      .select({ id: organization.id, isDev: organization.isDev })
      .from(organization)
      .where(activeOrgWhere());
    const activeOrgIds = new Set(activeOrgs.map((org) => org.id));

    for (const orgId of activeOrgIds) {
      if (workers.has(orgId)) continue;

      const queueName = orgQueueName(QUEUES.PROJECT, orgId);
      const worker = createProjectionWorker(redis, queueName);
      workers.set(orgId, worker);
      logger.info("Started projection worker for organization", {
        orgId,
        queueName,
        requireDevOrgs: env.REQUIRE_DEV_ORGS,
        runtimeEnvironment: env.RUNTIME_ENVIRONMENT,
      });
    }

    for (const [orgId, worker] of workers) {
      if (activeOrgIds.has(orgId)) continue;

      workers.delete(orgId);
      await worker.close();
      logger.info("Stopped projection worker for inactive organization", {
        orgId,
      });
    }
  }

  async function close(): Promise<void> {
    await Promise.all([...workers.values()].map((worker) => worker.close()));
    workers.clear();
  }

  return { sync, close };
}

function activeOrgWhere() {
  const filters = [eq(organization.status, "active")];

  if (env.REQUIRE_DEV_ORGS) filters.push(eq(organization.isDev, true));
  if (env.TARGET_ORG_IDS.length > 0) {
    filters.push(inArray(organization.id, env.TARGET_ORG_IDS));
  }

  return and(...filters);
}
