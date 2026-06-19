import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { policySets, policySetsWithStats } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { mockFrameworks, mockPolicies, mockFindings } from './domain-fixtures.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

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

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(policySets)
      .where(eq(policySets.id, input.id))
      .limit(1)
      .catch(() => []);
    if (row) {
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        enabled: row.enabled,
        policyCount: 0,
        passRate: 100,
        openFindings: 0,
        lastEvaluation: row.updatedAt,
        policies: [],
        sitesAffected: [],
        containedPolicies: [],
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
