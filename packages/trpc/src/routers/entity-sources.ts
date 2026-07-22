import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, ilike, or, type SQL } from 'drizzle-orm';
import {
  assets,
  coveEndpoints,
  customerLogs,
  dattoEndpoints,
  entitySources,
  integrationLinks,
  m365Devices,
  m365Identities,
  people,
  sophosEndpoints,
  sophosFirewalls
} from '@mspbyte/drizzle';
import { ActionLabels, hasPermission } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';

type Db = Context['db'];

const canonicalType = z.enum(['person', 'asset']);

type CanonicalType = z.infer<typeof canonicalType>;

type VendorCandidate = {
  vendorTable: string;
  vendorRecordId: string;
  externalId: string;
  linkId: string | null;
  linkName: string | null;
  linkStatus: string | null;
  integrationId: string | null;
  siteId: string | null;
  label: string;
  subtitle: string | null;
  currentSourceId: string | null;
  currentCanonicalId: string | null;
  currentStatus: string | null;
  currentConfidence: number | null;
};

function requireAssetsWrite(attributes: unknown) {
  const attrs = (attributes as Record<string, boolean>) ?? null;
  if (!hasPermission(attrs, 'Assets.Write')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Write permission required' });
  }
}

function requireAssetsDelete(attributes: unknown) {
  const attrs = (attributes as Record<string, boolean>) ?? null;
  if (!hasPermission(attrs, 'Assets.Delete')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Delete permission required' });
  }
}

async function loadCanonicalTarget(
  db: Db,
  type: CanonicalType,
  id: string
): Promise<{ siteId: string | null; label: string } | null> {
  if (type === 'asset') {
    const [row] = await db
      .select({
        id: assets.id,
        siteId: assets.siteId,
        hostname: assets.hostname,
        displayName: assets.displayName
      })
      .from(assets)
      .where(eq(assets.id, id))
      .limit(1);
    if (!row) return null;
    return { siteId: row.siteId, label: row.hostname ?? row.displayName };
  }
  const [row] = await db
    .select({
      id: people.id,
      siteId: people.siteId,
      displayName: people.displayName,
      primaryEmail: people.primaryEmail
    })
    .from(people)
    .where(eq(people.id, id))
    .limit(1);
  if (!row) return null;
  return { siteId: row.siteId, label: row.displayName || row.primaryEmail };
}

async function searchM365Identities(
  ctxDb: Db,
  opts: { search: string; siteId: string | null; limit: number }
): Promise<VendorCandidate[]> {
  const conds: SQL[] = [];
  if (opts.search) {
    const like = `%${opts.search}%`;
    conds.push(
      or(
        ilike(m365Identities.name, like),
        ilike(m365Identities.email, like),
        ilike(m365Identities.externalId, like)
      )!
    );
  }
  const rows = await ctxDb
    .select({
      vendorRecordId: m365Identities.id,
      externalId: m365Identities.externalId,
      linkId: m365Identities.linkId,
      siteId: m365Identities.siteId,
      label: m365Identities.name,
      subtitle: m365Identities.email,
      linkName: integrationLinks.name,
      linkStatus: integrationLinks.status,
      integrationId: integrationLinks.integrationId,
      currentSourceId: entitySources.id,
      currentCanonicalId: entitySources.canonicalId,
      currentStatus: entitySources.status,
      currentConfidence: entitySources.confidence
    })
    .from(m365Identities)
    .leftJoin(integrationLinks, eq(integrationLinks.id, m365Identities.linkId))
    .leftJoin(
      entitySources,
      and(
        eq(entitySources.vendorTable, 'm365_identities'),
        eq(entitySources.vendorRecordId, m365Identities.id)
      )
    )
    .where(conds.length ? and(...conds) : undefined)
    .limit(opts.limit);

  return rows.map((r) => ({
    vendorTable: 'm365_identities',
    vendorRecordId: r.vendorRecordId,
    externalId: r.externalId,
    linkId: r.linkId,
    linkName: r.linkName,
    linkStatus: r.linkStatus,
    integrationId: r.integrationId,
    siteId: r.siteId,
    label: r.label,
    subtitle: r.subtitle,
    currentSourceId: r.currentSourceId,
    currentCanonicalId: r.currentCanonicalId,
    currentStatus: r.currentStatus,
    currentConfidence: r.currentConfidence
  }));
}

async function searchM365Devices(
  ctxDb: Db,
  opts: { search: string; siteId: string | null; limit: number }
): Promise<VendorCandidate[]> {
  const conds: SQL[] = [];
  if (opts.search) {
    const like = `%${opts.search}%`;
    conds.push(
      or(ilike(m365Devices.displayName, like), ilike(m365Devices.externalId, like))!
    );
  }
  const rows = await ctxDb
    .select({
      vendorRecordId: m365Devices.id,
      externalId: m365Devices.externalId,
      linkId: m365Devices.linkId,
      label: m365Devices.displayName,
      subtitle: m365Devices.operatingSystem,
      linkName: integrationLinks.name,
      linkStatus: integrationLinks.status,
      integrationId: integrationLinks.integrationId,
      linkSiteId: integrationLinks.siteId,
      currentSourceId: entitySources.id,
      currentCanonicalId: entitySources.canonicalId,
      currentStatus: entitySources.status,
      currentConfidence: entitySources.confidence
    })
    .from(m365Devices)
    .leftJoin(integrationLinks, eq(integrationLinks.id, m365Devices.linkId))
    .leftJoin(
      entitySources,
      and(
        eq(entitySources.vendorTable, 'm365_devices'),
        eq(entitySources.vendorRecordId, m365Devices.id)
      )
    )
    .where(conds.length ? and(...conds) : undefined)
    .limit(opts.limit);

  return rows.map((r) => ({
    vendorTable: 'm365_devices',
    vendorRecordId: r.vendorRecordId,
    externalId: r.externalId,
    linkId: r.linkId,
    linkName: r.linkName,
    linkStatus: r.linkStatus,
    integrationId: r.integrationId,
    siteId: r.linkSiteId,
    label: r.label,
    subtitle: r.subtitle,
    currentSourceId: r.currentSourceId,
    currentCanonicalId: r.currentCanonicalId,
    currentStatus: r.currentStatus,
    currentConfidence: r.currentConfidence
  }));
}

async function searchSophosEndpoints(
  ctxDb: Db,
  opts: { search: string; siteId: string | null; limit: number }
): Promise<VendorCandidate[]> {
  const conds: SQL[] = [];
  if (opts.search) {
    const like = `%${opts.search}%`;
    conds.push(
      or(ilike(sophosEndpoints.hostname, like), ilike(sophosEndpoints.externalId, like))!
    );
  }
  const rows = await ctxDb
    .select({
      vendorRecordId: sophosEndpoints.id,
      externalId: sophosEndpoints.externalId,
      linkId: sophosEndpoints.linkId,
      siteId: sophosEndpoints.siteId,
      label: sophosEndpoints.hostname,
      subtitle: sophosEndpoints.osName,
      linkName: integrationLinks.name,
      linkStatus: integrationLinks.status,
      integrationId: integrationLinks.integrationId,
      currentSourceId: entitySources.id,
      currentCanonicalId: entitySources.canonicalId,
      currentStatus: entitySources.status,
      currentConfidence: entitySources.confidence
    })
    .from(sophosEndpoints)
    .leftJoin(integrationLinks, eq(integrationLinks.id, sophosEndpoints.linkId))
    .leftJoin(
      entitySources,
      and(
        eq(entitySources.vendorTable, 'sophos_endpoints'),
        eq(entitySources.vendorRecordId, sophosEndpoints.id)
      )
    )
    .where(conds.length ? and(...conds) : undefined)
    .limit(opts.limit);

  return rows.map((r) => ({
    vendorTable: 'sophos_endpoints',
    vendorRecordId: r.vendorRecordId,
    externalId: r.externalId,
    linkId: r.linkId,
    linkName: r.linkName,
    linkStatus: r.linkStatus,
    integrationId: r.integrationId,
    siteId: r.siteId,
    label: r.label,
    subtitle: r.subtitle,
    currentSourceId: r.currentSourceId,
    currentCanonicalId: r.currentCanonicalId,
    currentStatus: r.currentStatus,
    currentConfidence: r.currentConfidence
  }));
}

async function searchSophosFirewalls(
  ctxDb: Db,
  opts: { search: string; siteId: string | null; limit: number }
): Promise<VendorCandidate[]> {
  const conds: SQL[] = [];
  if (opts.search) {
    const like = `%${opts.search}%`;
    conds.push(
      or(
        ilike(sophosFirewalls.name, like),
        ilike(sophosFirewalls.hostname, like),
        ilike(sophosFirewalls.externalId, like)
      )!
    );
  }
  const rows = await ctxDb
    .select({
      vendorRecordId: sophosFirewalls.id,
      externalId: sophosFirewalls.externalId,
      linkId: sophosFirewalls.linkId,
      siteId: sophosFirewalls.siteId,
      label: sophosFirewalls.name,
      subtitle: sophosFirewalls.hostname,
      linkName: integrationLinks.name,
      linkStatus: integrationLinks.status,
      integrationId: integrationLinks.integrationId,
      currentSourceId: entitySources.id,
      currentCanonicalId: entitySources.canonicalId,
      currentStatus: entitySources.status,
      currentConfidence: entitySources.confidence
    })
    .from(sophosFirewalls)
    .leftJoin(integrationLinks, eq(integrationLinks.id, sophosFirewalls.linkId))
    .leftJoin(
      entitySources,
      and(
        eq(entitySources.vendorTable, 'sophos_firewalls'),
        eq(entitySources.vendorRecordId, sophosFirewalls.id)
      )
    )
    .where(conds.length ? and(...conds) : undefined)
    .limit(opts.limit);

  return rows.map((r) => ({
    vendorTable: 'sophos_firewalls',
    vendorRecordId: r.vendorRecordId,
    externalId: r.externalId,
    linkId: r.linkId,
    linkName: r.linkName,
    linkStatus: r.linkStatus,
    integrationId: r.integrationId,
    siteId: r.siteId,
    label: r.label,
    subtitle: r.subtitle,
    currentSourceId: r.currentSourceId,
    currentCanonicalId: r.currentCanonicalId,
    currentStatus: r.currentStatus,
    currentConfidence: r.currentConfidence
  }));
}

async function searchDattoEndpoints(
  ctxDb: Db,
  opts: { search: string; siteId: string | null; limit: number }
): Promise<VendorCandidate[]> {
  const conds: SQL[] = [];
  if (opts.search) {
    const like = `%${opts.search}%`;
    conds.push(
      or(ilike(dattoEndpoints.hostname, like), ilike(dattoEndpoints.externalId, like))!
    );
  }
  const rows = await ctxDb
    .select({
      vendorRecordId: dattoEndpoints.id,
      externalId: dattoEndpoints.externalId,
      linkId: dattoEndpoints.linkId,
      siteId: dattoEndpoints.siteId,
      label: dattoEndpoints.hostname,
      subtitle: dattoEndpoints.os,
      linkName: integrationLinks.name,
      linkStatus: integrationLinks.status,
      integrationId: integrationLinks.integrationId,
      currentSourceId: entitySources.id,
      currentCanonicalId: entitySources.canonicalId,
      currentStatus: entitySources.status,
      currentConfidence: entitySources.confidence
    })
    .from(dattoEndpoints)
    .leftJoin(integrationLinks, eq(integrationLinks.id, dattoEndpoints.linkId))
    .leftJoin(
      entitySources,
      and(
        eq(entitySources.vendorTable, 'datto_endpoints'),
        eq(entitySources.vendorRecordId, dattoEndpoints.id)
      )
    )
    .where(conds.length ? and(...conds) : undefined)
    .limit(opts.limit);

  return rows.map((r) => ({
    vendorTable: 'datto_endpoints',
    vendorRecordId: r.vendorRecordId,
    externalId: r.externalId,
    linkId: r.linkId,
    linkName: r.linkName,
    linkStatus: r.linkStatus,
    integrationId: r.integrationId,
    siteId: r.siteId,
    label: r.label,
    subtitle: r.subtitle,
    currentSourceId: r.currentSourceId,
    currentCanonicalId: r.currentCanonicalId,
    currentStatus: r.currentStatus,
    currentConfidence: r.currentConfidence
  }));
}

async function searchCoveEndpoints(
  ctxDb: Db,
  opts: { search: string; siteId: string | null; limit: number }
): Promise<VendorCandidate[]> {
  const conds: SQL[] = [];
  if (opts.search) {
    const like = `%${opts.search}%`;
    conds.push(
      or(
        ilike(coveEndpoints.hostname, like),
        ilike(coveEndpoints.endpointName, like),
        ilike(coveEndpoints.externalId, like)
      )!
    );
  }
  const rows = await ctxDb
    .select({
      vendorRecordId: coveEndpoints.id,
      externalId: coveEndpoints.externalId,
      linkId: coveEndpoints.linkId,
      siteId: coveEndpoints.siteId,
      label: coveEndpoints.hostname,
      subtitle: coveEndpoints.endpointName,
      linkName: integrationLinks.name,
      linkStatus: integrationLinks.status,
      integrationId: integrationLinks.integrationId,
      currentSourceId: entitySources.id,
      currentCanonicalId: entitySources.canonicalId,
      currentStatus: entitySources.status,
      currentConfidence: entitySources.confidence
    })
    .from(coveEndpoints)
    .leftJoin(integrationLinks, eq(integrationLinks.id, coveEndpoints.linkId))
    .leftJoin(
      entitySources,
      and(
        eq(entitySources.vendorTable, 'cove_endpoints'),
        eq(entitySources.vendorRecordId, coveEndpoints.id)
      )
    )
    .where(conds.length ? and(...conds) : undefined)
    .limit(opts.limit);

  return rows.map((r) => ({
    vendorTable: 'cove_endpoints',
    vendorRecordId: r.vendorRecordId,
    externalId: r.externalId,
    linkId: r.linkId,
    linkName: r.linkName,
    linkStatus: r.linkStatus,
    integrationId: r.integrationId,
    siteId: r.siteId,
    label: r.label,
    subtitle: r.subtitle,
    currentSourceId: r.currentSourceId,
    currentCanonicalId: r.currentCanonicalId,
    currentStatus: r.currentStatus,
    currentConfidence: r.currentConfidence
  }));
}

const PROVIDER_FOR_TABLE: Record<string, string> = {
  m365_identities: 'microsoft-365',
  m365_devices: 'microsoft-365',
  sophos_endpoints: 'sophos-partner',
  sophos_firewalls: 'sophos-partner',
  datto_endpoints: 'dattormm',
  cove_endpoints: 'cove'
};

const TYPE_FOR_TABLE: Record<string, string> = {
  m365_identities: 'identity',
  m365_devices: 'device',
  sophos_endpoints: 'endpoint',
  sophos_firewalls: 'firewall',
  datto_endpoints: 'endpoint',
  cove_endpoints: 'endpoint'
};

const CANONICAL_TABLE_SUPPORT: Record<CanonicalType, readonly string[]> = {
  person: ['m365_identities'],
  asset: [
    'm365_devices',
    'sophos_endpoints',
    'sophos_firewalls',
    'datto_endpoints',
    'cove_endpoints'
  ]
};

export const entitySourcesRouter = t.router({
  candidateVendorRecords: authProcedure
    .input(
      z.object({
        canonicalType,
        canonicalId: z.string().uuid(),
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(50).default(20)
      })
    )
    .query(async ({ ctx, input }) => {
      const search = input.search?.trim() ?? '';
      const perTable = Math.max(5, Math.ceil(input.limit));

      let results: VendorCandidate[] = [];
      if (input.canonicalType === 'person') {
        results = await searchM365Identities(ctx.db, {
          search,
          siteId: null,
          limit: perTable
        });
      } else {
        const [devices, sEnd, sFw, datto, cove] = await Promise.all([
          searchM365Devices(ctx.db, { search, siteId: null, limit: perTable }),
          searchSophosEndpoints(ctx.db, { search, siteId: null, limit: perTable }),
          searchSophosFirewalls(ctx.db, { search, siteId: null, limit: perTable }),
          searchDattoEndpoints(ctx.db, { search, siteId: null, limit: perTable }),
          searchCoveEndpoints(ctx.db, { search, siteId: null, limit: perTable })
        ]);
        results = [...devices, ...sEnd, ...sFw, ...datto, ...cove];
      }

      const alreadyLinkedHere = (r: VendorCandidate) =>
        r.currentCanonicalId === input.canonicalId && r.currentStatus === 'confirmed';

      const sorted = results
        .filter((r) => !alreadyLinkedHere(r))
        .sort((a, b) => {
          const aFree = !a.currentSourceId ? 0 : 1;
          const bFree = !b.currentSourceId ? 0 : 1;
          if (aFree !== bFree) return aFree - bFree;
          return (a.label ?? '').localeCompare(b.label ?? '');
        })
        .slice(0, input.limit);

      return sorted;
    }),

  link: authProcedure
    .input(
      z.object({
        canonicalType,
        canonicalId: z.string().uuid(),
        vendorTable: z.string(),
        vendorRecordId: z.string().uuid()
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireAssetsWrite(ctx.role.attributes);

      const allowed = CANONICAL_TABLE_SUPPORT[input.canonicalType];
      if (!allowed.includes(input.vendorTable)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Vendor table ${input.vendorTable} cannot be linked to a ${input.canonicalType}`
        });
      }

      const target = await loadCanonicalTarget(ctx.db, input.canonicalType, input.canonicalId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Canonical entity not found' });

      const provider = PROVIDER_FOR_TABLE[input.vendorTable];
      const type = TYPE_FOR_TABLE[input.vendorTable] ?? 'record';
      if (!provider) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown vendor table' });
      }

      // Look up vendor record's link/site/externalId via the entity_sources unique key.
      // We need externalId & linkId; source them from the vendor row via a raw select.
      const vendorInfo = await lookupVendorRecord(ctx.db, input.vendorTable, input.vendorRecordId);
      if (!vendorInfo) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor record not found' });
      }

      const now = new Date().toISOString();

      // Find existing entity_source row (unique on vendorTable, vendorRecordId).
      const [existing] = await ctx.db
        .select()
        .from(entitySources)
        .where(
          and(
            eq(entitySources.vendorTable, input.vendorTable),
            eq(entitySources.vendorRecordId, input.vendorRecordId)
          )
        )
        .limit(1);

      let sourceId: string;
      let previousStatus: string | null = null;
      let previousCanonicalId: string | null = null;

      if (existing) {
        previousStatus = existing.status;
        previousCanonicalId = existing.canonicalId;
        const [updated] = await ctx.db
          .update(entitySources)
          .set({
            canonicalType: input.canonicalType,
            canonicalId: input.canonicalId,
            status: 'confirmed',
            matchMethod: 'manual',
            confidence: 100,
            manuallyConfirmedAt: now,
            manuallyRejectedAt: null,
            updatedAt: now
          })
          .where(eq(entitySources.id, existing.id))
          .returning({ id: entitySources.id });
        sourceId = updated!.id;
      } else {
        const [inserted] = await ctx.db
          .insert(entitySources)
          .values({
            canonicalType: input.canonicalType,
            canonicalId: input.canonicalId,
            vendorTable: input.vendorTable,
            vendorRecordId: input.vendorRecordId,
            linkId: vendorInfo.linkId,
            siteId: vendorInfo.siteId,
            provider,
            type,
            externalId: vendorInfo.externalId,
            confidence: 100,
            matchMethod: 'manual',
            matchEvidence: { source: 'user', actorId: ctx.user.id },
            status: 'confirmed',
            manuallyConfirmedAt: now
          })
          .returning({ id: entitySources.id });
        sourceId = inserted!.id;
      }

      await ctx.db.insert(customerLogs).values({
        siteId: target.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: existing ? 'update' : 'create',
        actionLabel: ActionLabels.EntitySourceLink,
        targetType: `${input.canonicalType}_source`,
        targetId: sourceId,
        targetLabel: `${target.label} ↔ ${vendorInfo.label ?? input.vendorRecordId}`,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          canonicalType: input.canonicalType,
          canonicalId: input.canonicalId,
          vendorTable: input.vendorTable,
          vendorRecordId: input.vendorRecordId,
          provider,
          linkId: vendorInfo.linkId,
          externalId: vendorInfo.externalId,
          previousStatus,
          previousCanonicalId,
          matchMethod: 'manual'
        }
      });

      return { id: sourceId };
    }),

  unlink: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAssetsDelete(ctx.role.attributes);

      const [row] = await ctx.db
        .select()
        .from(entitySources)
        .where(eq(entitySources.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source binding not found' });

      const target = await loadCanonicalTarget(ctx.db, row.canonicalType, row.canonicalId);

      const [deleted] = await ctx.db
        .delete(entitySources)
        .where(eq(entitySources.id, input.id))
        .returning({ id: entitySources.id });

      await ctx.db.insert(customerLogs).values({
        siteId: row.siteId ?? target?.siteId ?? null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'delete',
        actionLabel: ActionLabels.EntitySourceUnlink,
        targetType: `${row.canonicalType}_source`,
        targetId: row.id,
        targetLabel: `${target?.label ?? row.canonicalId} ↔ ${row.provider}:${row.externalId}`,
        result: deleted ? 'success' : 'failure',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          canonicalType: row.canonicalType,
          canonicalId: row.canonicalId,
          vendorTable: row.vendorTable,
          vendorRecordId: row.vendorRecordId,
          provider: row.provider,
          externalId: row.externalId,
          previousStatus: row.status,
          previousConfidence: row.confidence,
          previousMatchMethod: row.matchMethod,
          linkId: row.linkId
        }
      });

      return { id: input.id };
    }),

  confirm: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAssetsWrite(ctx.role.attributes);

      const [row] = await ctx.db
        .select()
        .from(entitySources)
        .where(eq(entitySources.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source binding not found' });

      if (row.status === 'confirmed') {
        return { id: row.id, status: 'confirmed' as const };
      }

      const now = new Date().toISOString();
      const [updated] = await ctx.db
        .update(entitySources)
        .set({
          status: 'confirmed',
          manuallyConfirmedAt: now,
          manuallyRejectedAt: null,
          updatedAt: now
        })
        .where(eq(entitySources.id, input.id))
        .returning({ id: entitySources.id });

      const target = await loadCanonicalTarget(ctx.db, row.canonicalType, row.canonicalId);

      await ctx.db.insert(customerLogs).values({
        siteId: row.siteId ?? target?.siteId ?? null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'update',
        actionLabel: ActionLabels.EntitySourceConfirm,
        targetType: `${row.canonicalType}_source`,
        targetId: row.id,
        targetLabel: `${target?.label ?? row.canonicalId} ↔ ${row.provider}:${row.externalId}`,
        result: updated ? 'success' : 'failure',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          canonicalType: row.canonicalType,
          canonicalId: row.canonicalId,
          vendorTable: row.vendorTable,
          vendorRecordId: row.vendorRecordId,
          provider: row.provider,
          externalId: row.externalId,
          previousStatus: row.status,
          newStatus: 'confirmed',
          matchMethod: row.matchMethod,
          confidence: row.confidence
        }
      });

      return { id: row.id, status: 'confirmed' as const };
    }),

  reject: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAssetsWrite(ctx.role.attributes);

      const [row] = await ctx.db
        .select()
        .from(entitySources)
        .where(eq(entitySources.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source binding not found' });

      const now = new Date().toISOString();
      const [updated] = await ctx.db
        .update(entitySources)
        .set({
          status: 'rejected',
          manuallyRejectedAt: now,
          manuallyConfirmedAt: null,
          updatedAt: now
        })
        .where(eq(entitySources.id, input.id))
        .returning({ id: entitySources.id });

      const target = await loadCanonicalTarget(ctx.db, row.canonicalType, row.canonicalId);

      await ctx.db.insert(customerLogs).values({
        siteId: row.siteId ?? target?.siteId ?? null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'update',
        actionLabel: ActionLabels.EntitySourceReject,
        targetType: `${row.canonicalType}_source`,
        targetId: row.id,
        targetLabel: `${target?.label ?? row.canonicalId} ↔ ${row.provider}:${row.externalId}`,
        result: updated ? 'success' : 'failure',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          canonicalType: row.canonicalType,
          canonicalId: row.canonicalId,
          vendorTable: row.vendorTable,
          vendorRecordId: row.vendorRecordId,
          provider: row.provider,
          externalId: row.externalId,
          previousStatus: row.status,
          newStatus: 'rejected',
          matchMethod: row.matchMethod,
          confidence: row.confidence
        }
      });

      return { id: row.id, status: 'rejected' as const };
    })
});

async function lookupVendorRecord(
  db: Db,
  vendorTable: string,
  vendorRecordId: string
): Promise<{ externalId: string; linkId: string | null; siteId: string | null; label: string | null } | null> {
  switch (vendorTable) {
    case 'm365_identities': {
      const [row] = await db
        .select({
          externalId: m365Identities.externalId,
          linkId: m365Identities.linkId,
          siteId: m365Identities.siteId,
          label: m365Identities.name
        })
        .from(m365Identities)
        .where(eq(m365Identities.id, vendorRecordId))
        .limit(1);
      return row ?? null;
    }
    case 'm365_devices': {
      const [row] = await db
        .select({
          externalId: m365Devices.externalId,
          linkId: m365Devices.linkId,
          linkSiteId: integrationLinks.siteId,
          label: m365Devices.displayName
        })
        .from(m365Devices)
        .leftJoin(integrationLinks, eq(integrationLinks.id, m365Devices.linkId))
        .where(eq(m365Devices.id, vendorRecordId))
        .limit(1);
      if (!row) return null;
      return {
        externalId: row.externalId,
        linkId: row.linkId,
        siteId: row.linkSiteId ?? null,
        label: row.label
      };
    }
    case 'sophos_endpoints': {
      const [row] = await db
        .select({
          externalId: sophosEndpoints.externalId,
          linkId: sophosEndpoints.linkId,
          siteId: sophosEndpoints.siteId,
          label: sophosEndpoints.hostname
        })
        .from(sophosEndpoints)
        .where(eq(sophosEndpoints.id, vendorRecordId))
        .limit(1);
      return row ?? null;
    }
    case 'sophos_firewalls': {
      const [row] = await db
        .select({
          externalId: sophosFirewalls.externalId,
          linkId: sophosFirewalls.linkId,
          siteId: sophosFirewalls.siteId,
          label: sophosFirewalls.name
        })
        .from(sophosFirewalls)
        .where(eq(sophosFirewalls.id, vendorRecordId))
        .limit(1);
      return row ?? null;
    }
    case 'datto_endpoints': {
      const [row] = await db
        .select({
          externalId: dattoEndpoints.externalId,
          linkId: dattoEndpoints.linkId,
          siteId: dattoEndpoints.siteId,
          label: dattoEndpoints.hostname
        })
        .from(dattoEndpoints)
        .where(eq(dattoEndpoints.id, vendorRecordId))
        .limit(1);
      return row ?? null;
    }
    case 'cove_endpoints': {
      const [row] = await db
        .select({
          externalId: coveEndpoints.externalId,
          linkId: coveEndpoints.linkId,
          siteId: coveEndpoints.siteId,
          label: coveEndpoints.hostname
        })
        .from(coveEndpoints)
        .where(eq(coveEndpoints.id, vendorRecordId))
        .limit(1);
      return row ?? null;
    }
    default:
      return null;
  }
}
