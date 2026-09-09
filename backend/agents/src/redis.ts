import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// Lazy singleton — Redis here is only used for submission rate limiting, so
// a missing REDIS_URL or a dead connection must never block ticket creation.
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!env.REDIS_URL) {
    logger.warn('REDIS_URL not set — submission rate limiting disabled');
    client = null;
    return client;
  }
  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    keepAlive: 10_000,
    connectTimeout: 15_000,
  });
  client.on('error', (err) => logger.warn('Redis error', { err: String(err) }));
  return client;
}

// Returns true when this (device, form) pair is inside its cooldown window.
// Fail-open: any Redis failure allows the submission through.
export async function isRateLimited(orgId: string, deviceId: string, formId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const key = `agents:submit:${orgId}:${deviceId}:${formId}`;
    const set = await redis.set(key, '1', 'EX', 30, 'NX');
    return set === null;
  } catch (err) {
    logger.warn('Rate limit check failed — allowing submission', { err: String(err) });
    return false;
  }
}
