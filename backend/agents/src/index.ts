import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { logger } from './logger.js';
import { registerRoute } from './routes/register.js';
import { ticketRoute } from './routes/ticket.js';
import { debugRoutes } from './routes/debug.js';
import { downloadsRoutes } from './routes/downloads.js';
import { enrollRoute } from './routes/enroll.js';
import { checkinRoute } from './routes/checkin.js';
import { bundleRoute } from './routes/bundle.js';
import { submitRoute } from './routes/submit.js';
import { ticketsV2Route } from './routes/tickets_v2.js';
import { updatesRoute } from './routes/updates.js';

const fastify = Fastify({ logger: false });

await fastify.register(cors, { origin: true, credentials: true });
await fastify.register(multipart, {
  // Don't 413 on oversized files — the handler checks part.file.truncated and
  // gracefully drops the attachment (see routes/ticket.ts). Screenshots can run
  // several MB, and the plugin default (1 MB) was aborting ticket submissions.
  throwFileSizeLimit: false,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
await fastify.register(fastifyStatic, {
  root: path.resolve(__dirname, '../assets/installers/scripts'),
  decorateReply: true,
  serve: false,
});

fastify.get('/health', async () => ({ status: 'ok' }));

// v1.0 routes — kept for backward compatibility with existing enrolled agents
registerRoute(fastify);
ticketRoute(fastify);
debugRoutes(fastify);
downloadsRoutes(fastify);

// v2.0 routes — token-based enrollment and authenticated checkin
enrollRoute(fastify);
checkinRoute(fastify);
bundleRoute(fastify);
submitRoute(fastify);
ticketsV2Route(fastify);
updatesRoute(fastify);

await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
logger.info('Agents server started', { port: env.PORT });

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down');
  await fastify.close();
  process.exit(0);
});
