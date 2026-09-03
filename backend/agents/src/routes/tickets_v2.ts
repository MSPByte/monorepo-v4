import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  agents,
  agentTickets,
  integrations,
  integrationLinks,
} from '@mspbyte/drizzle';
import { Encryption } from '@mspbyte/encryption';
import { HaloPSAConnector } from '@mspbyte/connectors';
import { getTenantDb } from '../db.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import type { FastifyInstance } from 'fastify';

const PSAConfigSchema = z
  .object({
    url: z.string().default(''),
    clientId: z.string().default(''),
    clientSecret: z.string().default(''),
  })
  .catch({ url: '', clientId: '', clientSecret: '' });

async function getPsaConnector(
  db: Awaited<ReturnType<typeof import('../db.js').getTenantDb>>,
  siteId: string
): Promise<HaloPSAConnector | null> {
  const [[psaIntegration], [psaLink]] = await Promise.all([
    db.select().from(integrations).where(eq(integrations.id, 'halopsa')).limit(1),
    db
      .select()
      .from(integrationLinks)
      .where(and(eq(integrationLinks.integrationId, 'halopsa'), eq(integrationLinks.siteId, siteId)))
      .limit(1),
  ]);
  if (!psaIntegration || !psaLink) return null;
  const cfg = PSAConfigSchema.parse(psaIntegration.config);
  const secret = Encryption.decrypt(cfg.clientSecret, env.ENCRYPTION_KEY) ?? '';
  return new HaloPSAConnector(cfg.url, cfg.clientId, secret);
}

export function ticketsV2Route(fastify: FastifyInstance) {
  // List tickets for this device, optionally filtered by OS user SID.
  fastify.get('/v2.0/tickets', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    const osSid = (req.headers['x-os-sid'] as string | undefined)?.trim();

    if (!deviceId) return reply.status(401).send({ error: 'Missing X-Device-ID' });

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

    if (!device) return reply.status(401).send({ error: 'Unknown or revoked device' });

    const rows = await db
      .select({
        id: agentTickets.id,
        ticketId: agentTickets.ticketId,
        summary: agentTickets.summary,
        meta: agentTickets.meta,
        createdAt: agentTickets.createdAt,
      })
      .from(agentTickets)
      .where(eq(agentTickets.agentId, device.id))
      .orderBy(desc(agentTickets.createdAt))
      .limit(50);

    // If a SID was provided, filter to tickets submitted by that OS user.
    const filtered = osSid
      ? rows.filter((r) => {
          const meta = r.meta as { osUser?: { sid?: string } } | null;
          return meta?.osUser?.sid === osSid;
        })
      : rows;

    return reply.send({
      data: filtered.map((r) => ({
        id: r.id,
        ticket_id: r.ticketId,
        summary: r.summary ?? '',
        created_at: r.createdAt,
      })),
    });
  });

  // Add a note/reply to an existing ticket.
  fastify.post('/v2.0/tickets/:ticketId/reply', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (!deviceId) return reply.status(401).send({ error: 'Missing X-Device-ID' });

    const { ticketId } = req.params as { ticketId: string };
    const body = req.body as { note?: string; os_user?: { username?: string } };

    if (!body?.note?.trim()) {
      return reply.status(400).send({ error: 'note is required' });
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

    if (!device) return reply.status(401).send({ error: 'Unknown or revoked device' });

    const connector = await getPsaConnector(db, device.siteId);
    if (!connector) {
      return reply.status(200).send({ error: 'PSA not configured for this site' });
    }

    const numericId = Number(ticketId);
    if (isNaN(numericId)) {
      return reply.status(400).send({ error: 'Invalid ticket ID' });
    }

    try {
      await connector.actions.create({
        ticket_id: numericId,
        note_html: `<p>${body.note}</p>`,
        who: body.os_user?.username ?? 'End User',
        hiddenfromuser: false,
        sendemail: true,
        utcoffset: 300,
      });

      logger.info('Ticket note added via v2.0', { ticketId, deviceId });
      return reply.send({ data: { ok: true } });
    } catch (err) {
      logger.error('Failed to add ticket note', { err, ticketId });
      return reply.status(500).send({ error: 'Failed to add note to ticket' });
    }
  });
}
