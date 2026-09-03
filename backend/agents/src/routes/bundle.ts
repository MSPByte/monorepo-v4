import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { agents, agentBundles, agentForms } from '@mspbyte/drizzle';
import { getTenantDb } from '../db.js';
import { logger } from '../logger.js';
import type { FastifyInstance } from 'fastify';

export function bundleRoute(fastify: FastifyInstance) {
  fastify.get('/v2.0/bundle', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (!deviceId) {
      return reply.status(401).send({ error: 'Missing X-Device-ID' });
    }

    let db: Awaited<ReturnType<typeof getTenantDb>>;
    try {
      db = await getTenantDb();
    } catch {
      return reply.status(503).send({ error: 'Database unavailable' });
    }

    const [device] = await db
      .select({ id: agents.id, siteId: agents.siteId })
      .from(agents)
      .where(and(eq(agents.id, deviceId), isNull(agents.deletedAt)))
      .limit(1);

    if (!device) {
      return reply.status(401).send({ error: 'Unknown or revoked device' });
    }

    // Fetch bundle config and forms in parallel.
    const [[bundle], forms] = await Promise.all([
      db.select({ data: agentBundles.data })
        .from(agentBundles)
        .where(eq(agentBundles.siteId, device.siteId))
        .limit(1),
      db.select({ id: agentForms.id, name: agentForms.name, description: agentForms.description, rows: agentForms.rows })
        .from(agentForms)
        .where(isNull(agentForms.deletedAt)),
    ]);

    // Merge forms into bundle; compute etag over the full merged payload so any
    // change to either forms or branding invalidates the agent's cached copy.
    const merged = { ...(bundle?.data ?? {}), forms };
    const etag = crypto.createHash('sha256').update(JSON.stringify(merged)).digest('hex');

    const clientEtag = (req.headers['if-none-match'] as string | undefined)?.trim();
    if (clientEtag === etag) {
      return reply.status(304).send();
    }

    logger.info('Bundle served', { deviceId, siteId: device.siteId, etag });

    return reply
      .status(200)
      .header('ETag', etag)
      .send({ data: merged });
  });
}
