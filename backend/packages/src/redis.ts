import { Redis } from "ioredis";
import { env } from "./env.js";

export type RedisConnection = Redis;

export function createRedis(): RedisConnection {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    keepAlive: 10_000,
    connectTimeout: 15_000,
  });
}

export async function closeRedis(redis: RedisConnection): Promise<void> {
  await redis.quit();
}
