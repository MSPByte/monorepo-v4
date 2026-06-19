import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { policies, policiesWithStats } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { mockPolicies, mockFindings } from './domain-fixtures.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const mockPolicyRows = () =>
  mockPolicies.map((policy) => ({
    ...policy,
    targetType: policy.scope,
    frameworkList: policy.frameworkMembership.join(', ')
  }));

export const policiesRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData(ctx.db, policiesWithStats, input, mockPolicyRows(), {
      column: 'openFindingCount',
      direction: 'desc'
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        scope: row.targetType,
        frameworkMembership:
          typeof row.frameworkList === 'string' && row.frameworkList.length
            ? row.frameworkList.split(', ')
            : []
      }))
    };
  }),

  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(policiesWithStats)
      .orderBy(policiesWithStats.name)
      .limit(500)
      .catch(() => []);
    if (!rows.length) return mockPolicies;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      expectation: row.recommendation ?? 'Structured policy expectation',
      enabled: row.enabled,
      severity: row.severity,
      category: row.category ?? 'Operational',
      scope: row.targetType,
      source: row.source,
      frameworkMembership: row.frameworkList ? row.frameworkList.split(', ') : [],
      openFindingCount: row.openFindingCount,
      lastEvaluation: row.updatedAt
    }));
  }),

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(policies)
      .where(eq(policies.id, input.id))
      .limit(1)
      .catch(() => []);
    if (row) {
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        expectation:
          typeof row.definition === 'object' && row.definition && 'kind' in row.definition
            ? String(row.definition.kind)
            : 'Structured policy expectation',
        enabled: row.enabled,
        severity: row.severity,
        category: row.category ?? 'Operational',
        scope: row.targetType,
        source: row.source,
        frameworkMembership: [],
        openFindingCount: 0,
        lastEvaluation: row.updatedAt,
        exampleFindings: []
      };
    }

    const mock = mockPolicies.find((policy) => policy.id === input.id);
    if (!mock) throw new TRPCError({ code: 'NOT_FOUND' });
    return {
      ...mock,
      exampleFindings: mockFindings.filter((finding) => finding.policyId === mock.id).slice(0, 5)
    };
  })
});
