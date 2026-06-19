import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { findings, findingsWithContext } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { mockAssets, mockFindings, mockPeople, mockPolicies, mockSites } from './domain-fixtures.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const listInput = z
  .object({
    severity: z.number().optional(),
    status: z.string().optional(),
    siteId: z.string().optional(),
    policyId: z.string().optional(),
    resourceType: z.string().optional()
  })
  .optional();

export const findingsRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    return queryTableData(ctx.db, findingsWithContext, input, mockFindings.map((finding) => ({
      ...finding,
      siteName: mockSites.find((site) => site.id === finding.siteId)?.name ?? 'Unknown site',
      policyName: mockPolicies.find((policy) => policy.id === finding.policyId)?.name ?? 'Policy',
      resourceName:
        finding.resourceType === 'asset'
          ? (mockAssets.find((asset) => asset.id === finding.resourceId)?.hostname ?? finding.resourceId)
          : finding.resourceType === 'person'
            ? (mockPeople.find((person) => person.id === finding.resourceId)?.displayName ?? finding.resourceId)
            : finding.resourceId
    })), {
      column: 'severity',
      direction: 'desc'
    });
  }),

  list: authProcedure.input(listInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(findingsWithContext)
      .orderBy(desc(findingsWithContext.lastSeenAt))
      .limit(200)
      .catch(() => []);
    const source = rows.length
      ? rows.map((row) => ({
          id: row.id,
          title: row.title,
          severity: row.severity,
          status: row.status,
          siteId: row.siteId,
          siteName: row.siteName,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          resourceName: row.resourceName,
          policyId: row.policyId,
          policyName: row.policyName,
          evidenceSummary: row.evidenceSummary,
          recommendation: row.recommendation ?? 'Review the evidence and remediate or suppress.',
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          timeline: ['Finding opened', 'Latest policy evaluation updated this finding'],
          vendorSources: row.resourceTable ? [row.resourceTable] : []
        }))
      : mockFindings;

    return source.filter((finding) => {
      if (input?.severity && finding.severity !== input.severity) return false;
      if (input?.status && finding.status !== input.status) return false;
      if (input?.siteId && finding.siteId !== input.siteId) return false;
      if (input?.policyId && finding.policyId !== input.policyId) return false;
      if (input?.resourceType && finding.resourceType !== input.resourceType) return false;
      return true;
    });
  }),

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(findings)
      .where(eq(findings.id, input.id))
      .limit(1)
      .catch(() => []);
    if (row) {
      return {
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        siteId: row.siteId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        policyId: row.policyId,
        evidenceSummary: row.summary ?? 'Structured evidence is available on the finding.',
        evidence: row.evidence,
        recommendation: row.recommendation ?? 'Review the evidence and remediate or suppress.',
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        timeline: ['Finding opened', 'Latest policy evaluation updated this finding'],
        vendorSources: row.resourceTable ? [row.resourceTable] : []
      };
    }

    const mock = mockFindings.find((finding) => finding.id === input.id);
    if (!mock) throw new TRPCError({ code: 'NOT_FOUND' });
    return { ...mock, evidence: { summary: mock.evidenceSummary } };
  })
});
