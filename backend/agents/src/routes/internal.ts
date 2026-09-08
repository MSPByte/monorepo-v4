import crypto from 'node:crypto';
import { pushToOrg, listConnections } from '../push.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';

function authCheck(req: FastifyRequest, secret: string | undefined): boolean {
  const provided = (req.headers['x-internal-secret'] as string | undefined)?.trim();
  return !!(secret && provided === secret);
}

// Each org gets a unique HMAC-derived secret so a leaked credential only
// affects one tenant. The master secret never leaves our infrastructure.
export function deriveOrgWebhookSecret(orgId: string): string | null {
  if (!env.AGENTS_INTERNAL_SECRET) return null;
  return crypto
    .createHmac('sha256', env.AGENTS_INTERNAL_SECRET)
    .update(orgId)
    .digest('hex')
    .slice(0, 32);
}

export function internalRoutes(fastify: FastifyInstance) {
  // HaloPSA webhook: orgId is embedded in the URL so HaloPSA sends a static
  // per-tenant URL with no knowledge of internal routing details. Auth is via
  // the per-org derived secret (never the global AGENTS_INTERNAL_SECRET).
  fastify.post('/internal/webhook/halopsa/:orgId/ticket-event', async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const expected = deriveOrgWebhookSecret(orgId);
    if (!expected) return reply.status(503).send({ error: 'Webhook signing not configured' });

    const provided = (req.headers['x-internal-secret'] as string | undefined)?.trim();
    if (!provided || provided !== expected) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as Record<string, unknown>;

    // HaloPSA action webhooks include ticket_id on the action object.
    const rawTicketId = body['ticket_id'] ?? body['ticketid'];
    const ticket_id = rawTicketId != null ? String(rawTicketId) : undefined;

    if (!ticket_id) {
      logger.warn('HaloPSA webhook missing ticket_id', { orgId, body });
      return reply.status(400).send({ error: 'ticket_id not found in payload' });
    }

    const sent = pushToOrg(orgId, { kind: 'ticket_note_added', payload: { ticket_id } });
    logger.info('HaloPSA webhook ticket-event', { orgId, ticket_id, sent });
    return reply.send({ data: { sent } });
  });

  // Lists currently connected WS devices. Useful for verifying the push pipeline is alive.
  fastify.get('/internal/connections', async (req, reply) => {
    if (!authCheck(req, env.AGENTS_INTERNAL_SECRET)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const conns = listConnections();
    return reply.send({ data: { count: conns.length, connections: conns } });
  });

  // Dev-only: fire any push event without HMAC auth. Only active when DEV_TRIGGER_ENABLED=true.
  // Never set DEV_TRIGGER_ENABLED in production.
  fastify.post('/internal/dev/trigger', async (req, reply) => {
    if (!env.DEV_TRIGGER_ENABLED) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const { org_id, kind, ticket_id, status_name, etag } = req.body as {
      org_id?: string;
      kind?: string;
      ticket_id?: string;
      status_name?: string;
      etag?: string;
    };
    if (!org_id || !kind) {
      return reply.status(400).send({ error: 'org_id and kind required' });
    }

    let event: Parameters<typeof pushToOrg>[1] | null = null;
    if (kind === 'bundle_updated') {
      event = { kind: 'bundle_updated', payload: { etag } };
    } else if (kind === 'ticket_note_added' && ticket_id) {
      event = { kind: 'ticket_note_added', payload: { ticket_id } };
    } else if (kind === 'ticket_status_changed' && ticket_id && status_name) {
      event = { kind: 'ticket_status_changed', payload: { ticket_id, status_name } };
    } else {
      return reply.status(400).send({ error: 'Invalid kind or missing required fields' });
    }

    const sent = pushToOrg(org_id, event);
    logger.info('Dev trigger fired', { org_id, kind, sent });
    return reply.send({ data: { sent } });
  });

  fastify.post('/internal/bundle-updated', async (req, reply) => {
    if (!authCheck(req, env.AGENTS_INTERNAL_SECRET)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { org_id } = req.body as { org_id?: string };
    if (!org_id) return reply.status(400).send({ error: 'org_id required' });

    const sent = pushToOrg(org_id, { kind: 'bundle_updated', payload: {} });
    logger.info('Internal bundle-updated push', { org_id, sent });
    return reply.send({ data: { sent } });
  });

  fastify.post('/internal/ticket-event', async (req, reply) => {
    if (!authCheck(req, env.AGENTS_INTERNAL_SECRET)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { org_id, ticket_id, kind, status_name } = req.body as {
      org_id?: string;
      ticket_id?: string;
      kind?: 'ticket_note_added' | 'ticket_status_changed';
      status_name?: string;
    };

    if (!org_id || !ticket_id || !kind) {
      return reply.status(400).send({ error: 'org_id, ticket_id, and kind required' });
    }

    const event =
      kind === 'ticket_status_changed' && status_name
        ? { kind: 'ticket_status_changed' as const, payload: { ticket_id, status_name } }
        : { kind: 'ticket_note_added' as const, payload: { ticket_id } };

    const sent = pushToOrg(org_id, event);
    logger.info('Internal ticket-event push', { org_id, ticket_id, kind, sent });
    return reply.send({ data: { sent } });
  });
}
