import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  agentTickets,
  agentLogs,
  agents,
  sites,
  integrations,
  integrationLinks
} from '@mspbyte/drizzle';
import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { Encryption } from '@mspbyte/encryption';
import { HaloPSAConnector } from '@mspbyte/connectors';
import type { HaloPSAAsset, HaloPSASite } from '@mspbyte/connectors';
import { logger } from '../logger.js';
import { env } from '../env.js';
import type { FastifyInstance } from 'fastify';

const BodySchema = z.object({
  screenshot: z.object({ name: z.string().optional(), data: z.string().optional() }).optional(),
  summary: z.string(),
  description: z.string().optional(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  impact: z.string(),
  urgency: z.string(),
  rmm_id: z.string().optional()
});

const PSAConfigSchema = z
  .object({
    url: z.string().default(''),
    clientId: z.string().default(''),
    clientSecret: z.string().default('')
  })
  .catch({ url: '', clientId: '', clientSecret: '' });

const URGENCY_MAP: Record<string, string> = { '1': '5', '2': '6', '3': '7' };

function buildDetailsHtml(params: {
  summary: string;
  description: string;
  name: string;
  email: string;
  phone: string;
  hostname: string;
  assetIds: number[];
  imageUrls: string[];
}): string {
  const lines: string[] = [
    '[User Submitted Request]',
    `Summary: ${params.summary}`,
    '',
    `Name: ${params.name}`,
    `Email: ${params.email}`,
    `Phone: ${params.phone}`,
    `Details: ${params.description}`,
    ''
  ];
  if (params.assetIds.length === 0) lines.push(`Device: ${params.hostname}`);

  const images = params.imageUrls
    .map((src) => `<img src="${src}" class="fr-fil fr-dib" width="720" height="374">`)
    .join('<br>');

  return `<p>${lines.join('<br>')}<br>${images}</p>`;
}

export function ticketRoute(fastify: FastifyInstance) {
  fastify.post('/v1.0/ticket/create', async (req, reply) => {
    const siteId = req.headers['x-site-id'] as string | undefined;
    const deviceId = req.headers['x-device-id'] as string | undefined;

    if (!siteId || !deviceId) {
      return reply.status(401).send({
        error: {
          module: 'v1.0/ticket/create',
          context: 'POST',
          message: 'Missing x-site-id or x-device-id headers'
        }
      });
    }

    let db: Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>['db'];
    try {
      ({ db } = await getTenantServiceDbByOrgId(env.ORG_ID, env.ENCRYPTION_KEY));
    } catch {
      return reply.status(404).send({
        error: { module: 'v1.0/ticket/create', context: 'POST', message: 'Org not found' }
      });
    }

    const [[agent], [site]] = await Promise.all([
      db.select().from(agents).where(eq(agents.id, deviceId)).limit(1),
      db.select().from(sites).where(eq(sites.id, siteId)).limit(1)
    ]);

    if (!agent || !site) {
      return reply.status(404).send({
        error: {
          module: 'v1.0/ticket/create',
          context: 'POST',
          message: 'Agent or site not found'
        }
      });
    }

    // Parse body — multipart or JSON
    let rawBody: Record<string, unknown> = {};
    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      let screenshotFile: { filename: string; data: Buffer } | null = null;
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'screenshot') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              if (Buffer.isBuffer(chunk)) chunks.push(chunk);
            }
            screenshotFile = {
              filename: part.filename ?? 'screenshot.png',
              data: Buffer.concat(chunks)
            };
          }
        } else {
          rawBody[part.fieldname] = part.value;
        }
      }
      if (screenshotFile) {
        rawBody.screenshot = {
          name: screenshotFile.filename,
          data: screenshotFile.data.toString('base64')
        };
      }
    } else {
      rawBody = (req.body as Record<string, unknown>) ?? {};
    }

    const bodyResult = BodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: { module: 'v1.0/ticket/create', context: 'POST', message: 'Invalid request body' }
      });
    }

    const body = bodyResult.data;

    // Look up PSA integration config + site link
    const [[psaIntegration], [psaLink]] = await Promise.all([
      db.select().from(integrations).where(eq(integrations.id, 'halopsa')).limit(1),
      db
        .select()
        .from(integrationLinks)
        .where(
          and(eq(integrationLinks.integrationId, 'halopsa'), eq(integrationLinks.siteId, siteId))
        )
        .limit(1)
    ]);

    if (!psaIntegration || !psaLink) {
      logger.warn('PSA not configured for site', { siteId, deviceId });
      return reply.status(200).send({
        error: { module: 'v1.0/ticket/create', context: 'POST', message: 'PSA not configured' }
      });
    }

    const psaConfig = PSAConfigSchema.parse(psaIntegration.config);
    const decryptedSecret = Encryption.decrypt(psaConfig.clientSecret, env.ENCRYPTION_KEY) ?? '';
    const connector = new HaloPSAConnector(psaConfig.url, psaConfig.clientId, decryptedSecret);

    const psaSiteId = psaLink.externalId ?? undefined;
    let assetIds: number[] = [];
    let imageUrls: string[] = [];

    // Fetch matching asset (best-effort)
    if (psaSiteId) {
      try {
        const assets = await connector.asset.list(psaSiteId);
        const match = assets.find((a: HaloPSAAsset) =>
          body.rmm_id
            ? a.datto_id === body.rmm_id || a.inventory_number === agent.hostname
            : a.inventory_number === agent.hostname
        );
        if (match) {
          assetIds = [match.id];
          logger.info('HaloPSA asset matched', { assetId: match.id, hostname: agent.hostname });
        }
      } catch {
        logger.warn('Failed to fetch HaloPSA assets', { siteId, hostname: agent.hostname });
      }
    }

    // Look up contact by email (best-effort)
    let contactId: number | undefined;
    if (body.email) {
      try {
        const contact = await connector.users.get(body.email);
        contactId = contact.id;
        logger.info('HaloPSA contact found', { contactId, email: body.email });
      } catch {
        // continue without contact
      }
    }

    // Upload screenshot (best-effort)
    if (body.screenshot?.data) {
      try {
        const binary = atob(body.screenshot.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/png' });
        const imageUrl = await connector.attachment.uploadImage(blob);
        if (imageUrl) imageUrls = [imageUrl];
        logger.info('Screenshot uploaded to HaloPSA', { hostname: agent.hostname });
      } catch {
        logger.warn('Failed to upload screenshot to HaloPSA', { hostname: agent.hostname });
      }
    }

    // Resolve parent company client_id (best-effort)
    let psaParentCompanyId: number | undefined;
    if (psaSiteId) {
      try {
        const haloSites = await connector.site.list();
        const haloSite = haloSites.find((s: HaloPSASite) => String(s.id) === psaSiteId);
        if (haloSite) psaParentCompanyId = haloSite.client_id;
      } catch {
        // non-fatal
      }
    }

    const details_html = buildDetailsHtml({
      summary: body.summary,
      description: body.description ?? '',
      name: body.name,
      email: body.email,
      phone: body.phone,
      hostname: agent.hostname,
      assetIds,
      imageUrls
    });

    const urgency = URGENCY_MAP[body.urgency] ?? body.urgency;

    const ticketBody = {
      site_id: psaSiteId ? Number(psaSiteId) : undefined,
      priority_id: 4,
      files: null,
      usertype: 1,
      user_id: contactId,
      reportedby: body.email,
      tickettype_id: 3,
      timerinuse: false,
      itil_tickettype_id: '-1',
      tickettype_group_id: '-1',
      summary: body.summary,
      details_html,
      category_1: 'Standard - Incident',
      impact: body.impact,
      urgency,
      donotapplytemplateintheapi: true,
      utcoffset: 300,
      form_id: 'newticket622a2b46-24eb-46b5-b5d1-4b1e6ed66834',
      dont_do_rules: true,
      return_this: false,
      phonenumber: body.phone,
      assets: assetIds.map((id) => ({ id }))
    } as Parameters<typeof connector.tickets.create>[0];

    let ticketId: string;
    try {
      ticketId = await connector.tickets.create(ticketBody);
    } catch (err) {
      logger.error('Failed to create HaloPSA ticket', { err, hostname: agent.hostname });
      try {
        await db.insert(agentLogs).values({
          agentId: agent.id,
          siteId: site.id,
          method: 'POST',
          message: `Failed to create ticket: ${body.summary}`,
          status: 500,
          timeElapsedMs: 0
        });
      } catch {
        // non-fatal
      }
      return reply.status(500).send({
        error: {
          module: 'v1.0/ticket/create',
          context: 'POST',
          message: 'Failed to create ticket'
        }
      });
    }

    logger.info('HaloPSA ticket created', {
      ticketId,
      hostname: agent.hostname,
      clientId: psaParentCompanyId
    });

    // Record ticket + log (best-effort — don't fail the response if logging fails)
    try {
      await db.insert(agentTickets).values({
        agentId: agent.id,
        siteId: site.id,
        ticketId,
        summary: body.summary,
        meta: { description: body.description, impact: body.impact, urgency, assetIds, imageUrls }
      });
    } catch (err) {
      logger.warn('Failed to insert agentTickets record', { err });
    }

    return reply.status(200).send({ data: ticketId });
  });
}
