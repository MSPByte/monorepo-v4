import type { Worker } from "bullmq";
import { getCatalogDb, organization, pipelineOrgWhere } from "@mspbyte/drizzle-catalog";
import { orgQueueName, QUEUES } from "@mspbyte/pipeline";
import { env } from "../env.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";
import { createPolicyWorker } from "./policy-worker.js";
import { createPolicyTriggerPoller } from "./policy-trigger-poller.js";

export function createOrgWorkerManager(redis: RedisConnection) {
  const workers = new Map<string, Worker>();
  const pollers = new Map<string, { stop: () => void }>();

  async function sync(): Promise<void> {
    const catalogDb = getCatalogDb(env.CATALOG_DATABASE_URL);
    const activeOrgs = await catalogDb
      .select({ id: organization.id, isDev: organization.isDev })
      .from(organization)
      .where(activeOrgWhere());
    const activeOrgIds = new Set(activeOrgs.map((org) => org.id));

    for (const orgId of activeOrgIds) {
      if (!workers.has(orgId)) {
        const queueName = orgQueueName(QUEUES.POLICY, orgId);
        const worker = createPolicyWorker(redis, queueName);
        workers.set(orgId, worker);
        logger.info("Started policy worker for organization", {
          orgId,
          queueName,
          runtimeEnvironment: env.RUNTIME_ENVIRONMENT,
        });
      }

      if (!pollers.has(orgId)) {
        const poller = createPolicyTriggerPoller(redis, orgId);
        pollers.set(orgId, poller);
        logger.info("Started policy trigger poller for organization", { orgId });
      }
    }

    for (const [orgId, worker] of workers) {
      if (activeOrgIds.has(orgId)) continue;

      workers.delete(orgId);
      await worker.close();
      logger.info("Stopped policy worker for inactive organization", { orgId });
    }

    for (const [orgId, poller] of pollers) {
      if (activeOrgIds.has(orgId)) continue;

      pollers.delete(orgId);
      poller.stop();
      logger.info("Stopped policy trigger poller for inactive organization", { orgId });
    }
  }

  async function close(): Promise<void> {
    for (const poller of pollers.values()) {
      poller.stop();
    }
    pollers.clear();
    await Promise.all([...workers.values()].map((worker) => worker.close()));
    workers.clear();
  }

  return { sync, close };
}

function activeOrgWhere() {
  return pipelineOrgWhere({
    isProduction: env.IS_PRODUCTION,
    targetOrgIds: env.TARGET_ORG_IDS,
  });
}
