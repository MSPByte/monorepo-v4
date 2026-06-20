import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  findings,
  findingsWithContext,
  integrationLinks,
  policiesWithStats,
  sitesWithCounts
} from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';

const OPEN_STATUSES = ['open', 'acknowledged', 'regressed'] as const;

export const overviewRouter = t.router({
  kpis: authProcedure.query(async ({ ctx }) => {
    const [severityRows, sitePressureRow, sourceHealthRow, passRateRow] = await Promise.all([
      ctx.db
        .select({
          severity: findings.severity,
          count: sql<number>`count(*)::int`
        })
        .from(findings)
        .where(inArray(findings.status, [...OPEN_STATUSES]))
        .groupBy(findings.severity)
        .catch(() => [] as { severity: number; count: number }[]),
      ctx.db
        .select({
          sitesWithOpenFindings: sql<number>`count(distinct ${findings.siteId})::int`
        })
        .from(findings)
        .where(inArray(findings.status, [...OPEN_STATUSES]))
        .catch(() => [{ sitesWithOpenFindings: 0 }]),
      ctx.db
        .select({
          total: sql<number>`count(*)::int`,
          failed: sql<number>`count(*) filter (where ${integrationLinks.status} = 'error')::int`
        })
        .from(integrationLinks)
        .catch(() => [{ total: 0, failed: 0 }]),
      ctx.db
        .select({
          avgPassRate: sql<number>`coalesce(round(avg(case when ${policiesWithStats.openFindingCount} = 0 then 100 else 0 end)), 0)::int`
        })
        .from(policiesWithStats)
        .where(eq(policiesWithStats.enabled, true))
        .catch(() => [{ avgPassRate: 0 }])
    ]);

    const bySeverity = [4, 3, 2, 1].map((severity) => ({
      severity,
      count: severityRows.find((row) => row.severity === severity)?.count ?? 0
    }));
    const criticalHigh = bySeverity
      .filter((row) => row.severity >= 3)
      .reduce((sum, row) => sum + row.count, 0);
    const totalOpen = bySeverity.reduce((sum, row) => sum + row.count, 0);

    return {
      bySeverity,
      criticalHigh,
      totalOpen,
      sitesWithOpenFindings: sitePressureRow[0]?.sitesWithOpenFindings ?? 0,
      sourceHealth: {
        total: sourceHealthRow[0]?.total ?? 0,
        failed: sourceHealthRow[0]?.failed ?? 0
      },
      policyPassRate: passRateRow[0]?.avgPassRate ?? 0
    };
  }),

  findingRollups: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        policyId: findingsWithContext.policyId,
        policyName: findingsWithContext.policyName,
        maxSeverity: sql<number>`max(${findingsWithContext.severity})::int`,
        count: sql<number>`count(*)::int`,
        siteCount: sql<number>`count(distinct ${findingsWithContext.siteId})::int`,
        resourceType: sql<string>`(array_agg(${findingsWithContext.resourceType} order by ${findingsWithContext.lastSeenAt} desc))[1]`,
        lastSeenAt: sql<string>`max(${findingsWithContext.lastSeenAt})`
      })
      .from(findingsWithContext)
      .where(inArray(findingsWithContext.status, [...OPEN_STATUSES]))
      .groupBy(findingsWithContext.policyId, findingsWithContext.policyName)
      .orderBy(
        sql`max(${findingsWithContext.severity}) desc`,
        sql`count(*) desc`
      )
      .limit(50)
      .catch(() => [] as Array<{
        policyId: string;
        policyName: string;
        maxSeverity: number;
        count: number;
        siteCount: number;
        resourceType: string;
        lastSeenAt: string;
      }>);
    return rows;
  }),

  sitePressure: authProcedure.query(async ({ ctx }) => {
    const siteRows = await ctx.db
      .select()
      .from(sitesWithCounts)
      .orderBy(desc(sitesWithCounts.openFindingCount), sitesWithCounts.name)
      .limit(500)
      .catch(() => []);
    if (!siteRows.length) return [];

    const ids = siteRows.map((row) => row.id);
    const severityRows = await ctx.db
      .select({
        siteId: findings.siteId,
        severity: findings.severity,
        count: sql<number>`count(*)::int`
      })
      .from(findings)
      .where(and(inArray(findings.status, [...OPEN_STATUSES]), inArray(findings.siteId, ids)))
      .groupBy(findings.siteId, findings.severity)
      .catch(() => [] as { siteId: string; severity: number; count: number }[]);

    const bucketBySite = new Map<string, { critical: number; high: number; medium: number; low: number }>();
    for (const row of severityRows) {
      if (!row.siteId) continue;
      const bucket = bucketBySite.get(row.siteId) ?? { critical: 0, high: 0, medium: 0, low: 0 };
      if (row.severity === 4) bucket.critical += row.count;
      else if (row.severity === 3) bucket.high += row.count;
      else if (row.severity === 2) bucket.medium += row.count;
      else bucket.low += row.count;
      bucketBySite.set(row.siteId, bucket);
    }

    return siteRows.map((row) => ({
      id: row.id,
      name: row.name,
      openFindingCount: row.openFindingCount,
      sources: row.sources,
      severity: bucketBySite.get(row.id) ?? { critical: 0, high: 0, medium: 0, low: 0 }
    }));
  })
});
