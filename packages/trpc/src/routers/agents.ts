import crypto from 'node:crypto';
import { z } from 'zod';
import { and, count, desc, eq, inArray, isNull, max, sql, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  agents,
  agentLogs,
  agentTickets,
  agentSiteTokens,
  agentBundles,
  agentBundleAssignments,
  agentForms,
  customerLogs,
  sites,
  siteGroups,
  siteGroupMembers,
} from '@mspbyte/drizzle';
import { ActionLabels, Encryption } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import { loadGroupTargets } from './group-targets.js';

function deriveOrgWebhookSecret(orgId: string): string | null {
  const master = process.env.AGENTS_INTERNAL_SECRET;
  if (!master) return null;
  return crypto.createHmac('sha256', master).update(orgId).digest('hex').slice(0, 32);
}

async function notifyBundleUpdated(orgId: string): Promise<void> {
  const url = process.env.AGENTS_INTERNAL_URL;
  const secret = process.env.AGENTS_INTERNAL_SECRET;
  if (!url || !secret) return;
  try {
    await fetch(`${url}/internal/bundle-updated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
      body: JSON.stringify({ org_id: orgId }),
    });
  } catch { /* non-fatal — devices fall back to polling */ }
}

function scopedSiteFilter(scope: 'all' | readonly string[]) {
  if (scope === 'all') return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(agents.siteId, [...scope]);
}

const notDeleted = isNull(agents.deletedAt);

function requireEncryptionKey(ctx: { encryptionKey?: string }): string {
  const key = ctx.encryptionKey ?? process.env.ENCRYPTION_KEY;
  if (!key) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Encryption key not configured' });
  return key;
}

function generateToken(encryptionKey: string) {
  const plaintext = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(plaintext).digest('hex');
  const tokenEncrypted = Encryption.encrypt(plaintext, encryptionKey);
  return { plaintext, tokenHash, tokenEncrypted };
}

const BundleDataSchema = z.object({
  branding: z.object({
    appName: z.string().optional(),
    primaryColor: z.string().optional(),
    supportEmail: z.string().optional(),
    supportPhone: z.string().optional(),
    logoUrl: z.string().optional(),
  }).optional(),
  tray: z.object({
    show: z.boolean().optional(),
    label: z.string().optional(),
    showMyTickets: z.boolean().optional(),
  }).optional(),
  enabledFormIds: z.array(z.string().uuid()).default([]),
  primaryPsa: z.enum(['halopsa', 'connectwise', '']).optional(),
});

const ConfigInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  data: BundleDataSchema,
});

export const agentsRouter = t.router({
  siteOverview: authProcedure
    .input(z.object({ groupId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }
      const scope = ctx.scopeFor('Agents.Read');
      if (scope !== 'all' && scope.length === 0) return [];
      const groupTargets = input?.groupId ? await loadGroupTargets(ctx.db, input.groupId) : null;
      if (groupTargets && groupTargets.siteIds.length === 0) return [];

      const conditions = [
        notDeleted,
        scope === 'all' ? undefined : inArray(agents.siteId, [...scope]),
        groupTargets ? inArray(agents.siteId, groupTargets.siteIds) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      const rows = await ctx.db
        .select({
          siteId: agents.siteId,
          siteName: sites.name,
          agentCount: count(agents.id),
          lastCheckIn: max(agents.lastCheckinAt),
        })
        .from(agents)
        .leftJoin(sites, eq(sites.id, agents.siteId))
        .where(and(...conditions))
        .groupBy(agents.siteId, sites.name);

      return rows.map((row) => ({
        siteId: row.siteId,
        siteName: row.siteName ?? 'Unknown Site',
        agentCount: Number(row.agentCount ?? 0),
        lastCheckIn: row.lastCheckIn,
      }));
    }),

  list: authProcedure
    .input(z.object({ siteId: z.string().uuid().optional(), groupId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }
      const scope = ctx.scopeFor('Agents.Read');
      const siteId = input?.siteId;
      const groupId = input?.groupId;
      const groupTargets = groupId ? await loadGroupTargets(ctx.db, groupId) : null;

      if (siteId) {
        if (scope !== 'all' && !scope.includes(siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (groupTargets && groupTargets.siteIds.length === 0) {
        return [];
      } else if (scope !== 'all' && scope.length === 0) {
        return [];
      }

      const conditions = [
        notDeleted,
        siteId ? eq(agents.siteId, siteId) : undefined,
        !siteId && groupTargets ? inArray(agents.siteId, groupTargets.siteIds) : undefined,
        !siteId ? scopedSiteFilter(scope) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      return ctx.db
        .select({
          id: agents.id,
          siteId: agents.siteId,
          siteName: sites.name,
          hostname: agents.hostname,
          platform: agents.platform,
          version: agents.version,
          machineId: agents.machineId,
          serial: agents.serial,
          username: agents.username,
          ipAddress: agents.ipAddress,
          extAddress: agents.extAddress,
          macAddress: agents.macAddress,
          lastCheckinAt: agents.lastCheckinAt,
          registeredAt: agents.registeredAt,
          createdAt: agents.createdAt,
        })
        .from(agents)
        .leftJoin(sites, eq(sites.id, agents.siteId))
        .where(and(...conditions))
        .orderBy(agents.hostname);
    }),

  listTickets: authProcedure
    .input(z.object({ siteId: z.string().uuid().optional(), groupId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }
      const scope = ctx.scopeFor('Agents.Read');
      const siteId = input?.siteId;
      const groupId = input?.groupId;
      const groupTargets = groupId ? await loadGroupTargets(ctx.db, groupId) : null;

      if (siteId) {
        if (scope !== 'all' && !scope.includes(siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (groupTargets && groupTargets.siteIds.length === 0) {
        return [];
      } else if (scope !== 'all' && scope.length === 0) {
        return [];
      }

      const conditions = [
        siteId ? eq(agentTickets.siteId, siteId) : undefined,
        !siteId && groupTargets ? inArray(agentTickets.siteId, groupTargets.siteIds) : undefined,
        !siteId && scope !== 'all' ? inArray(agentTickets.siteId, [...scope]) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      return ctx.db
        .select({
          id: agentTickets.id,
          agentId: agentTickets.agentId,
          agentHostname: agents.hostname,
          siteId: agentTickets.siteId,
          siteName: sites.name,
          ticketId: agentTickets.ticketId,
          summary: agentTickets.summary,
          meta: agentTickets.meta,
          createdAt: agentTickets.createdAt,
        })
        .from(agentTickets)
        .leftJoin(agents, eq(agents.id, agentTickets.agentId))
        .leftJoin(sites, eq(sites.id, agentTickets.siteId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(agentTickets.createdAt);
    }),

  listLogs: authProcedure
    .input(
      z.object({
        agentId: z.string().uuid().optional(),
        siteId: z.string().uuid().optional(),
        groupId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(5000).default(2000),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }
      const scope = ctx.scopeFor('Agents.Read');
      const agentId = input?.agentId;
      const siteId = input?.siteId;
      const groupId = input?.groupId;
      const limit = input?.limit ?? 2000;
      const groupTargets = groupId ? await loadGroupTargets(ctx.db, groupId) : null;

      if (agentId) {
        const [agent] = await ctx.db
          .select({ siteId: agents.siteId })
          .from(agents)
          .where(and(eq(agents.id, agentId), notDeleted))
          .limit(1);
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
        if (scope !== 'all' && (!agent.siteId || !scope.includes(agent.siteId))) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (siteId) {
        if (scope !== 'all' && !scope.includes(siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (groupTargets && groupTargets.siteIds.length === 0) {
        return [];
      } else if (scope !== 'all' && scope.length === 0) {
        return [];
      }

      const conditions = [
        agentId ? eq(agentLogs.agentId, agentId) : undefined,
        !agentId && siteId ? eq(agents.siteId, siteId) : undefined,
        !agentId && !siteId && groupTargets ? inArray(agents.siteId, groupTargets.siteIds) : undefined,
        !agentId && !siteId && scope !== 'all' ? inArray(agents.siteId, [...scope]) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      return ctx.db
        .select({
          id: agentLogs.id,
          agentId: agentLogs.agentId,
          agentHostname: agents.hostname,
          siteId: agents.siteId,
          siteName: sites.name,
          method: agentLogs.method,
          message: agentLogs.message,
          status: agentLogs.status,
          timeElapsedMs: agentLogs.timeElapsedMs,
          metadata: agentLogs.metadata,
          createdAt: agentLogs.createdAt,
        })
        .from(agentLogs)
        .innerJoin(agents, eq(agents.id, agentLogs.agentId))
        .leftJoin(sites, eq(sites.id, agents.siteId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(agentLogs.createdAt))
        .limit(limit);
    }),

  delete: authProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Delete permission required' });
      }

      const uniqueIds = [...new Set(input.ids)];
      const rows = await ctx.db
        .select({ id: agents.id, siteId: agents.siteId, hostname: agents.hostname })
        .from(agents)
        .where(and(inArray(agents.id, uniqueIds), notDeleted));

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No agents found' });
      }

      const scope = ctx.scopeFor('Agents.Delete');
      const allowed = rows.filter(
        (row) => scope === 'all' || (row.siteId && scope.includes(row.siteId))
      );
      if (allowed.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No agents in scope' });
      }

      const allowedIds = allowed.map((row) => row.id);
      const now = new Date().toISOString();
      await ctx.db
        .update(agents)
        .set({ deletedAt: now })
        .where(inArray(agents.id, allowedIds));

      const auditRows = allowed.map((row) => ({
        siteId: row.siteId,
        actorType: 'user' as const,
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'delete' as const,
        actionLabel: ActionLabels.MspAgentRevoke,
        targetType: 'mspagent_agent',
        targetId: row.id,
        targetLabel: row.hostname,
        result: 'success' as const,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { hostname: row.hostname },
      }));
      if (auditRows.length > 0) {
        await ctx.db.insert(customerLogs).values(auditRows);
      }

      return { revoked: allowed.length, skipped: rows.length - allowed.length };
    }),

  configs: t.router({
    list: authProcedure.query(async ({ ctx }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }

      const configs = await ctx.db
        .select({
          id: agentBundles.id,
          name: agentBundles.name,
          description: agentBundles.description,
          isDefault: agentBundles.isDefault,
          etag: agentBundles.etag,
          data: agentBundles.data,
          createdAt: agentBundles.createdAt,
          updatedAt: agentBundles.updatedAt,
        })
        .from(agentBundles)
        .orderBy(agentBundles.name);

      // Count assignments per config
      const assignmentCounts = await ctx.db
        .select({
          bundleId: agentBundleAssignments.bundleId,
          siteCount: count(agentBundleAssignments.siteId).as('site_count'),
          groupCount: count(agentBundleAssignments.siteGroupId).as('group_count'),
        })
        .from(agentBundleAssignments)
        .groupBy(agentBundleAssignments.bundleId);

      const countMap = new Map(
        assignmentCounts.map((r) => [r.bundleId, { siteCount: Number(r.siteCount), groupCount: Number(r.groupCount) }])
      );

      return configs.map((c) => ({
        ...c,
        siteCount: countMap.get(c.id)?.siteCount ?? 0,
        groupCount: countMap.get(c.id)?.groupCount ?? 0,
      }));
    }),

    get: authProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Read')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
        }

        const [row] = await ctx.db
          .select()
          .from(agentBundles)
          .where(eq(agentBundles.id, input.id))
          .limit(1);

        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }),

    create: authProcedure
      .input(ConfigInputSchema)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }

        const etag = crypto.createHash('sha256').update(JSON.stringify(input.data)).digest('hex');
        const now = new Date().toISOString();

        const rows = await ctx.db
          .insert(agentBundles)
          .values({
            name: input.name,
            description: input.description ?? null,
            isDefault: false,
            etag,
            data: input.data,
            createdAt: now,
            updatedAt: now,
            updatedBy: ctx.user.id,
          })
          .returning({ id: agentBundles.id });

        const row = rows[0];
        if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Insert did not return row' });

        await ctx.db.insert(customerLogs).values({
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'create',
          actionLabel: ActionLabels.MspAgentConfigCreate,
          targetType: 'mspagent_config',
          targetId: row.id,
          targetLabel: input.name,
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        void notifyBundleUpdated(ctx.orgId);
        return row;
      }),

    update: authProcedure
      .input(z.object({ id: z.string().uuid() }).merge(ConfigInputSchema))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }

        const etag = crypto.createHash('sha256').update(JSON.stringify(input.data)).digest('hex');
        const now = new Date().toISOString();

        await ctx.db
          .update(agentBundles)
          .set({
            name: input.name,
            description: input.description ?? null,
            etag,
            data: input.data,
            updatedAt: now,
            updatedBy: ctx.user.id,
          })
          .where(eq(agentBundles.id, input.id));

        await ctx.db.insert(customerLogs).values({
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'update',
          actionLabel: ActionLabels.MspAgentConfigUpdate,
          targetType: 'mspagent_config',
          targetId: input.id,
          targetLabel: input.name,
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        void notifyBundleUpdated(ctx.orgId);
        return { ok: true };
      }),

    duplicate: authProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }

        const [source] = await ctx.db
          .select()
          .from(agentBundles)
          .where(eq(agentBundles.id, input.id))
          .limit(1);
        if (!source) throw new TRPCError({ code: 'NOT_FOUND' });

        const now = new Date().toISOString();
        const newName = `${source.name} (Copy)`;

        const dupRows = await ctx.db
          .insert(agentBundles)
          .values({
            name: newName,
            description: source.description,
            isDefault: false,
            etag: source.etag,
            data: source.data as Record<string, unknown>,
            createdAt: now,
            updatedAt: now,
            updatedBy: ctx.user.id,
          })
          .returning({ id: agentBundles.id });

        const row = dupRows[0];
        if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Insert did not return row' });

        await ctx.db.insert(customerLogs).values({
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'create',
          actionLabel: ActionLabels.MspAgentConfigCreate,
          targetType: 'mspagent_config',
          targetId: row.id,
          targetLabel: newName,
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: { duplicatedFrom: input.id },
        });

        return row;
      }),

    delete: authProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Delete')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Delete permission required' });
        }

        const [row] = await ctx.db
          .select({ name: agentBundles.name, isDefault: agentBundles.isDefault })
          .from(agentBundles)
          .where(eq(agentBundles.id, input.id))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        if (row.isDefault) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete the default config. Set another config as default first.' });
        }

        await ctx.db.delete(agentBundles).where(eq(agentBundles.id, input.id));

        await ctx.db.insert(customerLogs).values({
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'delete',
          actionLabel: ActionLabels.MspAgentConfigDelete,
          targetType: 'mspagent_config',
          targetId: input.id,
          targetLabel: row.name,
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        return { ok: true };
      }),

    setDefault: authProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }

        const [row] = await ctx.db
          .select({ name: agentBundles.name })
          .from(agentBundles)
          .where(eq(agentBundles.id, input.id))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

        // Clear all existing defaults then set the new one
        await ctx.db.update(agentBundles).set({ isDefault: false });
        await ctx.db.update(agentBundles).set({ isDefault: true }).where(eq(agentBundles.id, input.id));

        await ctx.db.insert(customerLogs).values({
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'update',
          actionLabel: ActionLabels.MspAgentConfigUpdate,
          targetType: 'mspagent_config',
          targetId: input.id,
          targetLabel: row.name,
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: { setAsDefault: true },
        });

        void notifyBundleUpdated(ctx.orgId);
        return { ok: true };
      }),

    // Upsert an assignment: a site or site group maps to exactly one config.
    assign: authProcedure
      .input(z.object({
        bundleId: z.string().uuid(),
        siteId: z.string().uuid().optional(),
        siteGroupId: z.string().uuid().optional(),
      }).refine((d) => !!(d.siteId || d.siteGroupId), { message: 'siteId or siteGroupId required' }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }

        if (input.siteId) {
          await ctx.db
            .insert(agentBundleAssignments)
            .values({ bundleId: input.bundleId, siteId: input.siteId })
            .onConflictDoUpdate({
              target: agentBundleAssignments.siteId,
              set: { bundleId: input.bundleId },
            });
        } else if (input.siteGroupId) {
          await ctx.db
            .insert(agentBundleAssignments)
            .values({ bundleId: input.bundleId, siteGroupId: input.siteGroupId })
            .onConflictDoUpdate({
              target: agentBundleAssignments.siteGroupId,
              set: { bundleId: input.bundleId },
            });
        }

        return { ok: true };
      }),

    unassign: authProcedure
      .input(z.object({
        siteId: z.string().uuid().optional(),
        siteGroupId: z.string().uuid().optional(),
      }).refine((d) => !!(d.siteId || d.siteGroupId), { message: 'siteId or siteGroupId required' }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }

        if (input.siteId) {
          await ctx.db
            .delete(agentBundleAssignments)
            .where(eq(agentBundleAssignments.siteId, input.siteId));
        } else if (input.siteGroupId) {
          await ctx.db
            .delete(agentBundleAssignments)
            .where(eq(agentBundleAssignments.siteGroupId, input.siteGroupId));
        }

        return { ok: true };
      }),

    // All assignments with resolved names, for the Sites tab.
    listAssignments: authProcedure.query(async ({ ctx }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }

      const rows = await ctx.db
        .select({
          id: agentBundleAssignments.id,
          bundleId: agentBundleAssignments.bundleId,
          bundleName: agentBundles.name,
          siteId: agentBundleAssignments.siteId,
          siteGroupId: agentBundleAssignments.siteGroupId,
          siteName: sites.name,
          siteGroupName: siteGroups.name,
        })
        .from(agentBundleAssignments)
        .innerJoin(agentBundles, eq(agentBundles.id, agentBundleAssignments.bundleId))
        .leftJoin(sites, eq(sites.id, agentBundleAssignments.siteId))
        .leftJoin(siteGroups, eq(siteGroups.id, agentBundleAssignments.siteGroupId));

      return rows;
    }),

    // Resolve which config applies to a given site: site > group > default.
    resolveForSite: authProcedure
      .input(z.object({ siteId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Read')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
        }

        // Site-specific assignment
        const [siteAssignment] = await ctx.db
          .select({ bundleId: agentBundleAssignments.bundleId })
          .from(agentBundleAssignments)
          .where(eq(agentBundleAssignments.siteId, input.siteId))
          .limit(1);

        if (siteAssignment) {
          const [bundle] = await ctx.db
            .select()
            .from(agentBundles)
            .where(eq(agentBundles.id, siteAssignment.bundleId))
            .limit(1);
          return bundle ? { ...bundle, source: 'site' as const } : null;
        }

        // Site group assignments
        const memberOf = await ctx.db
          .select({ siteGroupId: siteGroupMembers.siteGroupId })
          .from(siteGroupMembers)
          .where(eq(siteGroupMembers.siteId, input.siteId));

        if (memberOf.length > 0) {
          const groupIds = memberOf.map((m) => m.siteGroupId);
          const [groupAssignment] = await ctx.db
            .select({ bundleId: agentBundleAssignments.bundleId, siteGroupId: agentBundleAssignments.siteGroupId })
            .from(agentBundleAssignments)
            .where(inArray(agentBundleAssignments.siteGroupId, groupIds))
            .limit(1);

          if (groupAssignment) {
            const [bundle] = await ctx.db
              .select()
              .from(agentBundles)
              .where(eq(agentBundles.id, groupAssignment.bundleId))
              .limit(1);

            const [group] = await ctx.db
              .select({ name: siteGroups.name })
              .from(siteGroups)
              .where(eq(siteGroups.id, groupAssignment.siteGroupId!))
              .limit(1);

            return bundle ? { ...bundle, source: 'group' as const, groupName: group?.name } : null;
          }
        }

        // Global default
        const [defaultBundle] = await ctx.db
          .select()
          .from(agentBundles)
          .where(eq(agentBundles.isDefault, true))
          .limit(1);

        return defaultBundle ? { ...defaultBundle, source: 'default' as const } : null;
      }),

    webhookSecret: authProcedure.query(({ ctx }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }
      const agentsUrl = process.env.AGENTS_INTERNAL_URL;
      const secret = deriveOrgWebhookSecret(ctx.orgId);
      if (!agentsUrl || !secret) return null;
      return {
        secret,
        url: `${agentsUrl.replace(/\/$/, '')}/internal/webhook/halopsa/${ctx.orgId}/ticket-event`,
      };
    }),
  }),

  enrollmentToken: t.router({
    list: authProcedure.query(async ({ ctx }) => {
      if (!ctx.can('Agents.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
      }
      const scope = ctx.scopeFor('Agents.Write');

      const rows = await ctx.db
        .select({
          siteId: agentSiteTokens.siteId,
          label: agentSiteTokens.label,
          createdBy: agentSiteTokens.createdBy,
          createdAt: agentSiteTokens.createdAt,
          revokedAt: agentSiteTokens.revokedAt,
        })
        .from(agentSiteTokens)
        .where(
          scope === 'all'
            ? isNull(agentSiteTokens.revokedAt)
            : and(isNull(agentSiteTokens.revokedAt), inArray(agentSiteTokens.siteId, [...scope]))
        );

      return rows;
    }),

    // Decrypt and return the token for a site. Auto-generates if no token exists yet.
    reveal: authProcedure
      .input(z.object({ siteId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }
        const scope = ctx.scopeFor('Agents.Write');
        if (scope !== 'all' && !scope.includes(input.siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        const encryptionKey = requireEncryptionKey(ctx);

        const [existing] = await ctx.db
          .select({
            tokenEncrypted: agentSiteTokens.tokenEncrypted,
            revokedAt: agentSiteTokens.revokedAt,
          })
          .from(agentSiteTokens)
          .where(and(eq(agentSiteTokens.siteId, input.siteId), isNull(agentSiteTokens.revokedAt)))
          .limit(1);

        if (existing?.tokenEncrypted) {
          const plaintext = Encryption.decrypt(existing.tokenEncrypted, encryptionKey);
          if (!plaintext) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Token decryption failed' });

          await ctx.db.insert(customerLogs).values({
            siteId: input.siteId,
            actorType: 'user',
            actorId: ctx.user.id,
            actorLabel: ctx.user.name || ctx.user.email,
            action: 'create',
            actionLabel: ActionLabels.MspAgentEnrollmentTokenReveal,
            targetType: 'mspagent_enrollment_token',
            targetId: input.siteId,
            targetLabel: 'Site enrollment token',
            result: 'success',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          });

          return { token: plaintext, generated: false };
        }

        // No token or no encrypted copy — generate a new one
        const [site] = await ctx.db.select({ id: sites.id }).from(sites).where(eq(sites.id, input.siteId)).limit(1);
        if (!site) throw new TRPCError({ code: 'NOT_FOUND' });

        const { plaintext, tokenHash, tokenEncrypted } = generateToken(encryptionKey);

        await ctx.db
          .insert(agentSiteTokens)
          .values({
            siteId: input.siteId,
            tokenHash,
            tokenEncrypted,
            label: `Generated by ${ctx.user.name || ctx.user.email}`,
            createdBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: agentSiteTokens.siteId,
            set: {
              tokenHash,
              tokenEncrypted,
              label: `Generated by ${ctx.user.name || ctx.user.email}`,
              createdBy: ctx.user.id,
              createdAt: new Date().toISOString(),
              revokedAt: null,
            },
          });

        await ctx.db.insert(customerLogs).values({
          siteId: input.siteId,
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'create',
          actionLabel: ActionLabels.MspAgentEnrollmentTokenRegenerate,
          targetType: 'mspagent_enrollment_token',
          targetId: input.siteId,
          targetLabel: 'Site enrollment token',
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        return { token: plaintext, generated: true };
      }),

    // Regenerate: explicitly issue a new token, invalidating the old one.
    regenerate: authProcedure
      .input(z.object({ siteId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }
        const scope = ctx.scopeFor('Agents.Write');
        if (scope !== 'all' && !scope.includes(input.siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        const [site] = await ctx.db.select({ id: sites.id }).from(sites).where(eq(sites.id, input.siteId)).limit(1);
        if (!site) throw new TRPCError({ code: 'NOT_FOUND' });

        const encryptionKey = requireEncryptionKey(ctx);
        const { plaintext, tokenHash, tokenEncrypted } = generateToken(encryptionKey);

        await ctx.db
          .insert(agentSiteTokens)
          .values({
            siteId: input.siteId,
            tokenHash,
            tokenEncrypted,
            label: `Generated by ${ctx.user.name || ctx.user.email}`,
            createdBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: agentSiteTokens.siteId,
            set: {
              tokenHash,
              tokenEncrypted,
              label: `Generated by ${ctx.user.name || ctx.user.email}`,
              createdBy: ctx.user.id,
              createdAt: new Date().toISOString(),
              revokedAt: null,
            },
          });

        await ctx.db.insert(customerLogs).values({
          siteId: input.siteId,
          actorType: 'user',
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: 'create',
          actionLabel: ActionLabels.MspAgentEnrollmentTokenRegenerate,
          targetType: 'mspagent_enrollment_token',
          targetId: input.siteId,
          targetLabel: 'Site enrollment token',
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        return { token: plaintext };
      }),

    // Returns all site tokens for CSV export. Auto-generates for sites without tokens.
    // The caller receives plaintext for every site.
    exportCsv: authProcedure.mutation(async ({ ctx }) => {
      if (!ctx.can('Agents.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
      }

      const encryptionKey = requireEncryptionKey(ctx);
      const scope = ctx.scopeFor('Agents.Write');

      const allSites = await ctx.db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(scope === 'all' ? undefined : inArray(sites.id, [...scope]))
        .orderBy(sites.name);

      const existingTokens = await ctx.db
        .select({ siteId: agentSiteTokens.siteId, tokenEncrypted: agentSiteTokens.tokenEncrypted })
        .from(agentSiteTokens)
        .where(
          and(
            isNull(agentSiteTokens.revokedAt),
            isNotNull(agentSiteTokens.tokenEncrypted),
            scope === 'all' ? undefined : inArray(agentSiteTokens.siteId, [...scope])
          )
        );

      const tokenMap = new Map(existingTokens.map((t) => [t.siteId, t.tokenEncrypted]));

      const rows: { siteId: string; siteName: string; token: string }[] = [];
      const toInsert: Array<{
        siteId: string;
        tokenHash: string;
        tokenEncrypted: string;
        label: string;
        createdBy: string;
      }> = [];

      for (const site of allSites) {
        const encrypted = tokenMap.get(site.id);
        if (encrypted) {
          const plaintext = Encryption.decrypt(encrypted, encryptionKey);
          if (plaintext) {
            rows.push({ siteId: site.id, siteName: site.name, token: plaintext });
            continue;
          }
        }
        // Generate a new token for this site
        const { plaintext, tokenHash, tokenEncrypted } = generateToken(encryptionKey);
        toInsert.push({
          siteId: site.id,
          tokenHash,
          tokenEncrypted,
          label: `Generated by ${ctx.user.name || ctx.user.email}`,
          createdBy: ctx.user.id,
        });
        rows.push({ siteId: site.id, siteName: site.name, token: plaintext });
      }

      // Upsert any newly generated tokens
      for (const row of toInsert) {
        await ctx.db
          .insert(agentSiteTokens)
          .values(row)
          .onConflictDoUpdate({
            target: agentSiteTokens.siteId,
            set: {
              tokenHash: row.tokenHash,
              tokenEncrypted: row.tokenEncrypted,
              label: row.label,
              createdBy: row.createdBy,
              createdAt: new Date().toISOString(),
              revokedAt: null,
            },
          });
      }

      await ctx.db.insert(customerLogs).values({
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'create',
        actionLabel: ActionLabels.MspAgentEnrollmentTokenReveal,
        targetType: 'mspagent_enrollment_token',
        targetId: ctx.user.id,
        targetLabel: 'Token CSV export',
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { siteCount: rows.length, generated: toInsert.length },
      });

      return { rows };
    }),
  }),
});
