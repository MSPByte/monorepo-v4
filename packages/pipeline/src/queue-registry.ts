import { Queue } from "bullmq";
import type { Redis } from "ioredis";

// Registry of BullMQ Queue instances, keyed by (redis, queueName). Callers use
// this instead of `new Queue()` to avoid opening and closing an ioredis
// connection on every enqueue. Queues are long-lived — the process closes
// them via `closeQueuesFor(redis)` on shutdown.
type QueueMap = Map<string, Queue<any, any, string>>;
const registries = new WeakMap<Redis, QueueMap>();

function registryFor(redis: Redis): QueueMap {
  let map = registries.get(redis);
  if (!map) {
    map = new Map();
    registries.set(redis, map);
  }
  return map;
}

export function getOrCreateQueue<Data = unknown, Result = unknown>(
  redis: Redis,
  queueName: string,
): Queue<Data, Result, string> {
  const map = registryFor(redis);
  let queue = map.get(queueName) as Queue<Data, Result, string> | undefined;
  if (!queue) {
    queue = new Queue<Data, Result, string>(queueName, {
      connection: redis as never,
    });
    map.set(queueName, queue);
  }
  return queue;
}

export async function closeQueuesFor(redis: Redis): Promise<void> {
  const map = registries.get(redis);
  if (!map) return;
  const queues = [...map.values()];
  map.clear();
  await Promise.all(queues.map((queue) => queue.close()));
}
