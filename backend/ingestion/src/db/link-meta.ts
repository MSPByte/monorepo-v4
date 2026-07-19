import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { integrationLinks } from "@mspbyte/drizzle";
import type { IngestionAdapter } from "@mspbyte/pipeline";
import {
  INTEGRATIONS,
  META_VERSION_KEY,
  type ProviderId,
} from "@mspbyte/shared";
import { logger } from "../logger.js";
import type { RedisConnection } from "../redis.js";

type Db = any;

const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_INTERVAL_MS = 1_000;
const LOCK_WAIT_MAX_ATTEMPTS = 60;

const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export type HealLinkMetaParams = {
  db: Db;
  redis: RedisConnection;
  adapter: IngestionAdapter;
  linkId: string;
  orgId: string;
  provider: string;
  jobLinkMeta?: Record<string, unknown>;
  integrationConfig?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function injectedFromJob(
  jobLinkMeta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (jobLinkMeta?.externalId === undefined) return {};
  return { externalId: jobLinkMeta.externalId };
}

async function readLink(
  db: Db,
  linkId: string,
): Promise<{ meta: Record<string, unknown>; externalId: string | null } | null> {
  const [row] = await db
    .select({ meta: integrationLinks.meta, externalId: integrationLinks.externalId })
    .from(integrationLinks)
    .where(eq(integrationLinks.id, linkId))
    .limit(1);
  if (!row) return null;
  return { meta: asRecord(row.meta), externalId: row.externalId ?? null };
}

/**
 * Ensures the link's stored meta matches the vendor's current schema version.
 * Fast path when versions match. On mismatch, single-flights the vendor
 * re-fetch behind a Redis lock keyed by linkId — concurrent facet jobs for the
 * same link wait for the winner to write back, then proceed with the healed
 * meta.
 */
export async function healLinkMeta(
  params: HealLinkMetaParams,
): Promise<Record<string, unknown> | undefined> {
  const { db, redis, adapter, linkId, orgId, provider } = params;

  const integration = INTEGRATIONS[provider as ProviderId];
  if (!integration) return params.jobLinkMeta;

  const currentVersion = integration.linkMetaVersion;
  const injected = injectedFromJob(params.jobLinkMeta);

  const initial = await readLink(db, linkId);
  if (!initial) return params.jobLinkMeta;

  if (initial.meta[META_VERSION_KEY] === currentVersion) {
    return params.jobLinkMeta;
  }

  if (!adapter.resolveLinkMeta) {
    logger.warn("Link meta stale but adapter has no resolveLinkMeta", {
      orgId,
      linkId,
      provider,
      storedVersion: initial.meta[META_VERSION_KEY],
      currentVersion,
    });
    return params.jobLinkMeta;
  }

  if (!initial.externalId) {
    logger.warn("Link meta stale but externalId missing; cannot re-derive", {
      orgId,
      linkId,
      provider,
    });
    return params.jobLinkMeta;
  }

  const lockKey = `heal:${orgId}:${linkId}`;
  const lockValue = randomUUID();
  const acquired = await redis.set(lockKey, lockValue, "PX", LOCK_TTL_MS, "NX");

  if (acquired !== "OK") {
    logger.info("Heal in progress on another worker; waiting", {
      orgId,
      linkId,
      provider,
    });
    for (let attempt = 0; attempt < LOCK_WAIT_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_INTERVAL_MS));
      const check = await readLink(db, linkId);
      if (check && check.meta[META_VERSION_KEY] === currentVersion) {
        return { ...check.meta, ...injected };
      }
    }
    throw new Error(
      `Timed out waiting for concurrent link meta heal on ${linkId}`,
    );
  }

  try {
    // Re-read inside the lock in case another worker healed between our
    // initial read and lock acquisition.
    const inLock = await readLink(db, linkId);
    if (!inLock) return params.jobLinkMeta;
    if (inLock.meta[META_VERSION_KEY] === currentVersion) {
      return { ...inLock.meta, ...injected };
    }

    logger.info("Healing link meta", {
      orgId,
      linkId,
      provider,
      from: inLock.meta[META_VERSION_KEY] ?? 0,
      to: currentVersion,
    });

    const fresh = await adapter.resolveLinkMeta({
      orgId,
      linkId,
      externalId: inLock.externalId ?? params.jobLinkMeta?.externalId as string,
      currentMeta: inLock.meta,
      integrationConfig: params.integrationConfig,
      tenantDb: db,
    });
    const stamped: Record<string, unknown> = {
      ...fresh,
      [META_VERSION_KEY]: currentVersion,
    };

    await db
      .update(integrationLinks)
      .set({ meta: stamped, updatedAt: new Date().toISOString() })
      .where(eq(integrationLinks.id, linkId));

    return { ...stamped, ...injected };
  } finally {
    try {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockValue);
    } catch (error) {
      logger.warn("Failed to release link meta heal lock", {
        orgId,
        linkId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
