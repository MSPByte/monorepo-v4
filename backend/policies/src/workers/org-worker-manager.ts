import type { Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getCatalogDb, organization } from "@mspbyte/drizzle-catalog";
import { orgQueueName, QUEUES } from "@mspbyte/pipeline";
import { env } from "../env.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import { createPolicyWorker } from "./policy-worker.js";

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

      const queueName = orgQueueName(QUEUES.POLICY, orgId);
      const worker = createPolicyWorker(redis, queueName);
      workers.set(orgId, worker);
      logger.info("Started policy worker for organization", {
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
      logger.info("Stopped policy worker for inactive organization", { orgId });
    }
  }

  async function close(): Promise<void> {
    await Promise.all([...workers.values()].map((worker) => worker.close()));
    workers.clear();
  }

  return { sync, close };
}

function activeOrgWhere() {
  const active = eq(organization.status, "active");
  if (!env.REQUIRE_DEV_ORGS) return active;

  return and(active, eq(organization.isDev, true));
}
