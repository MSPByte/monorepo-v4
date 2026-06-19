import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { agents, agentLogs, agentTickets } from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';

export const agentsRouter = t.router({
  list: authProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(agents)
        .where(eq(agents.siteId, input.siteId))
        .orderBy(agents.hostname);
    }),

  listTickets: authProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(agentTickets)
        .where(eq(agentTickets.siteId, input.siteId))
        .orderBy(agentTickets.createdAt);
    }),

  listLogs: authProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(agentLogs)
        .where(eq(agentLogs.agentId, input.agentId))
        .orderBy(agentLogs.createdAt);
    }),
});
