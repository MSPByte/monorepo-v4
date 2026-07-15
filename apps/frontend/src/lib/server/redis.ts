import { Redis } from 'ioredis';
import { env } from '$env/dynamic/private';

let client: Redis | undefined;

export function getRedis(): Redis | undefined {
  const url = env.REDIS_URL;
  if (!url) return undefined;
  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: null,
      keepAlive: 10_000,
      connectTimeout: 15_000
    });
  }
  return client;
}
