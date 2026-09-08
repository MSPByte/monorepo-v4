import { and, eq, isNull } from 'drizzle-orm';
import { agents } from '@mspbyte/drizzle';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { getTenantDbForOrg } from './db.js';

type Db = Awaited<ReturnType<typeof getTenantDbForOrg>>;

export type DeviceContext = {
  id: string;
  siteId: string;
  hostname: string;
};

/** Extract org_id from X-Org-ID header, sending 401 if missing. */
export function requireOrgId(req: FastifyRequest, reply: FastifyReply): string | null {
  const orgId = (req.headers['x-org-id'] as string | undefined)?.trim();
  if (!orgId) {
    reply.status(401).send({ error: 'Missing X-Org-ID' });
    return null;
  }
  return orgId;
}

export async function requireDevice(
  req: FastifyRequest,
  reply: FastifyReply,
  db: Db
): Promise<DeviceContext | null> {
  const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();

  if (!deviceId) {
    reply.status(401).send({ error: 'Missing X-Device-ID' });
    return null;
  }

  const [device] = await db
    .select({ id: agents.id, siteId: agents.siteId, hostname: agents.hostname })
    .from(agents)
    .where(and(eq(agents.id, deviceId), isNull(agents.deletedAt)))
    .limit(1);

  if (!device) {
    reply.status(401).send({ error: 'Device not found or revoked' });
    return null;
  }

  return device;
}
