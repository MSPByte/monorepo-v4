import { z } from 'zod';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  customerLogs,
  findings,
  findingsWithContext,
  entitySources,
  policies,
  policyDependencies,
  userReportPrefs,
  users
} from '@mspbyte/drizzle';
import { ActionLabels, getPolicyTableShape } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';
import { loadGroupTargets } from './group-targets.js';

const OPEN_STATUSES = ['open', 'acknowledged', 'regressed'] as const;

const findingSelection = {
  id: findingsWithContext.id,
  title: findingsWithContext.title,
  severity: findingsWithContext.severity,
  status: findingsWithContext.status,
  providerId: findingsWithContext.providerId,
  siteId: findingsWithContext.siteId,
  siteName: findingsWithContext.siteName,
  linkId: findingsWithContext.linkId,
  linkName: findingsWithContext.linkName,
  resourceType: findingsWithContext.resourceType,
  resourceTable: findingsWithContext.resourceTable,
  resourceId: findingsWithContext.resourceId,
  resourceName: findingsWithContext.resourceName,
  resourceExternalId: findingsWithContext.resourceExternalId,
  policyId: findingsWithContext.policyId,
  policyName: findingsWithContext.policyName,
  evidenceSummary: findingsWithContext.evidenceSummary,
  recommendation: findingsWithContext.recommendation,
  firstSeenAt: findingsWithContext.firstSeenAt,
  lastSeenAt: findingsWithContext.lastSeenAt
};

const listInput = z
  .object({
    severity: z.number().optional(),
    status: z.string().optional(),
    siteId: z.string().optional(),
    policyId: z.string().optional(),
    resourceType: z.string().optional()
  })
  .optional();

function toProper(value: string): string {
  return value
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function tableLabel(table?: string | null): string | null {
  if (!table) return null;
  return getPolicyTableShape(table)?.label ?? toProper(table.split('.').pop() ?? table);
}

// Return the fully-qualified physical table name (schema.table_snake) for a
// PolicyTableShape identifier. `null` if the table isn't in the registry.
function physicalTableName(table: string): string | null {
  const shape = getPolicyTableShape(table);
  if (!shape) return null;
  const snake = shape.table.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const schema =
    shape.targetType === 'person' || shape.targetType === 'asset' ? 'canonical' : 'vendors';
  return `${schema}.${snake}`;
}

const FRIENDLY_FIELDS = ['email', 'hostname', 'display_name', 'name'] as const;

// Look up a human-readable label for a vendor/canonical row, so DATA SOURCES
// shows "alice@contoso.com" instead of a Graph object id.
async function friendlyVendorName(
  db: any,
  table: string,
  recordId: string
): Promise<string | null> {
  const fqn = physicalTableName(table);
  if (!fqn) return null;
  try {
    const rows = (await db.execute(sql`
      select to_jsonb(t.*) as data from ${sql.raw(fqn)} t where t.id = ${recordId} limit 1
    `)) as Iterable<{ data: Record<string, unknown> | null }>;
    const data = [...rows][0]?.data;
    if (!data || typeof data !== 'object') return null;
    for (const field of FRIENDLY_FIELDS) {
      const value = (data as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
  } catch {
    return null;
  }
}

function canonicalHref(
  resourceType: string,
  resourceId: string,
  resourceTable: string | null,
  linkId: string | null
): string | null {
  if (resourceType === 'person') return `/people/${resourceId}`;
  if (resourceType === 'asset') return `/assets/${resourceId}`;
  // Vendor-scoped resources (typically integration_link findings like "no CA
  // policy matches"): deep-link to the vendor table for the tenant so users can
  // see the underlying records. The (vendors) layout reads ?linkId and sets scope.
  const route = resourceTable ? getPolicyTableShape(resourceTable)?.route : null;
  if (route && linkId) return `${route.path}?linkId=${linkId}`;
  return null;
}

async function loadBlockingParents(
  db: any,
  row: { policyId: string; linkId: string | null; siteId: string | null }
) {
  const parentRows = (await db
    .select({ parentPolicyId: policyDependencies.parentPolicyId })
    .from(policyDependencies)
    .where(eq(policyDependencies.childPolicyId, row.policyId))
    .catch(() => [])) as Array<{ parentPolicyId: string }>;
  const parentPolicyIds = [...new Set(parentRows.map((parent) => parent.parentPolicyId))] as string[];
  if (parentPolicyIds.length === 0) return [];

  const rows = await db
    .select({
      id: findingsWithContext.id,
      title: findingsWithContext.title,
      policyId: findingsWithContext.policyId,
      policyName: findingsWithContext.policyName,
      severity: findingsWithContext.severity,
      status: findingsWithContext.status,
      lastSeenAt: findingsWithContext.lastSeenAt
    })
    .from(findingsWithContext)
    .where(
      and(
        inArray(findingsWithContext.policyId, parentPolicyIds),
        inArray(findingsWithContext.status, [...OPEN_STATUSES]),
        row.linkId ? eq(findingsWithContext.linkId, row.linkId) : undefined,
        row.siteId
          ? or(isNull(findingsWithContext.siteId), eq(findingsWithContext.siteId, row.siteId))
          : undefined
      )
    )
    .orderBy(desc(findingsWithContext.severity), desc(findingsWithContext.lastSeenAt))
    .limit(8)
    .catch(() => []);

  return rows.map((parent: (typeof rows)[number]) => ({
    findingId: parent.id,
    findingTitle: parent.title,
    policyId: parent.policyId,
    policyName: parent.policyName,
    severity: parent.severity,
    status: parent.status,
    lastSeenAt: parent.lastSeenAt
  }));
}

export const findingsRouter = t.router({
  tableData: authProcedure
    .input(
      tableDataInputSchema.extend({
        groupId: z.string().uuid().optional()
      })
    )
    .query(async ({ ctx, input }) => {
    const scope = ctx.scopeFor('Findings.Read');
    if (scope !== 'all' && scope.length === 0) {
      return { rows: [], total: 0, page: input.page, pageSize: input.pageSize, pageCount: 0 };
    }
    const groupTargets = input.groupId ? await loadGroupTargets(ctx.db, input.groupId) : null;
    const scopeWhereParts = [];
    if (scope !== 'all') scopeWhereParts.push(inArray(findingsWithContext.siteId, [...scope]));
    if (groupTargets) {
      if (groupTargets.siteIds.length === 0 && groupTargets.linkIds.length === 0) {
        return { rows: [], total: 0, page: input.page, pageSize: input.pageSize, pageCount: 0 };
      }
      scopeWhereParts.push(
        groupTargets.siteIds.length > 0 && groupTargets.linkIds.length > 0
          ? or(
              inArray(findingsWithContext.siteId, groupTargets.siteIds),
              inArray(findingsWithContext.linkId, groupTargets.linkIds)
            )
          : groupTargets.siteIds.length > 0
            ? inArray(findingsWithContext.siteId, groupTargets.siteIds)
            : inArray(findingsWithContext.linkId, groupTargets.linkIds)
      );
    }
    const scopeWhere =
      scopeWhereParts.length > 1 ? and(...scopeWhereParts) : scopeWhereParts[0];
    return queryTableData<typeof findingsWithContext.$inferSelect>(
      ctx.db,
      findingsWithContext,
      input,
      [],
      { column: 'severity', direction: 'desc' },
      findingSelection,
      scopeWhere
    );
    }),

  list: authProcedure.input(listInput).query(async ({ ctx, input }) => {
    const scope = ctx.scopeFor('Findings.Read');
    if (scope !== 'all' && scope.length === 0) return [];
    const rows = await ctx.db
      .select(findingSelection)
      .from(findingsWithContext)
      .where(scope === 'all' ? undefined : inArray(findingsWithContext.siteId, [...scope]))
      .orderBy(desc(findingsWithContext.lastSeenAt))
      .limit(200)
      .catch(() => []);
    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        siteId: row.siteId,
        siteName: row.siteName,
        linkName: row.linkName,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        resourceName: row.resourceName,
        policyId: row.policyId,
        policyName: row.policyName,
        evidenceSummary: row.evidenceSummary,
        recommendation: row.recommendation ?? 'Review the evidence and remediate or suppress.',
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt
      }))
      .filter((finding) => {
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
      .select(findingSelection)
      .from(findingsWithContext)
      .where(eq(findingsWithContext.id, input.id))
      .limit(1)
      .catch(() => []);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    const scope = ctx.scopeFor('Findings.Read');
    if (scope !== 'all' && (!row.siteId || !scope.includes(row.siteId))) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    // Raw evidence payload lives on the base table, not the view.
    const [base] = await ctx.db
      .select({ evidence: findings.evidence })
      .from(findings)
      .where(eq(findings.id, input.id))
      .limit(1)
      .catch(() => []);

    const evidence = (base?.evidence ?? {}) as Record<string, unknown>;
    const [suppression] = await ctx.db
      .select({
        suppressedUntil: findings.suppressedUntil,
        suppressedAt: findings.suppressedAt,
        suppressionReason: findings.suppressionReason,
        suppressedBy: findings.suppressedBy
      })
      .from(findings)
      .where(eq(findings.id, input.id))
      .limit(1)
      .catch(() => []);

    const [suppressedByUser] = suppression?.suppressedBy
      ? await ctx.db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, suppression.suppressedBy))
          .limit(1)
          .catch(() => [])
      : [];

    // Data sources: the canonical entity (linkable) plus the underlying vendor
    // records it was reconciled from (e.g. the M365 identity behind a person).
    const dataSources: {
      kind: 'canonical' | 'vendor';
      label: string;
      table: string | null;
      name: string;
      href: string | null;
      externalId: string | null;
      provider: string | null;
    }[] = [];

    const canonicalLabel = tableLabel(row.resourceTable) ?? toProper(row.resourceType);
    // For integration_link-scoped findings (e.g. tenant-wide policy count checks)
    // the view falls back to the raw resource_id (link UUID) since no canonical
    // asset/person joined. Prefer the human-readable link name.
    let canonicalName =
      row.resourceType === 'integration_link' && row.linkName && row.linkName !== '-'
        ? row.linkName
        : row.resourceName;
    // If the resource is a vendor row (e.g. m365_identity), the view coalesces
    // resource_name down to the external id. Swap in a friendly field from the
    // vendor row (email/hostname/display_name/name) when available.
    if (row.resourceTable && row.resourceType !== 'person' && row.resourceType !== 'asset') {
      const friendly = await friendlyVendorName(ctx.db, row.resourceTable, row.resourceId);
      if (friendly) canonicalName = friendly;
    }
    dataSources.push({
      kind: 'canonical',
      label: canonicalLabel,
      table: row.resourceTable ?? null,
      name: canonicalName,
      href: canonicalHref(row.resourceType, row.resourceId, row.resourceTable, row.linkId),
      externalId: row.resourceExternalId ?? null,
      provider: null
    });

    if (row.resourceType === 'person' || row.resourceType === 'asset') {
      const sources = await ctx.db
        .select()
        .from(entitySources)
        .where(
          and(
            eq(entitySources.canonicalType, row.resourceType),
            eq(entitySources.canonicalId, row.resourceId),
            eq(entitySources.status, 'confirmed')
          )
        )
        .catch(() => []);
      const seen = new Set<string>();
      const friendlyLookups = await Promise.all(
        sources.map((source) =>
          friendlyVendorName(ctx.db, source.vendorTable, source.vendorRecordId)
        )
      );
      sources.forEach((source, index) => {
        const key = `${source.vendorTable}:${source.externalId}`;
        if (seen.has(key)) return;
        seen.add(key);
        dataSources.push({
          kind: 'vendor',
          label: tableLabel(source.vendorTable) ?? toProper(source.vendorTable),
          table: source.vendorTable,
          name: friendlyLookups[index] ?? source.externalId,
          href: null,
          externalId: source.externalId,
          provider: source.provider
        });
      });
    }

    // Friendly source badges for the header (deduped labels).
    const sourceLabels = [...new Set(dataSources.map((s) => s.label))];

    // "Living" context: other open findings that share this site or policy.
    const relatedColumns = {
      id: findingsWithContext.id,
      title: findingsWithContext.title,
      severity: findingsWithContext.severity,
      status: findingsWithContext.status,
      resourceName: findingsWithContext.resourceName,
      siteName: findingsWithContext.siteName,
      policyName: findingsWithContext.policyName,
      lastSeenAt: findingsWithContext.lastSeenAt
    };

    const relatedBySite = row.siteId
      ? await ctx.db
          .select(relatedColumns)
          .from(findingsWithContext)
          .where(
            and(
              eq(findingsWithContext.siteId, row.siteId),
              ne(findingsWithContext.id, row.id),
              inArray(findingsWithContext.status, [...OPEN_STATUSES])
            )
          )
          .orderBy(desc(findingsWithContext.severity), desc(findingsWithContext.lastSeenAt))
          .limit(8)
          .catch(() => [])
      : [];

    const relatedByPolicy = await ctx.db
      .select(relatedColumns)
      .from(findingsWithContext)
      .where(
        and(
          eq(findingsWithContext.policyId, row.policyId),
          ne(findingsWithContext.id, row.id),
          inArray(findingsWithContext.status, [...OPEN_STATUSES])
        )
      )
      .orderBy(desc(findingsWithContext.severity), desc(findingsWithContext.lastSeenAt))
      .limit(8)
      .catch(() => []);
    const blockedByParents = await loadBlockingParents(ctx.db, {
      policyId: row.policyId,
      linkId: row.linkId,
      siteId: row.siteId
    });

    return {
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      siteId: row.siteId,
      siteName: row.siteName,
      linkId: row.linkId,
      linkName: row.linkName,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      policyId: row.policyId,
      policyName: row.policyName,
      evidenceSummary: row.evidenceSummary,
      evidence,
      recommendation: row.recommendation ?? 'Review the evidence and remediate or suppress.',
      suppressedUntil: suppression?.suppressedUntil ?? null,
      suppressedAt: suppression?.suppressedAt ?? null,
      suppressionReason: suppression?.suppressionReason ?? null,
      suppressedBy: suppression?.suppressedBy ?? null,
      suppressedByLabel:
        suppressedByUser?.name || suppressedByUser?.email || suppression?.suppressedBy || null,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      sources: sourceLabels,
      dataSources,
      isBlockedByParent: blockedByParents.length > 0,
      blockedByParents,
      relatedBySite,
      relatedByPolicy
    };
  }),

  policyBreakdown: authProcedure.query(async ({ ctx }) => {
    const roleScope = ctx.scopeFor('Findings.Read');
    if (roleScope !== 'all' && roleScope.length === 0) return [];

    // Read workspace scope from the user's saved report prefs (same prefs used
    // by Reports and Dashboards, so the ScopeBar applies here too).
    const [prefs] = await ctx.db
      .select({ scopeKind: userReportPrefs.scopeKind, scopeIds: userReportPrefs.scopeIds })
      .from(userReportPrefs)
      .where(eq(userReportPrefs.userId, ctx.user.id))
      .limit(1)
      .catch(() => []);

    // Role ceiling on sites.
    let effectiveSiteIds: Set<string> | null =
      roleScope === 'all' ? null : new Set(roleScope);
    // Workspace link scope (null = no link restriction, empty Set = no links).
    let effectiveLinkIds: Set<string> | null = null;

    const narrowSites = (next: Set<string>) => {
      effectiveSiteIds =
        effectiveSiteIds === null
          ? next
          : new Set([...effectiveSiteIds].filter((id) => next.has(id)));
    };

    if (prefs && prefs.scopeKind !== 'all' && (prefs.scopeIds?.length ?? 0) > 0) {
      if (prefs.scopeKind === 'sites') {
        narrowSites(new Set(prefs.scopeIds!));
      } else if (prefs.scopeKind === 'links') {
        effectiveLinkIds = new Set(prefs.scopeIds!);
      } else if (prefs.scopeKind === 'groups') {
        const targets = await Promise.all(
          prefs.scopeIds!.map((gid) => loadGroupTargets(ctx.db, gid))
        );
        const groupSiteIds = new Set(targets.flatMap((t) => t.siteIds));
        const groupLinkIds = new Set(targets.flatMap((t) => t.linkIds));
        if (groupSiteIds.size === 0 && groupLinkIds.size === 0) return [];
        if (groupSiteIds.size > 0) narrowSites(groupSiteIds);
        else effectiveSiteIds = new Set(); // group has no site members
        if (groupLinkIds.size > 0) effectiveLinkIds = groupLinkIds;
      }
    }

    if (effectiveSiteIds !== null && effectiveSiteIds.size === 0 && effectiveLinkIds === null) return [];

    // Build a WHERE that matches site-scoped and/or link-scoped findings.
    const siteCondition =
      effectiveSiteIds === null ? undefined : inArray(findingsWithContext.siteId, [...effectiveSiteIds]);
    const linkCondition =
      effectiveLinkIds === null ? undefined : inArray(findingsWithContext.linkId, [...effectiveLinkIds]);
    const scopeWhere =
      siteCondition && linkCondition
        ? or(siteCondition, linkCondition)
        : siteCondition ?? linkCondition;

    // Summary grouped by policy, with category from the policies table.
    const policyRows = await ctx.db
      .select({
        policyId: findingsWithContext.policyId,
        policyName: findingsWithContext.policyName,
        category: policies.category,
        severity: sql<number>`max(${findingsWithContext.severity})::int`,
        totalFindings: sql<number>`count(*)::int`,
        siteCount: sql<number>`count(distinct ${findingsWithContext.siteId})::int`,
        linkCount: sql<number>`count(distinct ${findingsWithContext.linkId}) filter (where ${findingsWithContext.linkId} is not null)::int`
      })
      .from(findingsWithContext)
      .innerJoin(policies, eq(findingsWithContext.policyId, policies.id))
      .where(and(inArray(findingsWithContext.status, [...OPEN_STATUSES]), scopeWhere))
      .groupBy(findingsWithContext.policyId, findingsWithContext.policyName, policies.category)
      .orderBy(sql`max(${findingsWithContext.severity}) desc`, sql`count(*) desc`)
      .catch(() => []);

    if (policyRows.length === 0) return [];

    const policyIds = policyRows.map((r) => r.policyId);
    const detailRows = await ctx.db
      .select({
        policyId: findingsWithContext.policyId,
        siteId: findingsWithContext.siteId,
        siteName: findingsWithContext.siteName,
        linkId: findingsWithContext.linkId,
        linkName: findingsWithContext.linkName,
        count: sql<number>`count(*)::int`
      })
      .from(findingsWithContext)
      .where(
        and(
          inArray(findingsWithContext.policyId, policyIds),
          inArray(findingsWithContext.status, [...OPEN_STATUSES]),
          scopeWhere
        )
      )
      .groupBy(
        findingsWithContext.policyId,
        findingsWithContext.siteId,
        findingsWithContext.siteName,
        findingsWithContext.linkId,
        findingsWithContext.linkName
      )
      .catch(() => []);

    type SiteEntry = { siteId: string; siteName: string; count: number };
    type LinkEntry = {
      linkId: string;
      linkName: string;
      siteId: string | null;
      siteName: string | null;
      count: number;
    };
    const detailByPolicy = new Map<
      string,
      { sites: Map<string, SiteEntry>; links: Map<string, LinkEntry> }
    >();

    for (const row of detailRows) {
      if (!detailByPolicy.has(row.policyId)) {
        detailByPolicy.set(row.policyId, { sites: new Map(), links: new Map() });
      }
      const entry = detailByPolicy.get(row.policyId)!;
      if (row.siteId) {
        const existing = entry.sites.get(row.siteId);
        if (existing) {
          existing.count += row.count;
        } else {
          entry.sites.set(row.siteId, {
            siteId: row.siteId,
            siteName: row.siteName ?? row.siteId,
            count: row.count
          });
        }
      }
      if (row.linkId) {
        const existing = entry.links.get(row.linkId);
        if (existing) {
          existing.count += row.count;
        } else {
          entry.links.set(row.linkId, {
            linkId: row.linkId,
            linkName: row.linkName ?? row.linkId,
            siteId: row.siteId,
            siteName: row.siteName,
            count: row.count
          });
        }
      }
    }

    return policyRows.map((policy) => {
      const detail = detailByPolicy.get(policy.policyId);
      return {
        policyId: policy.policyId,
        policyName: policy.policyName,
        category: policy.category ?? null,
        severity: policy.severity,
        totalFindings: policy.totalFindings,
        siteCount: policy.siteCount,
        linkCount: policy.linkCount,
        sites: detail ? [...detail.sites.values()].sort((a, b) => b.count - a.count) : [],
        links: detail ? [...detail.links.values()].sort((a, b) => b.count - a.count) : []
      };
    });
  }),

  overview: authProcedure.query(async ({ ctx }) => {
    const scope = ctx.scopeFor('Findings.Read');
    if (scope !== 'all' && scope.length === 0) {
      return {
        totalOpen: 0,
        byStatus: { open: 0, acknowledged: 0, regressed: 0, suppressed: 0, resolved: 0 },
        severity: { critical: 0, high: 0, medium: 0, low: 0 },
        agedOver30d: 0,
        topPolicy: null as null | { policyId: string; policyName: string; count: number }
      };
    }
    const scopeWhere =
      scope === 'all' ? undefined : inArray(findings.siteId, [...scope]);
    const openWhere = and(inArray(findings.status, [...OPEN_STATUSES]), scopeWhere);

    const [statusRows, severityRows, agedRow, topPolicyRow] = await Promise.all([
      ctx.db
        .select({
          status: findings.status,
          count: sql<number>`count(*)::int`
        })
        .from(findings)
        .where(scopeWhere)
        .groupBy(findings.status)
        .catch(() => [] as { status: string; count: number }[]),
      ctx.db
        .select({
          severity: findings.severity,
          count: sql<number>`count(*)::int`
        })
        .from(findings)
        .where(openWhere as never)
        .groupBy(findings.severity)
        .catch(() => [] as { severity: number; count: number }[]),
      ctx.db
        .select({
          count: sql<number>`count(*)::int`
        })
        .from(findings)
        .where(
          and(
            openWhere,
            sql`${findings.firstSeenAt} < now() - interval '30 days'`
          ) as never
        )
        .catch(() => [{ count: 0 }]),
      ctx.db
        .select({
          policyId: findingsWithContext.policyId,
          policyName: findingsWithContext.policyName,
          count: sql<number>`count(*)::int`
        })
        .from(findingsWithContext)
        .where(
          and(
            inArray(findingsWithContext.status, [...OPEN_STATUSES]),
            scope === 'all' ? undefined : inArray(findingsWithContext.siteId, [...scope])
          ) as never
        )
        .groupBy(findingsWithContext.policyId, findingsWithContext.policyName)
        .orderBy(sql`count(*) desc`)
        .limit(1)
        .catch(() => [] as { policyId: string; policyName: string; count: number }[])
    ]);

    const byStatus = { open: 0, acknowledged: 0, regressed: 0, suppressed: 0, resolved: 0 };
    for (const row of statusRows) {
      if (row.status in byStatus) byStatus[row.status as keyof typeof byStatus] += row.count;
    }

    const severity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const row of severityRows) {
      if (row.severity === 4) severity.critical += row.count;
      else if (row.severity === 3) severity.high += row.count;
      else if (row.severity === 2) severity.medium += row.count;
      else severity.low += row.count;
    }

    return {
      totalOpen: byStatus.open + byStatus.acknowledged + byStatus.regressed,
      byStatus,
      severity,
      agedOver30d: agedRow[0]?.count ?? 0,
      topPolicy: topPolicyRow[0] ?? null
    };
  }),

  neighbor: authProcedure
    .input(
      z.object({
        id: z.string(),
        direction: z.enum(['prev', 'next']),
        // Optional constraints to keep the neighbor within the same working queue.
        onlyOpen: z.boolean().default(true)
      })
    )
    .query(async ({ ctx, input }) => {
      const scope = ctx.scopeFor('Findings.Read');
      if (scope !== 'all' && scope.length === 0) return null;

      // Get current finding's cursor position (severity + lastSeenAt).
      const [current] = await ctx.db
        .select({
          id: findings.id,
          severity: findings.severity,
          lastSeenAt: findings.lastSeenAt
        })
        .from(findings)
        .where(eq(findings.id, input.id))
        .limit(1);
      if (!current) return null;

      // Sort mirrors the list page default: severity desc, lastSeenAt desc.
      // "next" means "later in the queue" → lower severity or older lastSeen.
      const scopeWhere =
        scope === 'all' ? undefined : inArray(findings.siteId, [...scope]);
      const statusFilter = input.onlyOpen
        ? inArray(findings.status, [...OPEN_STATUSES])
        : undefined;

      const cursorForward = or(
        lt(findings.severity, current.severity),
        and(
          eq(findings.severity, current.severity),
          lt(findings.lastSeenAt, current.lastSeenAt)
        )
      );
      const cursorBackward = or(
        gt(findings.severity, current.severity),
        and(
          eq(findings.severity, current.severity),
          gt(findings.lastSeenAt, current.lastSeenAt)
        )
      );

      const [neighbor] = await ctx.db
        .select({ id: findings.id })
        .from(findings)
        .where(
          and(
            input.direction === 'next' ? cursorForward : cursorBackward,
            statusFilter,
            scopeWhere,
            ne(findings.id, input.id)
          ) as never
        )
        .orderBy(
          input.direction === 'next' ? desc(findings.severity) : asc(findings.severity),
          input.direction === 'next' ? desc(findings.lastSeenAt) : asc(findings.lastSeenAt)
        )
        .limit(1);

      return neighbor ? { id: neighbor.id } : null;
    }),

  resolve: authProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Write permission required' });
      }
      const [row] = await ctx.db
        .select(findingSelection)
        .from(findingsWithContext)
        .where(eq(findingsWithContext.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      if (row.status === 'suppressed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Suppressed findings must be returned to active tracking before resolving'
        });
      }

      const now = new Date().toISOString();
      const [updated] = await ctx.db
        .update(findings)
        .set({ status: 'resolved', updatedAt: now })
        .where(eq(findings.id, input.id))
        .returning({ id: findings.id });

      await ctx.db.insert(customerLogs).values({
        siteId: row.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'update',
        actionLabel: ActionLabels.FindingResolve,
        targetType: 'finding',
        targetId: row.id,
        targetLabel: row.title,
        result: updated ? 'success' : 'failure',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          previousStatus: row.status,
          newStatus: 'resolved',
          policyId: row.policyId,
          policyName: row.policyName,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          resourceName: row.resourceName,
          linkId: row.linkId
        }
      });

      return { id: input.id, status: 'resolved' as const };
    }),

  suppress: authProcedure
    .input(
      z.object({
        id: z.string(),
        reason: z.string().trim().min(3).max(1000),
        suppressedUntil: z.string().datetime()
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Assets.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Write permission required' });
      }

      const [row] = await ctx.db
        .select(findingSelection)
        .from(findingsWithContext)
        .where(eq(findingsWithContext.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      if (row.status === 'resolved') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Resolved findings cannot be suppressed'
        });
      }

      const now = new Date().toISOString();
      const suppressedUntil = new Date(input.suppressedUntil);
      const maxSuppressedUntil = new Date();
      maxSuppressedUntil.setDate(maxSuppressedUntil.getDate() + 180);
      if (suppressedUntil <= new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Suppression date must be in the future'
        });
      }
      if (suppressedUntil > maxSuppressedUntil) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Findings can only be suppressed up to 180 days'
        });
      }

      const [updated] = await ctx.db
        .update(findings)
        .set({
          status: 'suppressed',
          suppressedAt: now,
          suppressedUntil: input.suppressedUntil,
          suppressionReason: input.reason,
          suppressedBy: ctx.user.id,
          updatedAt: now
        })
        .where(eq(findings.id, input.id))
        .returning({ id: findings.id });

      await ctx.db.insert(customerLogs).values({
        siteId: row.siteId,
        actorType: 'user',
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: 'update',
        actionLabel: ActionLabels.FindingSuppress,
        targetType: 'finding',
        targetId: row.id,
        targetLabel: row.title,
        result: updated ? 'success' : 'failure',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          previousStatus: row.status,
          newStatus: 'suppressed',
          reason: input.reason,
          suppressedUntil: input.suppressedUntil,
          policyId: row.policyId,
          policyName: row.policyName,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          resourceName: row.resourceName,
          linkId: row.linkId
        }
      });

      return { id: input.id, status: 'suppressed' as const };
    }),

  unsuppress: authProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    if (!ctx.can('Assets.Write')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Assets.Write permission required' });
    }

    const [row] = await ctx.db
      .select(findingSelection)
      .from(findingsWithContext)
      .where(eq(findingsWithContext.id, input.id))
      .limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

    const [base] = await ctx.db
      .select({
        suppressionReason: findings.suppressionReason,
        suppressedUntil: findings.suppressedUntil
      })
      .from(findings)
      .where(eq(findings.id, input.id))
      .limit(1);

    const now = new Date().toISOString();
    const [updated] = await ctx.db
      .update(findings)
      .set({
        status: 'open',
        suppressedAt: null,
        suppressedUntil: null,
        suppressionReason: null,
        suppressedBy: null,
        updatedAt: now
      })
      .where(eq(findings.id, input.id))
      .returning({ id: findings.id });

    await ctx.db.insert(customerLogs).values({
      siteId: row.siteId,
      actorType: 'user',
      actorId: ctx.user.id,
      actorLabel: ctx.user.name || ctx.user.email,
      action: 'update',
      actionLabel: ActionLabels.FindingUnsuppress,
      targetType: 'finding',
      targetId: row.id,
      targetLabel: row.title,
      result: updated ? 'success' : 'failure',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        previousStatus: row.status,
        newStatus: 'open',
        previousReason: base?.suppressionReason ?? null,
        previousSuppressedUntil: base?.suppressedUntil ?? null,
        policyId: row.policyId,
        policyName: row.policyName,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        resourceName: row.resourceName,
        linkId: row.linkId
      }
    });

    return { id: input.id, status: 'open' as const };
  })
});
