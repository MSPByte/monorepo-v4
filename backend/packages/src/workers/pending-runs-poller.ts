import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog";
import { packageRuns, packageSchedules } from "@mspbyte/drizzle";
import {
  enqueuePendingPackageRun,
  createPendingScheduledPackageRun,
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
const STUCK_SCHEDULE_DISPATCH_AFTER_MS = 60_000;

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

      await dispatchDueSchedules(db, orgId);
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

// Schedules deliberately create an ordinary pending run instead of a delayed
// BullMQ job. The database is the source of truth, so a deploy or Redis loss
// cannot make a promised customer change disappear.
async function dispatchDueSchedules(db: any, orgId: string): Promise<void> {
  // Compatibility cleanup for schedules dispatched by the first scheduler
  // implementation, which retained a now-redundant "dispatched" record.
  await db.delete(packageSchedules).where(eq(packageSchedules.status, 'dispatched'));
  await reconcileStuckScheduleClaims(db, orgId);
  const now = new Date().toISOString();
  const due = await db
    .select({ id: packageSchedules.id })
    .from(packageSchedules)
    .where(
      and(
        eq(packageSchedules.status, 'scheduled'),
        lte(packageSchedules.scheduledFor, now),
      ),
    )
    .limit(50);

  for (const candidate of due as Array<{ id: string }>) {
    // Claim first so cancellation and another poller cannot race dispatch.
    const [schedule] = await db
      .update(packageSchedules)
      .set({ status: 'dispatching', updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(packageSchedules.id, candidate.id),
          eq(packageSchedules.status, 'scheduled'),
        ),
      )
      .returning();
    if (!schedule) continue;

    try {
      const created = await createPendingScheduledPackageRun(db, {
        packageId: schedule.packageId,
        packageVersion: schedule.packageVersion,
        packageSnapshot: schedule.packageSnapshot,
        linkId: schedule.linkId,
        siteId: schedule.siteId,
        triggerType: 'scheduled',
        triggerRef: {
          packageScheduleId: schedule.id,
          scheduledFor: schedule.scheduledFor,
          scheduledLocalTime: schedule.scheduledLocalTime,
          timeZone: schedule.timeZone,
        },
        triggeredByUserId: schedule.createdByUserId,
        triggerSourceLabel: `Scheduled package run · ${schedule.scheduledLocalTime} ${schedule.timeZone}`,
        runtimeInputs: schedule.runtimeInputs as Record<string, unknown>,
        billingSnapshot: schedule.billingSnapshot,
        scheduleId: schedule.id,
      });

      // The ordinary package run is now the durable execution history. Once
      // the hand-off succeeds, remove this one-time launch request so the
      // schedule workspace contains only work that can still be changed.
      await db.delete(packageSchedules).where(eq(packageSchedules.id, schedule.id));
      logger.info('Dispatched scheduled package run', {
        orgId,
        packageScheduleId: schedule.id,
        packageRunId: created?.packageRunId ?? null,
      });
    } catch (err) {
      // Returning to scheduled is safe: schedule_id's unique run constraint
      // prevents a duplicate if the insert actually committed before a later
      // failure. The next poll will finish the state transition.
      await db
        .update(packageSchedules)
        .set({ status: 'scheduled', updatedAt: new Date().toISOString() })
        .where(eq(packageSchedules.id, schedule.id));
      logger.error('Failed to dispatch scheduled package run', {
        orgId,
        packageScheduleId: schedule.id,
        error: serializeError(err),
      });
    }
  }
}

async function reconcileStuckScheduleClaims(db: any, orgId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - STUCK_SCHEDULE_DISPATCH_AFTER_MS).toISOString();
  const stuck = await db
    .select({ id: packageSchedules.id })
    .from(packageSchedules)
    .where(
      and(
        eq(packageSchedules.status, 'dispatching'),
        lt(packageSchedules.updatedAt, staleBefore),
      ),
    )
    .limit(50);

  for (const schedule of stuck as Array<{ id: string }>) {
    const [run] = await db
      .select({ id: packageRuns.id })
      .from(packageRuns)
      .where(eq(packageRuns.scheduleId, schedule.id))
      .limit(1);
    if (run) {
      // A prior worker created the package run but died before removing the
      // one-time request. Keep the run as history and clear the schedule.
      await db.delete(packageSchedules).where(eq(packageSchedules.id, schedule.id));
    } else {
      await db
        .update(packageSchedules)
        .set({ status: 'scheduled', updatedAt: new Date().toISOString() })
        .where(eq(packageSchedules.id, schedule.id));
    }
    logger.warn('Reconciled interrupted package schedule dispatch', {
      orgId,
      packageScheduleId: schedule.id,
      packageRunId: run?.id ?? null,
    });
  }
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
