import { z } from 'zod';
import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { agents, agentLogs, agentTickets, customerLogs, sites } from '@mspbyte/drizzle';
import { ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

function scopedSiteFilter(scope: 'all' | readonly string[]) {
  if (scope === 'all') return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(agents.siteId, [...scope]);
}

export const agentsRouter = t.router({
  siteOverview: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Assets.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
    }
    const scope = ctx.scopeFor('Assets.Read');
    if (scope !== 'all' && scope.length === 0) return [];

    const scopeCondition = scope === 'all' ? undefined : inArray(agents.siteId, [...scope]);

    const rows = await ctx.db
      .select({
        siteId: agents.siteId,
        siteName: sites.name,
        agentCount: count(agents.id),
        lastCheckIn: max(agents.updatedAt),
      })
      .from(agents)
      .leftJoin(sites, eq(sites.id, agents.siteId))
      .where(scopeCondition)
      .groupBy(agents.siteId, sites.name);

    return rows.map((row) => ({
      siteId: row.siteId,
      siteName: row.siteName ?? 'Unknown Site',
      agentCount: Number(row.agentCount ?? 0),
      lastCheckIn: row.lastCheckIn,
    }));
  }),

  list: authProcedure
    .input(z.object({ siteId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
      }
      const scope = ctx.scopeFor('Assets.Read');
      const siteId = input?.siteId;

      if (siteId) {
        if (scope !== 'all' && !scope.includes(siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (scope !== 'all' && scope.length === 0) {
        return [];
      }

      const conditions = [
        siteId ? eq(agents.siteId, siteId) : undefined,
        !siteId ? scopedSiteFilter(scope) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      const rows = await ctx.db
        .select({
          id: agents.id,
          siteId: agents.siteId,
          siteName: sites.name,
          hostname: agents.hostname,
          platform: agents.platform,
          version: agents.version,
          ipAddress: agents.ipAddress,
          extAddress: agents.extAddress,
          macAddress: agents.macAddress,
          registeredAt: agents.registeredAt,
          createdAt: agents.createdAt,
          updatedAt: agents.updatedAt,
          deletedAt: agents.deletedAt,
        })
        .from(agents)
        .leftJoin(sites, eq(sites.id, agents.siteId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(agents.hostname);

      return rows;
    }),

  listTickets: authProcedure
    .input(z.object({ siteId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
      }
      const scope = ctx.scopeFor('Assets.Read');
      const siteId = input?.siteId;

      if (siteId) {
        if (scope !== 'all' && !scope.includes(siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (scope !== 'all' && scope.length === 0) {
        return [];
      }

      const conditions = [
        siteId ? eq(agentTickets.siteId, siteId) : undefined,
        !siteId && scope !== 'all' ? inArray(agentTickets.siteId, [...scope]) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      const rows = await ctx.db
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

      return rows;
    }),

  listLogs: authProcedure
    .input(
      z
        .object({
          agentId: z.string().uuid().optional(),
          siteId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(5000).default(2000),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
      }
      const scope = ctx.scopeFor('Assets.Read');
      const agentId = input?.agentId;
      const siteId = input?.siteId;
      const limit = input?.limit ?? 2000;

      if (agentId) {
        const [agent] = await ctx.db
          .select({ siteId: agents.siteId })
          .from(agents)
          .where(eq(agents.id, agentId))
          .limit(1);
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
        if (scope !== 'all' && (!agent.siteId || !scope.includes(agent.siteId))) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (siteId) {
        if (scope !== 'all' && !scope.includes(siteId)) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
      } else if (scope !== 'all' && scope.length === 0) {
        return [];
      }

      const conditions = [
        agentId ? eq(agentLogs.agentId, agentId) : undefined,
        !agentId && siteId ? eq(agents.siteId, siteId) : undefined,
        !agentId && !siteId && scope !== 'all'
          ? inArray(agents.siteId, [...scope])
          : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      const rows = await ctx.db
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

      return rows;
    }),

  delete: authProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Delete permission required' });
      }

      const uniqueIds = [...new Set(input.ids)];
      const rows = await ctx.db
        .select({
          id: agents.id,
          siteId: agents.siteId,
          hostname: agents.hostname,
        })
        .from(agents)
        .where(inArray(agents.id, uniqueIds));

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No agents found' });
      }

      const scope = ctx.scopeFor('Assets.Delete');
      const allowed = rows.filter(
        (row) => scope === 'all' || (row.siteId && scope.includes(row.siteId))
      );
      if (allowed.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No agents in scope' });
      }

      const allowedIds = allowed.map((row) => row.id);
      await ctx.db.delete(agents).where(inArray(agents.id, allowedIds));

      const auditRows = allowed.map((row) => ({
        siteId: row.siteId,
        actorType: 'user' as const,
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'delete' as const,
        actionLabel: ActionLabels.MspAgentDelete,
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

      return {
        deleted: allowed.length,
        skipped: rows.length - allowed.length,
      };
    }),
});
