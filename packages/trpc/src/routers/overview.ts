import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
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
    if (!ctx.can('Findings.Read') && !ctx.can('Assets.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Read permission required' });
    }
    const findingsScope = ctx.scopeFor('Findings.Read');
    const integrationsScope = ctx.scopeFor('Integrations.Read');
    const policiesScope = ctx.scopeFor('Policies.Read');

    const findingsSiteFilter =
      findingsScope === 'all'
        ? undefined
        : findingsScope.length === 0
          ? sql`false`
          : inArray(findings.siteId, [...findingsScope]);
    const linksSiteFilter =
      integrationsScope === 'all'
        ? undefined
        : integrationsScope.length === 0
          ? sql`false`
          : inArray(integrationLinks.siteId, [...integrationsScope]);
    // policiesWithStats aggregates across sites; a scoped user only gets a
    // meaningful pass-rate for their scope. If no policies access, skip.
    const policiesAccessible = ctx.can('Policies.Read');

    const [severityRows, sitePressureRow, sourceHealthRow, passRateRow] = await Promise.all([
      ctx.db
        .select({
          severity: findings.severity,
          count: sql<number>`count(*)::int`
        })
        .from(findings)
        .where(
          and(inArray(findings.status, [...OPEN_STATUSES]), findingsSiteFilter) as never
        )
        .groupBy(findings.severity)
        .catch(() => [] as { severity: number; count: number }[]),
      ctx.db
        .select({
          sitesWithOpenFindings: sql<number>`count(distinct ${findings.siteId})::int`
        })
        .from(findings)
        .where(
          and(inArray(findings.status, [...OPEN_STATUSES]), findingsSiteFilter) as never
        )
        .catch(() => [{ sitesWithOpenFindings: 0 }]),
      integrationsScope !== 'all' && integrationsScope.length === 0
        ? Promise.resolve([{ total: 0, failed: 0 }])
        : ctx.db
            .select({
              total: sql<number>`count(*)::int`,
              failed: sql<number>`count(*) filter (where ${integrationLinks.status} = 'error')::int`
            })
            .from(integrationLinks)
            .where(linksSiteFilter as never)
            .catch(() => [{ total: 0, failed: 0 }]),
      policiesAccessible
        ? ctx.db
            .select({
              avgPassRate: sql<number>`coalesce(round(avg(case when ${policiesWithStats.openFindingCount} = 0 then 100 else 0 end)), 0)::int`
            })
            .from(policiesWithStats)
            .where(eq(policiesWithStats.enabled, true))
            .catch(() => [{ avgPassRate: 0 }])
        : Promise.resolve([{ avgPassRate: 0 }])
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
    void policiesScope;
  }),

  findingRollups: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Findings.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Findings.Read permission required' });
    }
    const scope = ctx.scopeFor('Findings.Read');
    if (scope !== 'all' && scope.length === 0) return [];

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
      .where(
        and(
          inArray(findingsWithContext.status, [...OPEN_STATUSES]),
          scope === 'all' ? undefined : inArray(findingsWithContext.siteId, [...scope])
        ) as never
      )
      .groupBy(findingsWithContext.policyId, findingsWithContext.policyName)
      .orderBy(sql`max(${findingsWithContext.severity}) desc`, sql`count(*) desc`)
      .limit(50)
      .catch(
        () =>
          [] as Array<{
            policyId: string;
            policyName: string;
            maxSeverity: number;
            count: number;
            siteCount: number;
            resourceType: string;
            lastSeenAt: string;
          }>
      );
    return rows;
  }),

  sitePressure: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Sites.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Sites.Read permission required' });
    }
    const sitesScope = ctx.scopeFor('Sites.Read');
    if (sitesScope !== 'all' && sitesScope.length === 0) return [];

    const findingsScope = ctx.scopeFor('Findings.Read');

    const siteRows = await ctx.db
      .select()
      .from(sitesWithCounts)
      .where(sitesScope === 'all' ? undefined : inArray(sitesWithCounts.id, [...sitesScope]))
      .orderBy(desc(sitesWithCounts.openFindingCount), sitesWithCounts.name)
      .limit(500)
      .catch(() => []);
    if (!siteRows.length) return [];

    const ids = siteRows.map((row) => row.id);
    // Findings breakdown — narrow by findings scope (if narrower than sites).
    const findingsFilter =
      findingsScope === 'all'
        ? inArray(findings.siteId, ids)
        : findingsScope.length === 0
          ? sql`false`
          : inArray(findings.siteId, ids.filter((id) => (findingsScope as readonly string[]).includes(id)));
    const severityRows = await ctx.db
      .select({
        siteId: findings.siteId,
        severity: findings.severity,
        count: sql<number>`count(*)::int`
      })
      .from(findings)
      .where(and(inArray(findings.status, [...OPEN_STATUSES]), findingsFilter) as never)
      .groupBy(findings.siteId, findings.severity)
      .catch(() => [] as { siteId: string; severity: number; count: number }[]);

    const bucketBySite = new Map<
      string,
      { critical: number; high: number; medium: number; low: number }
    >();
    for (const row of severityRows) {
      if (!row.siteId) continue;
      const bucket = bucketBySite.get(row.siteId) ?? {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      };
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
