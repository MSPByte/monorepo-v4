import { and, eq, lt } from "drizzle-orm";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import { policyEvaluationRequests, syncRuns } from "@mspbyte/drizzle";
import {
  getOrCreateQueue,
  orgQueueName,
  policyTriggerJobId,
  QUEUES,
  type PolicyJobData,
} from "@mspbyte/pipeline";
import { env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";

// How stale a "queued" row must be before we consider it stuck and reset it.
const STUCK_QUEUED_AFTER_MS = 30_000;

// Polls policyEvaluationRequests rows written by tRPC createAssignment and
// turns them into real BullMQ policy jobs. Mirrors the pending-runs-poller
// pattern from backend/packages — the DB is the source of truth because tRPC
// (Vercel) cannot reach Redis (Railway) in production.
export function createPolicyTriggerPoller(
  redis: RedisConnection,
  orgId: string,
  intervalMs = 5_000,
): { stop: () => void } {
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const tenant = await getTenantServiceDbByOrgId(
        orgId,
        requireEncryptionKey(),
        env.CATALOG_DATABASE_URL,
      );
      const db = tenant.db;

      const pending = await db
        .select({
          id: policyEvaluationRequests.id,
          linkId: policyEvaluationRequests.linkId,
          siteId: policyEvaluationRequests.siteId,
          integrationId: policyEvaluationRequests.integrationId,
          type: policyEvaluationRequests.type,
        })
        .from(policyEvaluationRequests)
        .where(eq(policyEvaluationRequests.status, "pending"))
        .limit(20);

      for (const row of pending) {
        try {
          await enqueuePendingPolicyTrigger(redis, db, orgId, row);
        } catch (err) {
          logger.error("Failed to enqueue policy trigger", {
            orgId,
            requestId: row.id,
            error: serializeError(err),
          });
        }
      }

      await reconcileStuckTriggers(db);
    } catch (err) {
      logger.error("Policy trigger poller tick failed", {
        orgId,
        error: serializeError(err),
      });
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);

  // Fire immediately so a row inserted right before startup isn't delayed.
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}

async function enqueuePendingPolicyTrigger(
  redis: RedisConnection,
  db: any,
  orgId: string,
  row: {
    id: string;
    linkId: string;
    siteId: string | null;
    integrationId: string;
    type: string;
  },
): Promise<void> {
  // Create the syncRuns row before claiming so the worker always has a valid row.
  const [syncRun] = await db
    .insert(syncRuns)
    .values({
      linkId: row.linkId,
      integrationId: row.integrationId,
      bullmqJobId: "pending",
      type: row.type,
      status: "pending",
      mode: "policy-trigger",
    })
    .returning({ id: syncRuns.id });

  if (!syncRun) throw new Error("Failed to create syncRun for policy trigger");

  const jobId = policyTriggerJobId(row.id);

  // Atomic claim: only one replica wins the pending → queued flip.
  const [claimed] = await db
    .update(policyEvaluationRequests)
    .set({ status: "queued", bullmqJobId: jobId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(policyEvaluationRequests.id, row.id),
        eq(policyEvaluationRequests.status, "pending"),
      ),
    )
    .returning({ id: policyEvaluationRequests.id });

  if (!claimed) {
    // Another replica won — clean up the orphaned syncRun and bail.
    await db.delete(syncRuns).where(eq(syncRuns.id, syncRun.id));
    return;
  }

  await db
    .update(syncRuns)
    .set({ bullmqJobId: jobId, status: "queued" })
    .where(eq(syncRuns.id, syncRun.id));

  const queue = getOrCreateQueue<PolicyJobData>(
    redis,
    orgQueueName(QUEUES.POLICY, orgId),
  );

  const jobData: PolicyJobData = {
    orgId,
    linkId: row.linkId,
    siteId: row.siteId ?? undefined,
    provider: row.integrationId,
    type: row.type,
    syncRunId: syncRun.id,
  };

  await queue.add("policy", jobData, {
    jobId,
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200,
  });

  logger.info("Enqueued policy trigger job", {
    orgId,
    requestId: row.id,
    linkId: row.linkId,
    type: row.type,
    jobId,
  });
}

async function reconcileStuckTriggers(db: any): Promise<void> {
  const staleBefore = new Date(Date.now() - STUCK_QUEUED_AFTER_MS).toISOString();
  await db
    .update(policyEvaluationRequests)
    .set({ status: "pending", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(policyEvaluationRequests.status, "queued"),
        lt(policyEvaluationRequests.updatedAt, staleBefore),
      ),
    );
}
