import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { and, eq, isNull } from 'drizzle-orm';
import { agents } from '@mspbyte/drizzle';
import { getTenantDbForOrg } from '../db.js';
import { requireOrgId } from '../require-device.js';
import { env } from '../env.js';
import type { FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BINARIES_DIR = path.resolve(__dirname, '../../assets/binaries');

const PLATFORM_SLUGS = ['windows-x86_64', 'linux-x86_64', 'linux-aarch64', 'darwin-x86_64', 'darwin-aarch64'] as const;
type PlatformSlug = (typeof PLATFORM_SLUGS)[number];

function downloadUrl(base: string, platform: PlatformSlug, version: string): string {
  const ext = platform.startsWith('windows') ? '.exe' : '';
  return `${base}/v2.0/updates/download/${platform}/${version}${ext}`;
}

export function updatesRoute(fastify: FastifyInstance) {
  fastify.get('/v2.0/updates', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (!deviceId) return reply.status(401).send({ error: 'Missing X-Device-ID' });

    const orgId = requireOrgId(req, reply);
    if (!orgId) return;

    let db: Awaited<ReturnType<typeof getTenantDbForOrg>>;
    try {
      db = await getTenantDbForOrg(orgId);
    } catch {
      return reply.status(503).send({ error: 'Database unavailable' });
    }

    const [device] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, deviceId), isNull(agents.deletedAt)))
      .limit(1);

    if (!device) return reply.status(401).send({ error: 'Unknown or revoked device' });

    const latestVersion = env.AGENT_CORE_VERSION ?? '0.1.0';
    const baseUrl = env.AGENT_SERVER_URL ?? `http://localhost:${env.PORT}`;

    const platforms: Record<PlatformSlug, string> = {} as Record<PlatformSlug, string>;
    for (const slug of PLATFORM_SLUGS) {
      platforms[slug] = downloadUrl(baseUrl, slug, latestVersion);
    }

    return reply.send({
      data: {
        latest_version: latestVersion,
        platforms,
      },
    });
  });

  // Serve pre-built agent-core binaries. Files are named:
  //   agent-core-<platform>-<version>       (Unix)
  //   agent-core-<platform>-<version>.exe   (Windows)
  fastify.get<{ Params: { platform: string; version: string } }>(
    '/v2.0/updates/download/:platform/:version',
    async (req, reply) => {
      const { platform, version } = req.params;

      if (!PLATFORM_SLUGS.includes(platform as PlatformSlug)) {
        return reply.status(400).send({ error: 'Unknown platform' });
      }

      const ext = platform.startsWith('windows') ? '.exe' : '';
      const fileName = `agent-core-${platform}-${version}${ext}`;
      const filePath = path.join(BINARIES_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ error: 'Binary not found for this version/platform' });
      }

      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .send(fs.createReadStream(filePath));
    }
  );
}
