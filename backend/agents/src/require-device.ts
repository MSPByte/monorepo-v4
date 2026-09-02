import { and, eq, isNull } from 'drizzle-orm';
import { agents } from '@mspbyte/drizzle';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { getTenantDb } from './db.js';

type Db = Awaited<ReturnType<typeof getTenantDb>>;

export type DeviceContext = {
  id: string;
  siteId: string;
  hostname: string;
};

export async function requireDevice(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Db
): Promise<DeviceContext | null> {
  const deviceId = req.headers['x-device-id'] as string | undefined;
  const siteId = req.headers['x-site-id'] as string | undefined;

  if (!deviceId || !siteId) {
    reply.status(401).send({ error: 'Missing device credentials' });
    return null;
  }

  const [device] = await db
    .select({ id: agents.id, siteId: agents.siteId, hostname: agents.hostname })
    .from(agents)
    .where(and(eq(agents.id, deviceId), eq(agents.siteId, siteId), isNull(agents.deletedAt)))
    .limit(1);

  if (!device) {
    reply.status(401).send({ error: 'Device not found or revoked' });
    return null;
  }

  return device;
}
