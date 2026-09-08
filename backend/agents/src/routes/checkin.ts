import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { agents } from '@mspbyte/drizzle';
import { getTenantDbForOrg } from '../db.js';
import { requireDevice, requireOrgId } from '../require-device.js';
import { logger } from '../logger.js';
import type { FastifyInstance } from 'fastify';

const BodySchema = z.object({
  version: z.string().min(1),
  hostname: z.string().optional(),
  ip_address: z.string().optional().nullable(),
  ext_address: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  sid: z.string().optional().nullable()
});

export function checkinRoute(fastify: FastifyInstance) {
  fastify.post('/v2.0/checkin', async (req, reply) => {
    const orgId = requireOrgId(req, reply);
    if (!orgId) return;

    let db: Awaited<ReturnType<typeof getTenantDbForOrg>>;
    try {
      db = await getTenantDbForOrg(orgId);
    } catch {
      return reply.status(503).send({ error: 'Database unavailable' });
    }

    const device = await requireDevice(req, reply, db);
    if (!device) return;

    const body = BodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const { version, hostname, ip_address, ext_address, username, sid } = body.data;
    const now = new Date().toISOString();

    await db.update(agents).set({
      version,
      ...(hostname ? { hostname } : {}),
      ipAddress: ip_address ?? null,
      extAddress: ext_address ?? null,
      username: username ?? null,
      sid: sid ?? null,
      lastCheckinAt: now,
      updatedAt: now
    }).where(eq(agents.id, device.id));

    logger.info('Agent checked in', { agentId: device.id, hostname: hostname ?? device.hostname });

    return reply.status(200).send({ ok: true });
  });
}
