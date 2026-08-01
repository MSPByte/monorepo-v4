import { randomUUID } from "node:crypto";
import type { RedisConnection } from "./redis.js";

// Distributed lease so that only one ingestion replica runs the scheduler
// tick at a time. If the leader dies, the key expires and another replica
// picks it up on the next tick.
//
// Uses Redis SET NX EX for acquisition and a value check for renewal so we
// only extend a lock we still own (Railway can kill replicas mid-tick).

const LOCK_KEY = "ingestion:scheduler:lock";
const INSTANCE_ID = randomUUID();

export type SchedulerLease = {
  acquired: boolean;
};

// Attempts to acquire or renew the scheduler lease. Returns { acquired: true }
// if this replica should run the scheduler tick, false otherwise.
export async function acquireSchedulerLease(
  redis: RedisConnection,
  ttlMs: number,
): Promise<SchedulerLease> {
  const ttlSec = Math.max(1, Math.floor(ttlMs / 1000));
  const setResult = await redis.set(LOCK_KEY, INSTANCE_ID, "EX", ttlSec, "NX");
  if (setResult === "OK") return { acquired: true };

  const owner = await redis.get(LOCK_KEY);
  if (owner === INSTANCE_ID) {
    await redis.expire(LOCK_KEY, ttlSec);
    return { acquired: true };
  }

  return { acquired: false };
}

// Compare-and-delete: only release the lock if we're still the holder. Used
// on shutdown so a graceful stop hands leadership over immediately instead of
// waiting for the TTL.
export async function releaseSchedulerLease(redis: RedisConnection): Promise<void> {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;
  try {
    await redis.eval(script, 1, LOCK_KEY, INSTANCE_ID);
  } catch {
    /* best-effort release */
  }
}

export function schedulerInstanceId(): string {
  return INSTANCE_ID;
}
