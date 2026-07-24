import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import {
  customerLogs,
  policies,
  policySetItems,
  policySets,
  policySetsWithStats
} from '@mspbyte/drizzle';
import { ActionLabels, INTEGRATIONS, type ProviderId } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const frameworkInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  providerId: z.string().optional().nullable(),
  enabled: z.boolean().default(true)
});

function requireRead(ctx: { can: (p: 'Frameworks.Read') => boolean }) {
  if (!ctx.can('Frameworks.Read')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Frameworks.Read permission required' });
  }
}

function requireWrite(ctx: { can: (p: 'Frameworks.Write') => boolean }) {
  if (!ctx.can('Frameworks.Write')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Frameworks.Write permission required' });
  }
}

async function auditFrameworkChange(
  ctx: Context,
  input: {
    frameworkId: string;
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetLabel: string;
    result?: 'success' | 'failure';
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: null,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: ctx.user.name || ctx.user.email,
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: 'framework',
    targetId: input.frameworkId,
    targetLabel: input.targetLabel,
    result: input.result ?? 'success',
    errorMessage: input.errorMessage,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata ?? null
  });
}

export const frameworksRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    requireRead(ctx);
    const result = await queryTableData<typeof policySetsWithStats.$inferSelect>(ctx.db, policySetsWithStats, input, [], {
      column: 'openFindings',
      direction: 'desc'
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        updatedAt:
          'updatedAt' in row && typeof row.updatedAt === 'string'
            ? row.updatedAt
            : 'lastEvaluation' in row
              ? String(row.lastEvaluation)
              : null
      }))
    };
  }),

  list: authProcedure.query(async ({ ctx }) => {
    requireRead(ctx);
    const rows = await ctx.db
      .select()
      .from(policySetsWithStats)
      .orderBy(policySetsWithStats.name)
      .limit(500)
      .catch(() => []);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      enabled: row.enabled,
      policyCount: row.policyCount,
      passRate: row.passRate,
      openFindings: row.openFindings,
      lastEvaluation: row.updatedAt,
      policies: [],
      sitesAffected: []
    }));
  }),

  create: authProcedure.input(frameworkInputSchema).mutation(async ({ ctx, input }) => {
    requireWrite(ctx);
    const [row] = await ctx.db
      .insert(policySets)
      .values({
        source: 'custom',
        name: input.name,
        description: input.description,
        category: input.category,
        providerId: input.providerId,
        enabled: input.enabled
      })
      .returning();
    if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return row;
  }),

  update: authProcedure
    .input(frameworkInputSchema.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireWrite(ctx);
      const { id, ...values } = input;
      const [existing] = await ctx.db
        .select()
        .from(policySets)
        .where(eq(policySets.id, id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      const nextDescription = values.description ?? null;
      const nextCategory = values.category ?? null;
      const nextProviderId = values.providerId ?? null;

      const unchanged =
        existing.name === values.name &&
        (existing.description ?? null) === nextDescription &&
        (existing.category ?? null) === nextCategory &&
        (existing.providerId ?? null) === nextProviderId &&
        existing.enabled === values.enabled;
      if (unchanged) return existing;

      const [row] = await ctx.db
        .update(policySets)
        .set({
          name: values.name,
          description: nextDescription,
          category: nextCategory,
          providerId: nextProviderId,
          enabled: values.enabled,
          updatedAt: new Date().toISOString()
        })
        .where(eq(policySets.id, id))
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await auditFrameworkChange(ctx, {
        frameworkId: row.id,
        action: 'update',
        actionLabel: ActionLabels.FrameworkUpdate,
        targetLabel: row.name,
        metadata: {
          previous: {
            name: existing.name,
            description: existing.description,
            category: existing.category,
            providerId: existing.providerId,
            enabled: existing.enabled
          },
          next: {
            name: row.name,
            description: row.description,
            category: row.category,
            providerId: row.providerId,
            enabled: row.enabled
          }
        }
      });

      return row;
    }),

  setPolicies: authProcedure
    .input(z.object({ policySetId: z.string().uuid(), policyIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      requireWrite(ctx);
      const [set] = await ctx.db
        .select({ id: policySets.id, name: policySets.name })
        .from(policySets)
        .where(eq(policySets.id, input.policySetId))
        .limit(1);
      if (!set) throw new TRPCError({ code: 'NOT_FOUND' });

      const existingItems = await ctx.db
        .select({ policyId: policySetItems.policyId })
        .from(policySetItems)
        .where(eq(policySetItems.policySetId, input.policySetId));
      const previousIds = existingItems.map((item) => item.policyId).sort();
      const nextIds = [...new Set(input.policyIds)].sort();

      const added = nextIds.filter((id) => !previousIds.includes(id));
      const removed = previousIds.filter((id) => !nextIds.includes(id));
      if (added.length === 0 && removed.length === 0) {
        return { policySetId: input.policySetId, policyIds: nextIds };
      }

      await ctx.db.delete(policySetItems).where(eq(policySetItems.policySetId, input.policySetId));
      if (nextIds.length > 0) {
        await ctx.db
          .insert(policySetItems)
          .values(nextIds.map((policyId) => ({ policySetId: input.policySetId, policyId })))
          .onConflictDoNothing();
      }
      await ctx.db
        .update(policySets)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(policySets.id, input.policySetId));

      const referencedIds = [...new Set([...added, ...removed])];
      const nameRows = referencedIds.length
        ? await ctx.db
            .select({ id: policies.id, name: policies.name })
            .from(policies)
            .where(inArray(policies.id, referencedIds))
        : [];
      const nameById = new Map(nameRows.map((row) => [row.id, row.name]));
      const label = (id: string) => ({ id, name: nameById.get(id) ?? id });

      await auditFrameworkChange(ctx, {
        frameworkId: input.policySetId,
        action: 'update',
        actionLabel: ActionLabels.FrameworkSetPolicies,
        targetLabel: set.name,
        metadata: {
          added: added.map(label),
          removed: removed.map(label),
          totalAfter: nextIds.length
        }
      });

      return { policySetId: input.policySetId, policyIds: nextIds };
    }),

  listPolicies: authProcedure.input(z.object({ policySetId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireRead(ctx);
    return ctx.db
      .select({
        id: policies.id,
        name: policies.name,
        description: policies.description,
        severity: policies.severity,
        targetType: policies.targetType
      })
      .from(policySetItems)
      .innerJoin(policies, eq(policySetItems.policyId, policies.id))
      .where(eq(policySetItems.policySetId, input.policySetId))
      .orderBy(policies.name)
      .catch(() => []);
  }),

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    requireRead(ctx);
    const [row] = await ctx.db
      .select()
      .from(policySets)
      .where(eq(policySets.id, input.id))
      .limit(1)
      .catch(() => []);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    const providerName = row.providerId
      ? INTEGRATIONS[row.providerId as ProviderId]?.name ?? row.providerId
      : null;
    const containedPolicies = await ctx.db
      .select({
        id: policies.id,
        name: policies.name,
        description: policies.description,
        expectation: policies.recommendation,
        enabled: policies.enabled,
        severity: policies.severity,
        category: policies.category,
        scope: policies.targetType,
        source: policies.source
      })
      .from(policySetItems)
      .innerJoin(policies, eq(policySetItems.policyId, policies.id))
      .where(and(eq(policySetItems.policySetId, input.id), eq(policies.enabled, true)))
      .orderBy(policies.name)
      .catch(() => []);
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      category: row.category ?? null,
      providerId: row.providerId ?? null,
      providerName,
      source: row.source,
      version: row.version,
      enabled: row.enabled,
      policyCount: containedPolicies.length,
      passRate: 100,
      openFindings: 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastEvaluation: row.updatedAt,
      policies: containedPolicies.map((policy) => policy.id),
      sitesAffected: [] as string[],
      containedPolicies,
      recentFailures: [] as Array<{
        id: string;
        title: string;
        severity: number;
        status: string;
        evidenceSummary: string;
        recommendation: string;
        lastSeenAt: string;
        policyId: string;
      }>
    };
  })
});
