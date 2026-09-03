import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import {
  agents,
  agentForms,
  agentTickets,
  agentLogs,
  integrations,
  integrationLinks,
  sites,
} from '@mspbyte/drizzle';
import { Encryption } from '@mspbyte/encryption';
import { HaloPSAConnector } from '@mspbyte/connectors';
import type { HaloPSAAsset, HaloPSASite } from '@mspbyte/connectors';
import { getTenantDb } from '../db.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import type { FastifyInstance } from 'fastify';

const AttachmentSchema = z.object({
  field_id: z.string(),
  name: z.string(),
  mime_type: z.string(),
  data_b64: z.string(),
});

const OsUserSchema = z.object({
  username: z.string(),
  sid: z.string().optional().nullable(),
  display_name: z.string().optional().nullable(),
});

const BodySchema = z.object({
  form_id: z.string().uuid(),
  answers: z.record(z.string(), z.unknown()),
  os_user: OsUserSchema,
  attachments: z.array(AttachmentSchema).default([]),
});

const PSAConfigSchema = z
  .object({
    url: z.string().default(''),
    clientId: z.string().default(''),
    clientSecret: z.string().default(''),
    fallbackSiteId: z.string().default('-1'),
  })
  .catch({ url: '', clientId: '', clientSecret: '', fallbackSiteId: '-1' });

type PsaMapping = { psa_field: string };

function getField(answers: Record<string, unknown>, mappings: Record<string, PsaMapping>, key: string): string {
  const fieldId = Object.keys(mappings).find((id) => mappings[id]?.psa_field === key);
  return fieldId ? String(answers[fieldId] ?? '') : '';
}

export function submitRoute(fastify: FastifyInstance) {
  fastify.post('/v2.0/submit', async (req, reply) => {
    const deviceId = (req.headers['x-device-id'] as string | undefined)?.trim();
    if (!deviceId) {
      return reply.status(401).send({ error: 'Missing X-Device-ID' });
    }

    let db: Awaited<ReturnType<typeof getTenantDb>>;
    try {
      db = await getTenantDb();
    } catch {
      return reply.status(503).send({ error: 'Database unavailable' });
    }

    const body = BodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body' });
    }
    const { form_id, answers, os_user, attachments } = body.data;

    // Validate device.
    const [device] = await db
      .select({ id: agents.id, siteId: agents.siteId, hostname: agents.hostname })
      .from(agents)
      .where(and(eq(agents.id, deviceId), isNull(agents.deletedAt)))
      .limit(1);

    if (!device) {
      return reply.status(401).send({ error: 'Unknown or revoked device' });
    }

    // Load form + PSA mappings (psa_mappings never sent to agents — used here only).
    const [form] = await db
      .select({ rows: agentForms.rows, psaMappings: agentForms.psaMappings })
      .from(agentForms)
      .where(and(eq(agentForms.id, form_id), isNull(agentForms.deletedAt)))
      .limit(1);

    if (!form) {
      return reply.status(404).send({ error: 'Form not found' });
    }

    const mappings = (form.psaMappings ?? {}) as Record<string, PsaMapping>;

    // Extract standard ticket fields via mappings.
    const summary    = getField(answers, mappings, 'summary') || `Support request from ${os_user.username}`;
    const description = getField(answers, mappings, 'description');
    const contactName = getField(answers, mappings, 'name') || os_user.display_name || os_user.username;
    const email       = getField(answers, mappings, 'email');
    const phone       = getField(answers, mappings, 'phone');

    // Load PSA config.
    const [[psaIntegration], [psaLink]] = await Promise.all([
      db.select().from(integrations).where(eq(integrations.id, 'halopsa')).limit(1),
      db.select().from(integrationLinks)
        .where(and(eq(integrationLinks.integrationId, 'halopsa'), eq(integrationLinks.siteId, device.siteId)))
        .limit(1),
    ]);

    if (!psaIntegration || !psaLink) {
      logger.warn('PSA not configured for site', { siteId: device.siteId });
      return reply.status(200).send({ error: 'PSA not configured for this site' });
    }

    const psaConfig = PSAConfigSchema.parse(psaIntegration.config);
    const decryptedSecret = Encryption.decrypt(psaConfig.clientSecret, env.ENCRYPTION_KEY) ?? '';
    const connector = new HaloPSAConnector(psaConfig.url, psaConfig.clientId, decryptedSecret);

    const linkedPsaSiteId = psaLink.externalId ?? undefined;

    // Verify linked PSA site (fall back gracefully).
    let linkedHaloSite: HaloPSASite | null = null;
    if (linkedPsaSiteId) {
      try {
        linkedHaloSite = await connector.site.get(linkedPsaSiteId);
      } catch {
        logger.warn('Failed to fetch HaloPSA site — using fallback', { linkedPsaSiteId });
      }
    }

    const psaSiteId = (linkedHaloSite ? linkedPsaSiteId : psaConfig.fallbackSiteId) || undefined;
    const usingFallback = !!linkedPsaSiteId && !linkedHaloSite;

    // Match asset (best-effort).
    let assetIds: number[] = [];
    if (psaSiteId && !usingFallback) {
      try {
        const assets = await connector.asset.list(psaSiteId);
        const match = assets.find((a: HaloPSAAsset) => a.inventory_number === device.hostname);
        if (match) assetIds = [match.id];
      } catch {
        logger.warn('Failed to fetch HaloPSA assets', { siteId: device.siteId });
      }
    }

    // Look up contact by email (best-effort).
    let contactId: number | undefined;
    if (email) {
      try {
        const contact = await connector.users.get(email);
        contactId = contact.id;
      } catch {
        // continue without contact
      }
    }

    // Upload image attachments (best-effort).
    const imageUrls: string[] = [];
    for (const att of attachments) {
      if (!att.mime_type.startsWith('image/')) continue;
      try {
        const binary = atob(att.data_b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: att.mime_type });
        const url = await connector.attachment.uploadImage(blob);
        if (url) imageUrls.push(url);
      } catch {
        logger.warn('Failed to upload attachment', { fieldId: att.field_id });
      }
    }

    const images = imageUrls
      .map((src) => `<img src="${src}" class="fr-fil fr-dib" width="720" height="374">`)
      .join('<br>');

    const detailLines = [
      `[Agent Form Submission]`,
      `Summary: ${summary}`,
      description ? `Details: ${description}` : '',
      `User: ${contactName}`,
      email ? `Email: ${email}` : '',
      phone ? `Phone: ${phone}` : '',
      `Device: ${device.hostname}`,
      `OS User: ${os_user.username}`,
      os_user.sid ? `SID: ${os_user.sid}` : '',
    ].filter(Boolean);

    const details_html = `<p>${detailLines.join('<br>')}<br>${images}</p>`;

    const psaParentCompanyId =
      !usingFallback && linkedHaloSite?.client_id != null ? linkedHaloSite.client_id : undefined;

    let ticketId: string;
    try {
      ticketId = await connector.tickets.create({
        site_id: psaSiteId ? Number(psaSiteId) : undefined,
        priority_id: 4,
        files: null,
        usertype: 1,
        user_id: contactId,
        reportedby: email || undefined,
        tickettype_id: 3,
        timerinuse: false,
        itil_tickettype_id: '-1',
        tickettype_group_id: '-1',
        summary,
        details_html,
        category_1: 'Standard - Incident',
        donotapplytemplateintheapi: true,
        utcoffset: 300,
        form_id: 'newticket622a2b46-24eb-46b5-b5d1-4b1e6ed66834',
        dont_do_rules: true,
        return_this: false,
        assets: assetIds.map((id) => ({ id })),
      } as Parameters<typeof connector.tickets.create>[0]);
    } catch (err) {
      logger.error('Failed to create HaloPSA ticket', { err, hostname: device.hostname });
      try {
        await db.insert(agentLogs).values({
          agentId: device.id,
          siteId: device.siteId,
          method: 'POST',
          message: `Failed to create ticket: ${summary}`,
          status: 500,
          timeElapsedMs: 0,
        });
      } catch { /* non-fatal */ }
      return reply.status(500).send({ error: 'Failed to create ticket' });
    }

    logger.info('HaloPSA ticket created via v2.0/submit', { ticketId, hostname: device.hostname, clientId: psaParentCompanyId });

    try {
      await db.insert(agentTickets).values({
        agentId: device.id,
        siteId: device.siteId,
        ticketId,
        summary,
        meta: { formId: form_id, osUser: os_user, answers, imageUrls, assetIds },
      });
    } catch (err) {
      logger.warn('Failed to insert agentTickets record', { err });
    }

    return reply.status(200).send({ data: { ticket_id: ticketId } });
  });
}
