import crypto from 'node:crypto';
import type { BundleData } from '../types/bundle.js';
import { z } from 'zod';
import { and, count, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { agents, agentLogs, agentTickets, agentSiteTokens, agentBundles, customerLogs, sites } from '@mspbyte/drizzle';
import { ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import { loadGroupTargets } from './group-targets.js';

function scopedSiteFilter(scope: 'all' | readonly string[]) {
  if (scope === 'all') return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(agents.siteId, [...scope]);
}

// Active (non-deleted) devices only.
const notDeleted = isNull(agents.deletedAt);

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

  // Soft-delete: sets deleted_at rather than hard-deleting the row.
  // The agent can no longer check in once revoked. Re-enrollment creates a fresh row.
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

  bundle: t.router({
    get: authProcedure
      .input(z.object({ siteId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Read')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
        }
        const scope = ctx.scopeFor('Agents.Read');
        if (scope !== 'all' && !scope.includes(input.siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        const [row] = await ctx.db
          .select({ data: agentBundles.data, etag: agentBundles.etag, updatedAt: agentBundles.updatedAt })
          .from(agentBundles)
          .where(eq(agentBundles.siteId, input.siteId))
          .limit(1);

        return row ?? null;
      }),

    upsert: authProcedure
      .input(z.object({ siteId: z.string().uuid(), data: z.record(z.string(), z.unknown()) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }
        const scope = ctx.scopeFor('Agents.Write');
        if (scope !== 'all' && !scope.includes(input.siteId)) {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }

        const etag = crypto
          .createHash('sha256')
          .update(JSON.stringify(input.data))
          .digest('hex');
        const now = new Date().toISOString();

        await ctx.db
          .insert(agentBundles)
          .values({
            siteId: input.siteId,
            etag,
            data: input.data,
            updatedAt: now,
            updatedBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: agentBundles.siteId,
            set: { etag, data: input.data, updatedAt: now, updatedBy: ctx.user.id },
          });

        return { etag };
      }),
  }),

  enrollmentToken: t.router({
    // Returns token metadata (not the hash) for all sites that have tokens,
    // scoped to the caller's Agents.Write permission.
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

    get: authProcedure
      .input(z.object({ siteId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        if (!ctx.can('Agents.Write')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
        }
        const scope = ctx.scopeFor('Agents.Write');
        if (scope !== 'all' && !scope.includes(input.siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }

        const [token] = await ctx.db
          .select({
            id: agentSiteTokens.id,
            label: agentSiteTokens.label,
            createdBy: agentSiteTokens.createdBy,
            createdAt: agentSiteTokens.createdAt,
            revokedAt: agentSiteTokens.revokedAt,
          })
          .from(agentSiteTokens)
          .where(eq(agentSiteTokens.siteId, input.siteId))
          .limit(1);

        // Returns metadata only — the plaintext token is never stored or returned here.
        return token ?? null;
      }),

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

        // Verify the site exists in scope
        const [site] = await ctx.db
          .select({ id: sites.id })
          .from(sites)
          .where(eq(sites.id, input.siteId))
          .limit(1);
        if (!site) throw new TRPCError({ code: 'NOT_FOUND' });

        // Generate a new random token — 32 bytes = 64 hex chars
        const plaintext = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(plaintext).digest('hex');

        // Upsert: revoke old token and insert new one in a single replace
        await ctx.db
          .insert(agentSiteTokens)
          .values({
            siteId: input.siteId,
            tokenHash,
            label: `Generated by ${ctx.user.name || ctx.user.email}`,
            createdBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: agentSiteTokens.siteId,
            set: {
              tokenHash,
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
          targetLabel: `Site enrollment token`,
          result: 'success',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });

        // Plaintext returned once — the caller must display and copy it.
        return { token: plaintext };
      }),
  }),
});
