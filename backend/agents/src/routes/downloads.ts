import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import type { FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS_DIR = path.resolve(__dirname, '../../assets/installers');
const DMG_DIR = path.join(ASSETS_DIR, 'dmg');
const SCRIPTS_DIR = path.join(ASSETS_DIR, 'scripts');

export function downloadsRoutes(fastify: FastifyInstance) {
  fastify.get('/downloads/macos/app', async (_req, reply) => {
    const fileName = 'MSPAgent_0.1.14.dmg';
    return reply
      .header('Content-Type', 'application/x-apple-diskimage')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .sendFile(fileName, DMG_DIR);
  });

  fastify.get('/downloads/macos/install', async (_req, reply) => {
    const fileName = 'install_mspagent_mac.sh';
    return reply
      .header('Content-Type', 'text/x-shellscript')
      .header('Content-Disposition', `inline; filename="${fileName}"`)
      .sendFile(fileName, SCRIPTS_DIR);
  });

  fastify.get('/downloads/macos/uninstall', async (_req, reply) => {
    const fileName = 'uninstall_mspagent_mac.sh';
    return reply
      .header('Content-Type', 'text/x-shellscript')
      .header('Content-Disposition', `inline; filename="${fileName}"`)
      .sendFile(fileName, SCRIPTS_DIR);
  });
}
