import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { agents, sites } from '@mspbyte/drizzle';
import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { logger } from '../logger.js';
import { env } from '../env.js';
import type { FastifyInstance } from 'fastify';

const BodySchema = z.object({
  site_id: z.uuid(),
  hostname: z.string(),
  version: z.string(),
  platform: z.string(),
  device_id: z.uuid().optional().nullable(),
  mac: z.string().optional().nullable(),
  ip_address: z.string().optional().nullable(),
  ext_address: z.string().optional().nullable()
});

export function registerRoute(fastify: FastifyInstance) {
  fastify.post('/v1.0/register', async (req, reply) => {
    const body = BodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { module: 'v1.0/register', context: 'POST', message: 'Invalid request body' }
      });
    }

    const { site_id, hostname, version, platform, device_id, mac, ip_address, ext_address } =
      body.data;

    let db: Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>['db'];
    try {
      ({ db } = await getTenantServiceDbByOrgId(env.ORG_ID, env.ENCRYPTION_KEY));
    } catch {
      return reply
        .status(404)
        .send({ error: { module: 'v1.0/register', context: 'POST', message: 'Org not found' } });
    }

    // Verify site exists in this org's MSP DB
    const [site] = await db.select().from(sites).where(eq(sites.id, site_id)).limit(1);
    if (!site) {
      return reply
        .status(404)
        .send({ error: { module: 'v1.0/register', context: 'POST', message: 'Site not found' } });
    }

    const now = new Date().toISOString();

    let agentId: string;

    if (device_id) {
      // Update existing agent
      const [existing] = await db.select().from(agents).where(eq(agents.id, device_id)).limit(1);
      if (existing) {
        await db
          .update(agents)
          .set({
            hostname,
            version,
            platform,
            ipAddress: ip_address ?? null,
            extAddress: ext_address ?? null,
            macAddress: mac ?? null,
            updatedAt: now
          })
          .where(eq(agents.id, device_id));
        agentId = device_id;
        logger.info('Agent updated', { agentId, hostname, siteId: site_id });
      } else {
        const [created] = await db
          .insert(agents)
          .values({
            siteId: site_id,
            hostname,
            version,
            platform,
            ipAddress: ip_address ?? null,
            extAddress: ext_address ?? null,
            macAddress: mac ?? null,
            registeredAt: now
          })
          .returning({ id: agents.id });
        if (!created) {
          return reply.status(500).send({
            error: { module: 'v1.0/register', context: 'POST', message: 'Failed to create agent' }
          });
        }
        agentId = created.id;
        logger.info('Agent created (device_id not found)', { agentId, hostname, siteId: site_id });
      }
    } else {
      const [created] = await db
        .insert(agents)
        .values({
          siteId: site_id,
          hostname,
          version,
          platform,
          ipAddress: ip_address ?? null,
          extAddress: ext_address ?? null,
          macAddress: mac ?? null,
          registeredAt: now
        })
        .returning({ id: agents.id });
      if (!created) {
        return reply.status(500).send({
          error: { module: 'v1.0/register', context: 'POST', message: 'Failed to create agent' }
        });
      }
      agentId = created.id;
      logger.info('Agent registered', { agentId, hostname, siteId: site_id });
    }

    return reply.status(200).send({ data: { device_id: agentId, guid: agentId } });
  });
}
