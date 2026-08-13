import { and, eq, inArray, lt } from "drizzle-orm";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import { packageRuns } from "@mspbyte/drizzle";
import {
  enqueuePendingPackageRun,
  getOrCreateQueue,
  orgQueueName,
  packageRunJobId,
  QUEUES,
} from "@mspbyte/pipeline";
import { env, requireEncryptionKey } from "../env.js";
import { serializeError } from "../errors.js";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";

// How stale a "queued" row must be before we consider it orphaned. Real
// BullMQ pickup is sub-second; 30s is well beyond any healthy delay.
const STUCK_QUEUED_AFTER_MS = 30_000;

// Interval-driven polling — the frontend can't reach Redis in production, so
// tRPC only inserts a pending row. This poller (running inside backend/packages
// where Redis IS reachable) turns those rows into BullMQ jobs.
//
// Atomic status transition inside enqueuePendingPackageRun means multi-instance
// deploys can safely race: only one poller wins the pending → queued flip.

export function createPendingRunsPoller(
  redis: RedisConnection,
  orgId: string,
  intervalMs = 2_000,
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
        .select({ id: packageRuns.id })
        .from(packageRuns)
        .where(eq(packageRuns.status, "pending"))
        .limit(50);

      for (const row of pending as Array<{ id: string }>) {
        try {
          await enqueuePendingPackageRun(redis, db, orgId, row.id);
        } catch (err) {
          logger.error("Failed to enqueue pending package run", {
            orgId,
            packageRunId: row.id,
            error: serializeError(err),
          });
        }
      }

      await reconcileStuckQueued(redis, db, orgId);
    } catch (err) {
      logger.error("Pending-runs poller tick failed", {
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

  // Fire immediately so a run inserted right before startup doesn't wait for
  // the first interval to elapse.
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}

// Reconciles queued rows whose BullMQ job vanished — the worker crashed
// between "UPDATE ... queued" and "queue.add", or Redis evicted the job.
// Flips them back to "pending" so the next tick can re-enqueue.
async function reconcileStuckQueued(
  redis: RedisConnection,
  db: any,
  orgId: string,
): Promise<void> {
  const staleBefore = new Date(Date.now() - STUCK_QUEUED_AFTER_MS).toISOString();

  const stuck = await db
    .select({ id: packageRuns.id, executionAttempt: packageRuns.executionAttempt })
    .from(packageRuns)
    .where(
      and(
        eq(packageRuns.status, "queued"),
        lt(packageRuns.createdAt, staleBefore),
      ),
    )
    .limit(50);

  if (stuck.length === 0) return;

  const queueName = orgQueueName(QUEUES.PACKAGE, orgId);
  const queue = getOrCreateQueue(redis, queueName);
  const orphaned: string[] = [];

  for (const row of stuck as Array<{ id: string; executionAttempt: number }>) {
    const bullmqJobId = packageRunJobId(row.id, row.executionAttempt);
    const job = await queue.getJob(bullmqJobId).catch(() => null);
    if (job) continue;
    orphaned.push(row.id);
  }

  if (orphaned.length === 0) return;

  // Only revert rows we confirmed are orphaned; another worker that just
  // completed the job right after our getJob check would have left the row
  // in a terminal state, so an AND status='queued' guard keeps us safe.
  await db
    .update(packageRuns)
    .set({ status: "pending" })
    .where(
      and(
        inArray(packageRuns.id, orphaned),
        eq(packageRuns.status, "queued"),
      ),
    );

  logger.warn("Reconciled stuck queued package runs", {
    orgId,
    count: orphaned.length,
  });
}
