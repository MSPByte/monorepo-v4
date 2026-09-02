import crypto from 'node:crypto';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { agents, agentSiteTokens } from '@mspbyte/drizzle';
import { getTenantDb } from '../db.js';
import { logger } from '../logger.js';
import type { FastifyInstance } from 'fastify';

const BodySchema = z.object({
  enrollment_token: z.string().min(1),
  hostname: z.string().min(1),
  platform: z.string().min(1),
  version: z.string().min(1),
  machine_id: z.string().optional().nullable(),
  mac: z.string().optional().nullable(),
  ip_address: z.string().optional().nullable(),
  ext_address: z.string().optional().nullable(),
  serial: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  sid: z.string().optional().nullable()
});

export function enrollRoute(fastify: FastifyInstance) {
  fastify.post('/v2.0/enroll', async (req, reply) => {
    const body = BodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    const {
      enrollment_token,
      hostname,
      platform,
      version,
      machine_id,
      mac,
      ip_address,
      ext_address,
      serial,
      username,
      sid
    } = body.data;

    let db: Awaited<ReturnType<typeof getTenantDb>>;
    try {
      db = await getTenantDb();
    } catch {
      return reply.status(503).send({ error: 'Database unavailable' });
    }

    const tokenHash = crypto.createHash('sha256').update(enrollment_token).digest('hex');

    const [tokenRow] = await db
      .select({ id: agentSiteTokens.id, siteId: agentSiteTokens.siteId })
      .from(agentSiteTokens)
      .where(and(eq(agentSiteTokens.tokenHash, tokenHash), isNull(agentSiteTokens.revokedAt)))
      .limit(1);

    if (!tokenRow) {
      return reply.status(401).send({ error: 'Invalid or revoked enrollment token' });
    }

    const siteId = tokenRow.siteId;
    const now = new Date().toISOString();

    // Try to match an existing device by machine_id to handle reinstalls cleanly.
    let agentId: string;

    if (machine_id) {
      const [existing] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.siteId, siteId), eq(agents.machineId, machine_id), isNull(agents.deletedAt)))
        .limit(1);

      if (existing) {
        await db.update(agents).set({
          hostname,
          version,
          platform,
          machineId: machine_id,
          macAddress: mac ?? null,
          ipAddress: ip_address ?? null,
          extAddress: ext_address ?? null,
          serial: serial ?? null,
          username: username ?? null,
          sid: sid ?? null,
          lastCheckinAt: now,
          updatedAt: now
        }).where(eq(agents.id, existing.id));

        agentId = existing.id;
        logger.info('Agent re-enrolled (matched by machine_id)', { agentId, hostname, siteId });
      } else {
        agentId = await insertNewAgent({ db, siteId, hostname, platform, version, machine_id, mac, ip_address, ext_address, serial, username, sid, now });
      }
    } else {
      agentId = await insertNewAgent({ db, siteId, hostname, platform, version, machine_id: null, mac, ip_address, ext_address, serial, username, sid, now });
    }

    return reply.status(200).send({ data: { device_id: agentId } });
  });
}

async function insertNewAgent(params: {
  db: Awaited<ReturnType<typeof getTenantDb>>;
  siteId: string;
  hostname: string;
  platform: string;
  version: string;
  machine_id: string | null | undefined;
  mac: string | null | undefined;
  ip_address: string | null | undefined;
  ext_address: string | null | undefined;
  serial: string | null | undefined;
  username: string | null | undefined;
  sid: string | null | undefined;
  now: string;
}): Promise<string> {
  const { db, siteId, hostname, platform, version, machine_id, mac, ip_address, ext_address, serial, username, sid, now } = params;

  const [created] = await db.insert(agents).values({
    siteId,
    hostname,
    platform,
    version,
    machineId: machine_id ?? null,
    macAddress: mac ?? null,
    ipAddress: ip_address ?? null,
    extAddress: ext_address ?? null,
    serial: serial ?? null,
    username: username ?? null,
    sid: sid ?? null,
    lastCheckinAt: now,
    registeredAt: now
  }).returning({ id: agents.id });

  if (!created) throw new Error('Failed to create agent row');

  logger.info('Agent enrolled', { agentId: created.id, hostname, siteId });
  return created.id;
}
