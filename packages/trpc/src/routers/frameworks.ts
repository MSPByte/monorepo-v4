import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { policies, policySetItems, policySets, policySetsWithStats } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { mockFrameworks, mockPolicies, mockFindings } from './domain-fixtures.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const frameworkInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  providerId: z.string().optional().nullable(),
  enabled: z.boolean().default(true)
});

export const frameworksRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData(ctx.db, policySetsWithStats, input, mockFrameworks, {
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
    const rows = await ctx.db
      .select()
      .from(policySetsWithStats)
      .orderBy(policySetsWithStats.name)
      .limit(500)
      .catch(() => []);
    if (!rows.length) return mockFrameworks;

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
      const { id, ...values } = input;
      const [row] = await ctx.db
        .update(policySets)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(eq(policySets.id, id))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  setPolicies: authProcedure
    .input(z.object({ policySetId: z.string().uuid(), policyIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(policySetItems).where(eq(policySetItems.policySetId, input.policySetId));
      if (input.policyIds.length > 0) {
        await ctx.db
          .insert(policySetItems)
          .values(input.policyIds.map((policyId) => ({ policySetId: input.policySetId, policyId })))
          .onConflictDoNothing();
      }
      await ctx.db
        .update(policySets)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(policySets.id, input.policySetId));
      return { policySetId: input.policySetId, policyIds: input.policyIds };
    }),

  listPolicies: authProcedure.input(z.object({ policySetId: z.string().uuid() })).query(async ({ ctx, input }) => {
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
    const [row] = await ctx.db
      .select()
      .from(policySets)
      .where(eq(policySets.id, input.id))
      .limit(1)
      .catch(() => []);
    if (row) {
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
        enabled: row.enabled,
        policyCount: containedPolicies.length,
        passRate: 100,
        openFindings: 0,
        lastEvaluation: row.updatedAt,
        policies: containedPolicies.map((policy) => policy.id),
        sitesAffected: [],
        containedPolicies,
        recentFailures: []
      };
    }

    const mock = mockFrameworks.find((framework) => framework.id === input.id);
    if (!mock) throw new TRPCError({ code: 'NOT_FOUND' });
    return {
      ...mock,
      containedPolicies: mockPolicies.filter((policy) => mock.policies.includes(policy.id)),
      recentFailures: mockFindings.filter((finding) =>
        mock.policies.includes(finding.policyId)
      )
    };
  })
});
