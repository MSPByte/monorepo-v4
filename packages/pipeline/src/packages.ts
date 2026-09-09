import { and, eq, inArray } from "drizzle-orm";
import type { Redis } from "ioredis";
import { packageRuns, packages as packagesTable } from "@mspbyte/drizzle";
import {
  assertBullMqName,
  orgQueueName,
  packageRunJobId,
  QUEUES,
} from "./queues.js";
import { getOrCreateQueue } from "./queue-registry.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type Db = PostgresJsDatabase;

// The worker only needs the org + run id — everything else lives on the
// package_runs row (packageSnapshot, runtimeInputs, linkId, etc.) so we keep
// the BullMQ payload small.
export type PackageJobData = {
  orgId: string;
  packageRunId: string;
};

// Frozen shape of a sub-package embedded inside a parent snapshot. Mirrors
// the parent's snapshot shape recursively so the worker can descend without
// re-querying the DB.
export type EmbeddedPackageSnapshot = {
  id: string;
  name: string;
  version: number;
  steps: unknown[];
  prompts: unknown[];
  outcomeSteps: { onSuccess: unknown[]; onFailure: unknown[] };
  failureActions: unknown[];
  exposedOutputs: unknown[];
  children: Record<string, EmbeddedPackageSnapshot>;
};

// Transitively resolves every sub-package step referenced by `rootSteps` (and
// their descendants) into a keyed map { childPackageId -> embedded snapshot }.
// Dispatch-time freeze: a later edit to the child cannot change what the run
// executes. Guarded by a depth cap so a stale row can't spin forever.
export async function buildEmbeddedChildren(
  db: Db,
  rootSteps: unknown[],
  outcomeSteps?: { onSuccess?: unknown[]; onFailure?: unknown[] },
  depthBudget: number = 6,
): Promise<Record<string, EmbeddedPackageSnapshot>> {
  const collectRefs = (arr: unknown[]): string[] => {
    const ids: string[] = [];
    for (const raw of arr) {
      if (raw && typeof raw === 'object' && (raw as { kind?: string }).kind === 'subpackage') {
        const pid = (raw as { packageId?: string }).packageId;
        if (typeof pid === 'string') ids.push(pid);
      }
    }
    return ids;
  };

  const out: Record<string, EmbeddedPackageSnapshot> = {};
  const queue: Array<{ ids: string[]; depth: number }> = [
    {
      ids: [
        ...collectRefs(rootSteps),
        ...collectRefs(outcomeSteps?.onSuccess ?? []),
        ...collectRefs(outcomeSteps?.onFailure ?? []),
      ],
      depth: 1,
    },
  ];

  while (queue.length > 0) {
    const { ids, depth } = queue.shift()!;
    if (depth > depthBudget) break;
    const unseen = ids.filter((id) => !(id in out));
    if (unseen.length === 0) continue;
    const rows = await db
      .select()
      .from(packagesTable)
      .where(inArray(packagesTable.id, unseen));
    for (const row of rows as Array<{
      id: string;
      name: string;
      version: number;
      steps: unknown[];
      prompts: unknown[];
      outcomeSteps: { onSuccess: unknown[]; onFailure: unknown[] } | null;
      failureActions: unknown[];
      exposedOutputs: unknown[];
    }>) {
      out[row.id] = {
        id: row.id,
        name: row.name,
        version: row.version,
        steps: row.steps ?? [],
        prompts: row.prompts ?? [],
        outcomeSteps: row.outcomeSteps ?? { onSuccess: [], onFailure: [] },
        failureActions: row.failureActions ?? [],
        exposedOutputs: row.exposedOutputs ?? [],
        children: {}, // populated by the flat map at the top level; kept for shape parity
      };
      const nextRefs = [
        ...collectRefs(row.steps ?? []),
        ...collectRefs(row.outcomeSteps?.onSuccess ?? []),
        ...collectRefs(row.outcomeSteps?.onFailure ?? []),
      ];
      if (nextRefs.length > 0) queue.push({ ids: nextRefs, depth: depth + 1 });
    }
  }
  return out;
}

export type CreatePendingPackageRunParams = {
  packageId: string;
  packageVersion: number;
  packageSnapshot: unknown;
  linkId?: string | null;
  siteId?: string | null;
  triggerType: "manual" | "finding" | "scheduled" | "api" | "form";
  triggerRef?: unknown;
  triggeredByUserId?: string;
  triggerSourceLabel?: string;
  runtimeInputs?: Record<string, unknown>;
  billingSnapshot?: unknown;
  parentRunId?: string | null;
  fanoutParentId?: string | null;
  scheduleId?: string | null;
  startStepIndex?: number;
};

export type CreatePendingPackageRunResult = {
  packageRunId: string;
};

// Called by tRPC (which has no Redis connection in production). Just writes
// the row in "pending" — the backend/packages poller flips it to "queued"
// and pushes to BullMQ.
export async function createPendingPackageRun(
  db: Db,
  params: CreatePendingPackageRunParams,
): Promise<CreatePendingPackageRunResult> {
  const [run] = await db
    .insert(packageRuns)
    .values({
      packageId: params.packageId,
      packageVersion: params.packageVersion,
      packageSnapshot: params.packageSnapshot,
      linkId: params.linkId ?? null,
      siteId: params.siteId ?? null,
      triggerType: params.triggerType,
      triggerRef: params.triggerRef ?? null,
      triggeredByUserId: params.triggeredByUserId,
      triggerSourceLabel: params.triggerSourceLabel ?? null,
      runtimeInputs: params.runtimeInputs ?? {},
      billingSnapshot: params.billingSnapshot ?? {},
      parentRunId: params.parentRunId ?? null,
      fanoutParentId: params.fanoutParentId ?? null,
      scheduleId: params.scheduleId ?? null,
      startStepIndex: params.startStepIndex ?? 0,
      status: "pending",
    })
    .returning({ id: packageRuns.id }) as [{ id: string }, ...{ id: string }[]];

  return { packageRunId: run.id };
}

// A one-time schedule must only ever create one run, even if two scheduler
// replicas observe it as due at the same moment. `schedule_id` has a unique
// constraint; a conflict simply means another replica already dispatched it.
export async function createPendingScheduledPackageRun(
  db: Db,
  params: CreatePendingPackageRunParams & { scheduleId: string },
): Promise<CreatePendingPackageRunResult | null> {
  const [run] = await db
    .insert(packageRuns)
    .values({
      packageId: params.packageId,
      packageVersion: params.packageVersion,
      packageSnapshot: params.packageSnapshot,
      linkId: params.linkId ?? null,
      siteId: params.siteId ?? null,
      triggerType: params.triggerType,
      triggerRef: params.triggerRef ?? null,
      triggeredByUserId: params.triggeredByUserId,
      triggerSourceLabel: params.triggerSourceLabel ?? null,
      runtimeInputs: params.runtimeInputs ?? {},
      billingSnapshot: params.billingSnapshot ?? {},
      parentRunId: params.parentRunId ?? null,
      fanoutParentId: params.fanoutParentId ?? null,
      scheduleId: params.scheduleId,
      startStepIndex: params.startStepIndex ?? 0,
      status: 'pending',
    })
    .onConflictDoNothing({ target: packageRuns.scheduleId })
    .returning({ id: packageRuns.id });

  return run ? { packageRunId: run.id } : null;
}

// Called by the backend/packages pending-runs poller. Atomically transitions
// pending → queued (RETURNING ensures only one poller instance wins) and
// pushes to BullMQ. If the enqueue itself fails after the status flip, the
// job is retried by the safety-net: the next poll sees it stuck in "queued"
// with no BullMQ job. For Phase 2 we accept that gap; a proper reconciler
// lands with fanout in Phase 3.
export async function enqueuePendingPackageRun(
  redis: Redis,
  db: Db,
  orgId: string,
  packageRunId: string,
): Promise<{ jobId: string } | { skipped: true }> {
  const [current] = await db
    .select({ executionAttempt: packageRuns.executionAttempt })
    .from(packageRuns)
    .where(eq(packageRuns.id, packageRunId))
    .limit(1);
  if (!current) return { skipped: true };

  const bullmqJobId = packageRunJobId(packageRunId, current.executionAttempt);

  const claimed = await db
    .update(packageRuns)
    .set({ status: "queued", bullmqJobId })
    .where(
      and(eq(packageRuns.id, packageRunId), eq(packageRuns.status, "pending")),
    )
    .returning({ id: packageRuns.id });

  if (claimed.length === 0) {
    return { skipped: true };
  }

  const queueName = orgQueueName(QUEUES.PACKAGE, orgId);
  const queue = getOrCreateQueue<PackageJobData, { packageRunId: string }>(
    redis,
    queueName,
  );

  try {
    const jobName = assertBullMqName(
      `package_run_${packageRunId}`,
      "BullMQ job name",
    );
    const job = await queue.add(
      jobName,
      { orgId, packageRunId },
      {
        jobId: bullmqJobId,
        attempts: 1,
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
    return { jobId: String(job.id) };
  } catch (error) {
    await db
      .update(packageRuns)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
      })
      .where(eq(packageRuns.id, packageRunId));
    throw error;
  }
}
