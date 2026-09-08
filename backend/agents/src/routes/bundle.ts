import crypto from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { agents, agentBundles, agentBundleAssignments, agentForms, siteGroupMembers } from '@mspbyte/drizzle';
import { getTenantDbForOrg } from '../db.js';
import { requireOrgId } from '../require-device.js';
import { logger } from '../logger.js';
import type { FastifyInstance } from 'fastify';

export function bundleRoute(fastify: FastifyInstance) {
  fastify.get('/v2.0/bundle', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (!deviceId) {
      return reply.status(401).send({ error: 'Missing X-Device-ID' });
    }

    const orgId = requireOrgId(req, reply);
    if (!orgId) return;

    let db: Awaited<ReturnType<typeof getTenantDbForOrg>>;
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

    if (!device) {
      return reply.status(401).send({ error: 'Unknown or revoked device' });
    }

    const bundle = await resolveBundle(db, device.siteId);

    const enabledFormIds: string[] | undefined = (bundle?.data as Record<string, unknown> | undefined)
      ?.enabledFormIds as string[] | undefined;

    // Empty array = no forms (explicit opt-in); absent/non-array = no forms
    const fetchedForms =
      Array.isArray(enabledFormIds) && enabledFormIds.length > 0
        ? await db
            .select({ id: agentForms.id, name: agentForms.name, description: agentForms.description, rows: agentForms.rows })
            .from(agentForms)
            .where(and(isNull(agentForms.deletedAt), inArray(agentForms.id, enabledFormIds)))
        : [];

    // The builder's enabled form order is also the order shown in the tray.
    const forms = Array.isArray(enabledFormIds)
      ? enabledFormIds
          .map((id) => fetchedForms.find((form) => form.id === id))
          .filter((form): form is (typeof fetchedForms)[number] => Boolean(form))
      : fetchedForms;

    const merged = { ...(bundle?.data ?? {}), forms };
    const etag = crypto.createHash('sha256').update(JSON.stringify(merged)).digest('hex');

    const clientEtag = (req.headers['if-none-match'] as string | undefined)?.trim();
    if (clientEtag === etag) {
      return reply.status(304).send();
    }

    logger.info('Bundle served', { deviceId, siteId: device.siteId, etag, source: bundle?.source ?? 'none' });

    return reply
      .status(200)
      .header('ETag', etag)
      .send({ data: merged });
  });
}

export async function resolveBundle(
  db: Awaited<ReturnType<typeof getTenantDbForOrg>>,
  siteId: string
): Promise<{ data: unknown; source: 'site' | 'group' | 'default' } | null> {
  // 1. Site-specific assignment
  const [siteAssignment] = await db
    .select({ bundleId: agentBundleAssignments.bundleId })
    .from(agentBundleAssignments)
    .where(eq(agentBundleAssignments.siteId, siteId))
    .limit(1);

  if (siteAssignment) {
    const [bundle] = await db
      .select({ data: agentBundles.data })
      .from(agentBundles)
      .where(eq(agentBundles.id, siteAssignment.bundleId))
      .limit(1);
    if (bundle) return { data: bundle.data, source: 'site' };
  }

  // 2. Site group assignment — find all groups the site belongs to
  const memberOf = await db
    .select({ siteGroupId: siteGroupMembers.siteGroupId })
    .from(siteGroupMembers)
    .where(eq(siteGroupMembers.siteId, siteId));

  if (memberOf.length > 0) {
    const groupIds = memberOf.map((m) => m.siteGroupId);
    const [groupAssignment] = await db
      .select({ bundleId: agentBundleAssignments.bundleId })
      .from(agentBundleAssignments)
      .where(inArray(agentBundleAssignments.siteGroupId, groupIds))
      .limit(1);

    if (groupAssignment) {
      const [bundle] = await db
        .select({ data: agentBundles.data })
        .from(agentBundles)
        .where(eq(agentBundles.id, groupAssignment.bundleId))
        .limit(1);
      if (bundle) return { data: bundle.data, source: 'group' };
    }
  }

  // 3. Global default
  const [defaultBundle] = await db
    .select({ data: agentBundles.data })
    .from(agentBundles)
    .where(eq(agentBundles.isDefault, true))
    .limit(1);

  return defaultBundle ? { data: defaultBundle.data, source: 'default' } : null;
}
