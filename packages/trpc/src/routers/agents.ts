import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { agents, agentLogs, agentTickets } from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';

export const agentsRouter = t.router({
  list: authProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
      }
      const scope = ctx.scopeFor('Assets.Read');
      if (scope !== 'all' && !scope.includes(input.siteId)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return ctx.db
        .select()
        .from(agents)
        .where(eq(agents.siteId, input.siteId))
        .orderBy(agents.hostname);
    }),

  listTickets: authProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
      }
      const scope = ctx.scopeFor('Assets.Read');
      if (scope !== 'all' && !scope.includes(input.siteId)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return ctx.db
        .select()
        .from(agentTickets)
        .where(eq(agentTickets.siteId, input.siteId))
        .orderBy(agentTickets.createdAt);
    }),

  listLogs: authProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
      }
      // Resolve the agent's site to scope-check.
      const [agent] = await ctx.db
        .select({ siteId: agents.siteId })
        .from(agents)
        .where(eq(agents.id, input.agentId))
        .limit(1);
      if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
      const scope = ctx.scopeFor('Assets.Read');
      if (scope !== 'all' && (!agent.siteId || !scope.includes(agent.siteId))) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return ctx.db
        .select()
        .from(agentLogs)
        .where(eq(agentLogs.agentId, input.agentId))
        .orderBy(agentLogs.createdAt);
    }),
});

// Keep unused-import silence if drizzle helpers get pruned.
void and;
void inArray;
