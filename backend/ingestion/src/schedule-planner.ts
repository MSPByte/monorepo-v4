import { and, eq } from "drizzle-orm";
import { syncContext } from "@mspbyte/drizzle";
import { enqueueNextIngestion, type SyncMode } from "@mspbyte/pipeline";
import { INTEGRATIONS, type FacetSyncConfig, type ProviderId } from "@mspbyte/shared";
import { env } from "./env.js";
import { logger } from "./logger.js";
import type { RedisConnection } from "./redis.js";

type Db = any;

export type ScheduleContext = {
  linkId: string;
  integrationId: string;
  facet: string;
};

export type SchedulePlan =
  | { shouldSchedule: false; reason: string }
  | { shouldSchedule: true; mode: SyncMode; delayMs: number; cursor?: string; reason: string };

// Backoff schedule for consecutive failures. On the Nth consecutive failure
// the next attempt is delayed by schedule[N-1] (or the last value once we
// run past the end). Keeps a broken integration retrying periodically
// without spamming, and overrides the facet's regular interval so we don't
// wait 24h to retry a transient blip.
const FAILURE_BACKOFF_MS = [
  60_000,           // 1 min
  5 * 60_000,       // 5 min
  30 * 60_000,      // 30 min
  60 * 60_000,      // 1 hour
] as const;

export async function planNextRun(
  db: Db,
  ctx: ScheduleContext,
): Promise<SchedulePlan> {
  const facetConfig = getFacetSyncConfig(ctx.integrationId, ctx.facet);
  if (facetConfig?.enabled === false) {
    return { shouldSchedule: false, reason: "facet disabled" };
  }

  const [context] = await db
    .select()
    .from(syncContext)
    .where(
      and(
        eq(syncContext.linkId, ctx.linkId),
        eq(syncContext.integrationId, ctx.integrationId),
        eq(syncContext.type, ctx.facet),
      ),
    )
    .limit(1);

  const now = Date.now();
  const consecutiveFailures = context?.consecutiveFailures ?? 0;

  // Never-run facet: schedule immediately as a full sync.
  if (!context?.lastSuccessAt) {
    if (consecutiveFailures > 0) {
      return {
        shouldSchedule: true,
        mode: "full",
        delayMs: backoffDelayMs(consecutiveFailures),
        reason: "never-succeeded, retry with backoff",
      };
    }
    return {
      shouldSchedule: true,
      mode: "full",
      delayMs: 0,
      reason: "never-run, initial full sync",
    };
  }

  // Failing facet: back off. Overrides the regular interval so we can retry
  // a 24h facet within minutes of a transient failure.
  if (consecutiveFailures > 0) {
    const delayMs = backoffDelayMs(consecutiveFailures);
    const mode: SyncMode =
      facetConfig?.supportsIncremental && context.cursor ? "incremental" : "full";
    const cursor = mode === "incremental" ? context.cursor ?? undefined : undefined;
    return {
      shouldSchedule: true,
      mode,
      delayMs,
      cursor,
      reason: `failure backoff (${consecutiveFailures} consecutive)`,
    };
  }

  // Healthy facet: honor the facet's configured cadence.
  if (!facetConfig?.supportsIncremental) {
    const intervalMs = facetConfig?.intervalMs ?? env.FULL_SYNC_INTERVAL_MS;
    const nextAt = dateMs(context.lastSuccessAt)! + intervalMs;
    return {
      shouldSchedule: true,
      mode: "full",
      delayMs: Math.max(0, nextAt - now),
      reason: `full-only, next in ${Math.max(0, nextAt - now)}ms`,
    };
  }

  const fullIntervalMs = facetConfig.fullIntervalMs ?? facetConfig.intervalMs ?? env.FULL_SYNC_INTERVAL_MS;
  const incrementalIntervalMs =
    facetConfig.incrementalIntervalMs ?? facetConfig.intervalMs ?? env.INCREMENTAL_SYNC_INTERVAL_MS;

  const lastFullAt = dateMs(context.fullSyncAt);
  const lastIncrementalAt = dateMs(context.incrementalSyncAt ?? context.lastSuccessAt);

  const nextFullAt = (lastFullAt ?? 0) + fullIntervalMs;
  const nextIncrementalAt = (lastIncrementalAt ?? 0) + incrementalIntervalMs;

  // No cursor stored means we can't do incremental — must full next.
  if (!context.cursor) {
    return {
      shouldSchedule: true,
      mode: "full",
      delayMs: Math.max(0, nextFullAt - now),
      reason: "incremental supported but no cursor",
    };
  }

  if (nextFullAt <= nextIncrementalAt) {
    return {
      shouldSchedule: true,
      mode: "full",
      delayMs: Math.max(0, nextFullAt - now),
      reason: "full sync due before next incremental",
    };
  }

  return {
    shouldSchedule: true,
    mode: "incremental",
    delayMs: Math.max(0, nextIncrementalAt - now),
    cursor: context.cursor,
    reason: "incremental next",
  };
}

export type ScheduleTarget = {
  orgId: string;
  linkId: string;
  integrationId: string;
  siteId?: string;
  externalId?: string | null;
  linkMeta?: unknown;
  integrationConfig?: unknown;
  facet: string;
};

export async function scheduleNextRun(
  redis: RedisConnection,
  db: Db,
  target: ScheduleTarget,
): Promise<void> {
  const plan = await planNextRun(db, {
    linkId: target.linkId,
    integrationId: target.integrationId,
    facet: target.facet,
  });

  if (!plan.shouldSchedule) {
    logger.debug("Skipping schedule for facet", {
      orgId: target.orgId,
      linkId: target.linkId,
      integrationId: target.integrationId,
      facet: target.facet,
      reason: plan.reason,
    });
    return;
  }

  const result = await enqueueNextIngestion(redis, {
    orgId: target.orgId,
    linkId: target.linkId,
    integrationId: target.integrationId,
    siteId: target.siteId,
    externalId: target.externalId,
    linkMeta: target.linkMeta,
    integrationConfig: target.integrationConfig,
    type: target.facet,
    mode: plan.mode,
    cursor: plan.cursor,
    delayMs: plan.delayMs,
  });

  logger.info("Scheduled next ingestion run", {
    orgId: target.orgId,
    linkId: target.linkId,
    integrationId: target.integrationId,
    facet: target.facet,
    mode: plan.mode,
    delayMs: result.delayMs,
    jobId: result.jobId,
    reason: plan.reason,
  });
}

function backoffDelayMs(consecutiveFailures: number): number {
  const idx = Math.max(0, Math.min(consecutiveFailures - 1, FAILURE_BACKOFF_MS.length - 1));
  return FAILURE_BACKOFF_MS[idx]!;
}

function getFacetSyncConfig(integrationId: string, facet: string): FacetSyncConfig | undefined {
  const integration = INTEGRATIONS[integrationId as ProviderId];
  return integration?.supportedFacets.find((entry) => entry.facet === facet)?.sync;
}

function dateMs(value: string | Date | null | undefined): number | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? undefined : time;
}
