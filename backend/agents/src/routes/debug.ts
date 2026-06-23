import type { FastifyInstance } from 'fastify';

export function debugRoutes(fastify: FastifyInstance) {
  fastify.get('/debug/uptime', async (_req, reply) => {
    return reply.status(200).send({ uptimeSeconds: process.uptime() });
  });
}
