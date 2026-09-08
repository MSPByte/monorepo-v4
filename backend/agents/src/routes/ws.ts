import { and, eq, isNull } from 'drizzle-orm';
import { agents } from '@mspbyte/drizzle';
import { getTenantDbForOrg } from '../db.js';
import { registerDevice, unregisterDevice } from '../push.js';
import { logger } from '../logger.js';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';

export function wsRoute(fastify: FastifyInstance) {
  fastify.get('/v2.0/ws', { websocket: true }, async (socket: WebSocket, req) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    const orgId = (req.headers['x-org-id'] as string | undefined)?.trim();

    if (!deviceId || !orgId) {
      socket.close(4001, 'Missing X-Device-ID or X-Org-ID');
      return;
    }

    let db: Awaited<ReturnType<typeof getTenantDbForOrg>>;
    try {
      db = await getTenantDbForOrg(orgId);
    } catch {
      socket.close(4003, 'Database unavailable');
      return;
    }

    const [device] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, deviceId), isNull(agents.deletedAt)))
      .limit(1);

    if (!device) {
      socket.close(4001, 'Unknown or revoked device');
      return;
    }

    logger.info('WS device connected', { deviceId, orgId });
    registerDevice(deviceId, orgId, socket);

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Agent sends { kind: 'pong' } replies — nothing to do.
        if (msg?.kind === 'pong') return;
      } catch { /* ignore non-JSON */ }
    });

    socket.on('close', () => {
      logger.info('WS device disconnected', { deviceId });
      unregisterDevice(deviceId);
    });

    socket.on('error', (err) => {
      logger.warn('WS device error', { deviceId, err: String(err) });
      unregisterDevice(deviceId);
    });
  });
}
