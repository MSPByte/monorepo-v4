import { z } from 'zod';
import { customerLogs, integrations } from '@mspbyte/drizzle';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

type IntegrationRow = typeof integrations.$inferSelect;

export const integrationsRouter = t.router({
  // Integration catalog — needed by any UI that renders vendor data (to know
  // which integrations exist). Readable via either Integrations.Read or
  // Vendors.Read — see integration-links.list for the same rationale.
  list: authProcedure.query(async ({ ctx }): Promise<IntegrationRow[]> => {
    if (!ctx.can('Integrations.Read') && !ctx.can('Vendors.Read')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Integrations.Read or Vendors.Read permission required'
      });
    }
    return ctx.db.select().from(integrations).orderBy(integrations.id);
  }),

  get: authProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<IntegrationRow | null> => {
      if (!ctx.can('Integrations.Read') && !ctx.can('Vendors.Read')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Integrations.Read or Vendors.Read permission required'
        });
      }
      const [row] = await ctx.db
        .select()
        .from(integrations)
        .where(eq(integrations.id, input.id))
        .limit(1);
      return row ?? null;
    }),

  upsert: authProcedure
    .input(
      z.object({
        id: z.string(),
        config: z.record(z.string(), z.unknown()),
        credentialExpiration: z.string().datetime().optional()
      })
    )
    .mutation(async ({ ctx, input }): Promise<IntegrationRow> => {
      if (!ctx.can('Integrations.Write')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Integrations.Write permission required'
        });
      }
      const [row] = await ctx.db
        .insert(integrations)
        .values({
          id: input.id,
          config: input.config,
          credentialExpiration: input.credentialExpiration
            ? new Date(input.credentialExpiration).toISOString()
            : undefined,
          deletedAt: null
        })
        .onConflictDoUpdate({
          target: integrations.id,
          set: {
            config: input.config,
            credentialExpiration: input.credentialExpiration
              ? new Date(input.credentialExpiration).toISOString()
              : null,
            deletedAt: null,
            updatedAt: new Date().toISOString()
          }
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'update',
        actionLabel: ActionLabels.IntegrationConfigure,
        targetType: 'integration',
        targetId: row.id,
        targetLabel: row.id,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          hasCredentialExpiration: !!input.credentialExpiration,
          configKeys: Object.keys(input.config ?? {})
        }
      });

      return row;
    }),

  delete: authProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<IntegrationRow> => {
      if (!ctx.can('Integrations.Delete')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Integrations.Delete permission required'
        });
      }
      const [row] = await ctx.db
        .update(integrations)
        .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(integrations.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'delete',
        actionLabel: ActionLabels.IntegrationDelete,
        targetType: 'integration',
        targetId: row.id,
        targetLabel: row.id,
        result: 'success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: null
      });

      return row;
    })
});
