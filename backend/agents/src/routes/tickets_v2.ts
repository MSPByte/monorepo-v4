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
import { getTenantDbForOrg } from '../db.js';
import { requireOrgId } from '../require-device.js';
import { resolveBundle } from './bundle.js';
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

type Db = Awaited<ReturnType<typeof getTenantDbForOrg>>;

async function getPsaConnector(db: Db, siteId: string): Promise<HaloPSAConnector | null> {
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
  fastify.get('/v2.0/tickets', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    const osSid = (req.headers['x-os-sid'] as string | undefined)?.trim();

    if (!deviceId) return reply.status(401).send({ error: 'Missing X-Device-ID' });

    const orgId = requireOrgId(req, reply);
    if (!orgId) return;

    let db: Db;
    try {
      db = await getTenantDbForOrg(orgId);
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

    const filtered = osSid
      ? rows.filter((r) => {
          const meta = r.meta as { osUser?: { sid?: string } } | null;
          return meta?.osUser?.sid === osSid;
        })
      : rows;

    const connector = await getPsaConnector(db, device.siteId);

    // Parallel-fetch live status from HaloPSA for each ticket.
    const withStatus = await Promise.all(
      filtered.map(async (r) => {
        let status_id: number | null = null;
        let status_name: string | null = null;
        if (connector) {
          try {
            const t = await connector.tickets.get(r.ticketId);
            status_id = t.status_id ?? null;
            status_name = t.status || null;
          } catch (err) {
            logger.warn('Failed to fetch ticket status', { ticketId: r.ticketId, err: String(err) });
          }
        }
        return { ...r, status_id, status_name };
      })
    );

    const CLOSED_RE = /closed|resolved|cancelled|completed/i;
    const isOpen = (name: string | null) => !name || !CLOSED_RE.test(name);

    // Sort: open tickets first, closed below; within each group newest first.
    withStatus.sort((a, b) => {
      const ao = isOpen(a.status_name) ? 0 : 1;
      const bo = isOpen(b.status_name) ? 0 : 1;
      return ao - bo;
    });

    return reply.send({
      data: withStatus.map((r) => ({
        id: r.id,
        ticket_id: r.ticketId,
        summary: r.summary ?? '',
        created_at: r.createdAt,
        status_id: r.status_id,
        status_name: r.status_name,
        is_open: isOpen(r.status_name),
      })),
    });
  });

  fastify.get('/v2.0/tickets/:ticketId', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (!deviceId) return reply.status(401).send({ error: 'Missing X-Device-ID' });

    const orgId = requireOrgId(req, reply);
    if (!orgId) return;

    const { ticketId } = req.params as { ticketId: string };

    let db: Db;
    try {
      db = await getTenantDbForOrg(orgId);
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
      return reply.send({ data: { ticket_id: ticketId, actions: [] } });
    }

    try {
      const raw = await connector.actions.list(ticketId);
      const actions = raw
        .filter((a) => !a.hiddenfromuser)
        .sort((a, b) => {
          const ta = a.actiondatecreated ? new Date(a.actiondatecreated).getTime() : 0;
          const tb = b.actiondatecreated ? new Date(b.actiondatecreated).getTime() : 0;
          return ta - tb;
        })
        .map((a) => {
          const rawHtml = a.note_html?.trim() ?? '';
          const noteHtml = rawHtml || (a.note ? `<p>${a.note.replace(/\n/g, '<br>')}</p>` : '');
          return {
            id: String(a.id),
            note_html: noteHtml,
            note: a.note ?? '',
            who: a.who ?? '',
            is_agent: (a.who_agentid ?? 0) > 0,
            created_at: a.actiondatecreated ?? '',
          };
        });
      return reply.send({ data: { ticket_id: ticketId, actions } });
    } catch (err) {
      logger.error('Failed to list ticket actions', { err, ticketId });
      return reply.status(500).send({ error: 'Failed to fetch ticket actions' });
    }
  });

  fastify.post('/v2.0/tickets/:ticketId/reply', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (!deviceId) return reply.status(401).send({ error: 'Missing X-Device-ID' });

    const orgId = requireOrgId(req, reply);
    if (!orgId) return;

    const { ticketId } = req.params as { ticketId: string };
    const body = req.body as {
      note?: string;
      os_user?: { username?: string };
      attachments?: Array<{ name: string; mime_type: string; data_b64: string }>;
    };

    if (!body?.note?.trim()) {
      return reply.status(400).send({ error: 'note is required' });
    }

    let db: Db;
    try {
      db = await getTenantDbForOrg(orgId);
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
      // Upload any inline attachments as embedded images
      let noteHtml = `<p>${body.note}</p>`;
      if (body.attachments?.length) {
        const imgTags: string[] = [];
        for (const att of body.attachments) {
          try {
            const mimeType = att.mime_type || 'image/png';
            const buf = Buffer.from(att.data_b64, 'base64');
            const blob = new Blob([buf], { type: mimeType });
            const url = await connector.attachment.uploadImage(blob);
            imgTags.push(`<img src="${url}" alt="${att.name}" style="max-width:100%" />`);
          } catch (uploadErr) {
            logger.warn('Failed to upload attachment', { uploadErr, name: att.name });
          }
        }
        if (imgTags.length) {
          noteHtml += imgTags.join('');
        }
      }

      const actionBody = {
        ticket_id: numericId,
        actiontype_id: 2,
        outcome: 'Reply',
        note_html: noteHtml,
        who: body.os_user?.username ?? 'End User',
        hiddenfromuser: false,
        sendemail: false,
        utcoffset: 300,
      };
      await connector.actions.create(actionBody);

      // Update ticket status if the bundle configures a reply status.
      try {
        const bundle = await resolveBundle(db, device.siteId);
        const replyStatusId = (bundle?.data as Record<string, unknown> | null)?.ticketReplyStatusId;
        if (typeof replyStatusId === 'number') {
          await connector.tickets.update(numericId, { status_id: replyStatusId });
        }
      } catch (statusErr) {
        logger.warn('Failed to update ticket status after reply', { statusErr, ticketId });
      }

      logger.info('Ticket note added via v2.0', { ticketId, deviceId });
      return reply.send({ data: { ok: true } });
    } catch (err) {
      logger.error('Failed to add ticket note', { err, ticketId });
      return reply.status(500).send({ error: 'Failed to add note to ticket' });
    }
  });
}
