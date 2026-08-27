import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  reports,
  userReportPrefs,
  sites,
  integrationLinks,
  m365Identities,
  m365IdentityGroups,
  m365Groups,
  m365Roles,
  m365Licenses,
  m365Policies,
  m365Devices,
  m365OAuthGrants,
  m365DomainConfig,
  m365TeamsConfig,
  m365ExchangeConfigs,
  m365RiskyUsers,
  m365MailboxForwarding,
  m365InboxRules,
  sophosEndpoints,
  sophosFirewallsWithSite,
  sophosFirewallLicenses,
  sophosLicenses,
  dattoEndpoints,
  coveEndpoints,
  haloPsaRecurringItems,
  assets
} from '@mspbyte/drizzle';
import {
  PolicyTableShapes,
  M365_LICENSE_REQUIREMENTS,
  getPolicyTableShape,
  type FieldDefinition,
  type PolicyTableShape,
  type SchemaFields
} from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { loadGroupTargets } from './group-targets.js';
import { queryTableData, tableDataInputSchema, type TableDataInput } from './table-data.js';
import { applyJoins, JoinCache, joinFieldsMeta } from './reports-joins.js';

// -- permissions ------------------------------------------------------------

function requireReportsRead(ctx: Context) {
  if (!ctx.can('Reports.Read')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Reports.Read permission required' });
  }
}

function requireReportsWrite(ctx: Context) {
  if (!ctx.can('Reports.Write')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Reports.Write permission required' });
  }
}

function requireReportsDelete(ctx: Context) {
  if (!ctx.can('Reports.Delete')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Reports.Delete permission required' });
  }
}

// -- source registry --------------------------------------------------------

// Maps PolicyTableShape.table (camelCase) → drizzle table. Only sources that
// declare `siteScope` on their PolicyTableShape are exposed via Reports; a
// missing entry means "not queryable through Reports."
const SOURCE_TABLES: Record<string, unknown> = {
  assets,
  m365Identities,
  m365Groups,
  m365Licenses,
  m365Policies,
  m365Devices,
  m365OAuthGrants,
  m365DomainConfig,
  m365TeamsConfig,
  m365ExchangeConfigs,
  m365RiskyUsers,
  m365MailboxForwarding,
  m365InboxRules,
  sophosEndpoints,
  sophosFirewalls: sophosFirewallsWithSite,
  sophosLicenses,
  sophosFirewallLicenses,
  dattoEndpoints,
  coveEndpoints,
  haloPsaRecurringItems
};

function getSourceEntry(name: string): { shape: PolicyTableShape; table: unknown } | null {
  const shape = getPolicyTableShape(name);
  if (!shape || !shape.siteScope) return null;
  const table = SOURCE_TABLES[shape.table];
  if (!table) return null;
  return { shape, table };
}

// -- definition validation --------------------------------------------------

const OPERATORS_BY_TYPE: Record<FieldDefinition['type'], readonly string[]> = {
  string: ['eq', 'neq', 'contains', 'is_null', 'is_not_null'],
  enum: ['eq', 'neq', 'is_null', 'is_not_null'],
  boolean: ['eq', 'neq', 'is_null', 'is_not_null'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
  object: ['is_null', 'is_not_null']
};

const reportFilterSchema = z.object({
  column: z.string(),
  operator: z.enum([
    'eq',
    'neq',
    'contains',
    'gt',
    'gte',
    'lt',
    'lte',
    'is_null',
    'is_not_null',
    'has_requirement',
    'lacks_requirement',
    'has_any_of',
    'lacks_any_of'
  ]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional()
});

const reportDefinitionSchema = z.object({
  columns: z.array(z.string()).min(1),
  filters: z.array(reportFilterSchema).default([]),
  sort: z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }).optional()
});

type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

function isJoinKey(shape: PolicyTableShape, column: string): boolean {
  return (shape.joins ?? []).some((j) => j.key === column);
}

/** Display-only columns cannot be sorted at the DB level. This covers both
 * native fields marked trackable:false and every joined field, since joins
 * are hydrated post-query and have no SQL column to sort on. */
function isDisplayOnly(shape: PolicyTableShape, column: string): boolean {
  if (isJoinKey(shape, column)) return true;
  return shape.shape[column]?.trackable === false;
}

function isFilterable(shape: PolicyTableShape, column: string): boolean {
  const field = shape.shape[column];
  return field?.trackable === true || field?.filterable === true;
}

const licenseRequirements = new Map<string, (typeof M365_LICENSE_REQUIREMENTS)[number]>(
  M365_LICENSE_REQUIREMENTS.map((requirement) => [requirement.value, requirement])
);

function isRequirementFilter(filter: ReportDefinition['filters'][number]) {
  return filter.operator === 'has_requirement' || filter.operator === 'lacks_requirement';
}

function isLicenseSetFilter(filter: ReportDefinition['filters'][number]) {
  return filter.operator === 'has_any_of' || filter.operator === 'lacks_any_of';
}

function isFirewallHasLicensesFilter(filter: ReportDefinition['filters'][number]) {
  return filter.column === 'hasLicenses';
}

function sqlTextArray(values: readonly string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`;
}

/**
 * postgres-js serializes an interpolated JavaScript array as a scalar in a
 * SQL template, which makes `= any(${values})` fail at runtime. Build the
 * UUID list explicitly so scoped report queries remain parameterized.
 */
function sqlUuidIn(column: string, values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  const params = sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `
  );
  return sql`${sql.identifier(column)} in (${params})`;
}

function validateDefinition(shape: PolicyTableShape, def: ReportDefinition): void {
  const fields: SchemaFields = shape.shape;
  const joinKeys = new Set((shape.joins ?? []).map((j) => j.key));
  const known = new Set([...Object.keys(fields), ...joinKeys]);

  for (const col of def.columns) {
    if (!known.has(col)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown column "${col}" for source "${shape.table}"`
      });
    }
  }

  for (const filter of def.filters) {
    const field = fields[filter.column];
    if (!field) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown filter column "${filter.column}" for source "${shape.table}"`
      });
    }
    if (isFirewallHasLicensesFilter(filter)) {
      if (
        shape.table !== 'sophosFirewalls' ||
        (filter.operator !== 'eq' && filter.operator !== 'neq') ||
        typeof filter.value !== 'boolean'
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Sophos Firewall Has Licenses filters must compare to true or false'
        });
      }
      continue;
    }
    if (!isFilterable(shape, filter.column)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `${field.label} can be displayed in reports but cannot be filtered`
      });
    }
    if (isRequirementFilter(filter)) {
      if (shape.table !== 'm365Identities' || filter.column !== 'assignedLicenses') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'License coverage checks are only available for M365 identity licenses'
        });
      }
      if (typeof filter.value !== 'string' || !licenseRequirements.has(filter.value)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Unknown license coverage requirement'
        });
      }
      continue;
    }
    if (isLicenseSetFilter(filter)) {
      if (
        shape.table !== 'm365Identities' ||
        filter.column !== 'assignedLicenses' ||
        !Array.isArray(filter.value) ||
        filter.value.length === 0
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Choose one or more M365 licenses for this identity-license filter'
        });
      }
      continue;
    }
    if (!OPERATORS_BY_TYPE[field.type].includes(filter.operator)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Operator "${filter.operator}" not supported for ${field.type} field "${filter.column}"`
      });
    }
  }

  if (def.sort && (!known.has(def.sort.column) || isDisplayOnly(shape, def.sort.column))) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown sort column "${def.sort.column}" for source "${shape.table}"`
    });
  }
}

function buildLicenseWhere(filters: ReportDefinition['filters']): SQL | undefined {
  const conditions: SQL[] = [];
  for (const filter of filters) {
    if (isRequirementFilter(filter)) {
      const requirement = licenseRequirements.get(filter.value as string)!;
      const covered = sql`coalesce(${sql.identifier('assigned_licenses')}, array[]::text[]) && (
        select coalesce(array_agg(external_id), array[]::text[])
        from vendors.m365_licenses
        where service_plan_names && ${sqlTextArray(requirement.servicePlans)}
      )`;
      conditions.push(filter.operator === 'has_requirement' ? covered : sql`not (${covered})`);
    }
    if (isLicenseSetFilter(filter)) {
      const matches = sql`coalesce(${sql.identifier('assigned_licenses')}, array[]::text[]) && ${sqlTextArray(filter.value as string[])}`;
      conditions.push(filter.operator === 'has_any_of' ? matches : sql`not (${matches})`);
    }
    if (isFirewallHasLicensesFilter(filter)) {
      const hasLicenses = sql`exists (
        select 1
        from vendors.sophos_firewall_licenses as firewall_licenses
        where firewall_licenses.serial_number = ${sophosFirewallsWithSite.serialNumber}
          and jsonb_array_length(firewall_licenses.licenses) > 0
      )`;
      const matches = filter.value === true;
      conditions.push(
        filter.operator === 'eq'
          ? (matches ? hasLicenses : sql`not (${hasLicenses})`)
          : (matches ? sql`not (${hasLicenses})` : hasLicenses)
      );
    }
  }
  return conditions.length ? and(...conditions) : undefined;
}

/**
 * Identity assignments are stored as IDs so operational syncs remain stable.
 * Reports are an executive surface, so resolve those IDs to names before the
 * result leaves the API. This deliberately happens after SQL filtering: a
 * definition can still filter `assignedLicenses` efficiently in the source
 * table while exports and previews get readable values.
 */
async function decorateFirewallRows(
  ctx: Context,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;
  const serialNumbers = [
    ...new Set(
      rows.map((row) => row.serialNumber).filter((serial): serial is string => typeof serial === 'string')
    )
  ];
  if (serialNumbers.length === 0) return rows;

  const licenseRows = await ctx.db
    .select({
      serialNumber: sophosFirewallLicenses.serialNumber,
      ownerType: sophosFirewallLicenses.ownerType,
      licenses: sophosFirewallLicenses.licenses,
      lastCheckedAt: sophosFirewallLicenses.lastCheckedAt
    })
    .from(sophosFirewallLicenses)
    .where(inArray(sophosFirewallLicenses.serialNumber, serialNumbers));

  // Sophos firewall licenses can be stored on a different integration link
  // than the firewall itself. A serial number is the licensing identity.
  const licenseMap = new Map<string, (typeof licenseRows)[number]>();
  for (const license of licenseRows) {
    const existing = licenseMap.get(license.serialNumber);
    if (
      !existing ||
      (Array.isArray(license.licenses) && license.licenses.length > 0 &&
        (!Array.isArray(existing.licenses) || existing.licenses.length === 0))
    ) {
      licenseMap.set(license.serialNumber, license);
    }
  }

  return rows.map((row) => {
    const lic = typeof row.serialNumber === 'string' ? licenseMap.get(row.serialNumber) : undefined;
    return {
      ...row,
      licenseOwnerType: lic?.ownerType ?? null,
      hasLicenses: lic ? Array.isArray(lic.licenses) && lic.licenses.length > 0 : null,
      licenseLastCheckedAt: lic?.lastCheckedAt ?? null
    };
  });
}

/**
 * Legacy in-place decorators for source-specific behavior the declarative
 * joins system doesn't cover: sophos firewall license summary (needs a
 * jsonb_array_length SQL check), and the M365 identity assignedLicenses /
 * assignedRoleTemplateIds column rewrite from IDs to friendly names.
 * Declarative joins in `shape.joins` are applied afterwards by `applyJoins`.
 */
async function runLegacyDecorators(
  ctx: Context,
  sourceName: string,
  rows: Record<string, unknown>[],
  cache: JoinCache
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;
  if (sourceName === 'sophosFirewalls') return decorateFirewallRows(ctx, rows);
  if (sourceName !== 'm365Identities') return rows;

  const [licenseNames, roleNames] = await Promise.all([
    cache.load('legacy:m365LicenseNames', async () => {
      const rows = await ctx.db
        .select({ externalId: m365Licenses.externalId, friendlyName: m365Licenses.friendlyName })
        .from(m365Licenses);
      return new Map(rows.map((r) => [r.externalId, r.friendlyName]));
    }),
    cache.load('legacy:m365RoleNames', async () => {
      const rows = await ctx.db
        .select({ templateId: m365Roles.templateId, name: m365Roles.name })
        .from(m365Roles);
      return new Map(rows.map((r) => [r.templateId, r.name]));
    })
  ]);

  for (const row of rows) {
    if (Array.isArray(row.assignedLicenses)) {
      row.assignedLicenses = row.assignedLicenses.map(
        (id) => licenseNames.get(String(id)) ?? String(id)
      );
    }
    if (Array.isArray(row.assignedRoleTemplateIds)) {
      row.assignedRoleTemplateIds = row.assignedRoleTemplateIds.map(
        (id) => roleNames.get(String(id)) ?? String(id)
      );
    }
  }
  return rows;
}

async function decorateReportRows(
  ctx: Context,
  shape: PolicyTableShape,
  rows: Record<string, unknown>[],
  cache: JoinCache
): Promise<Record<string, unknown>[]> {
  const withLegacy = await runLegacyDecorators(ctx, shape.table, rows, cache);
  return applyJoins(ctx, shape, withLegacy, cache);
}

// -- scope resolution -------------------------------------------------------

type ResolvedScope =
  | { kind: 'unrestricted' }
  | { kind: 'empty' }
  | {
      kind: 'scoped';
      /** Site restrictions from role, site, and group scope. */
      siteIds: readonly string[] | null;
      /** Exact active M365 links selected by the link picker or a group. */
      linkIds: readonly string[] | null;
      /** The selected links' sites, used only by direct site-scoped sources. */
      linkSiteIds: readonly string[] | null;
      /**
       * A group explicitly selected M365 tenant links. Those IDs scope M365
       * sources only; the group's site members continue to scope every other
       * provider.
       */
      useExplicitM365LinksOnly: boolean;
    };

// Reports currently use integration-link scope only for M365 tenant data.
const REPORT_LINK_INTEGRATION_ID = 'microsoft-365';

/**
 * Layered scope: role scope (hard ceiling) ∩ workspace scope ∩ ad-hoc scope.
 * Ad-hoc scope arrives via `runReport` input; the workspace scope is read from
 * `user_report_prefs`. Site and group scopes resolve to site IDs; selected
 * M365 tenant links retain their link IDs so tenant-scoped tables still work
 * when a link has no associated site. When a group contains both site members
 * and M365 links, the latter are applied only to M365 sources.
 */
async function resolveScope(
  ctx: Context,
  workspace: { scopeKind: string; scopeIds: readonly string[] } | null,
  adhoc?: { kind: 'sites' | 'groups' | 'links'; ids: readonly string[] }
): Promise<ResolvedScope> {
  const roleSiteScope = ctx.scopeFor('Reports.Read');
  const roleLinkScope = ctx.linkScopeFor('Reports.Read');
  const hasNoRoleSites = roleSiteScope !== 'all' && roleSiteScope.length === 0;
  const hasNoRoleLinks = roleLinkScope !== 'all' && roleLinkScope.length === 0;
  if (hasNoRoleSites && hasNoRoleLinks) return { kind: 'empty' };

  // `null` means unrestricted; a Set means restricted to that dimension.
  let sites: Set<string> | null = roleSiteScope === 'all' ? null : new Set(roleSiteScope);
  // linkScopeFor includes every link attached to a site-scoped grant. Those
  // IDs are already bounded by `sites`; retain a link ceiling only when the
  // permission is granted exclusively through explicit link membership.
  let links: Set<string> | null =
    hasNoRoleSites && roleLinkScope !== 'all' ? new Set(roleLinkScope) : null;

  // A group can grant Reports.Read to individual links without granting any
  // sites. In that case the link set is the permission ceiling.
  if (hasNoRoleSites && links !== null && links.size > 0) sites = null;

  // A globally scoped Reports role can narrow M365 data exclusively by the
  // tenant links in a selected group. A site-scoped role keeps its site ceiling
  // applied, so group selection cannot widen the user's access.
  const canUseExplicitM365LinksOnly = roleSiteScope === 'all';
  let useExplicitM365LinksOnly = false;

  const narrowSites = (next: Set<string>) => {
    if (sites === null) sites = next;
    else sites = new Set([...sites].filter((id) => next.has(id)));
  };
  const narrowLinks = (next: Set<string>) => {
    if (links === null) links = next;
    else links = new Set([...links].filter((id) => next.has(id)));
  };
  const applyScope = async (scope: {
    kind: 'sites' | 'groups' | 'links';
    ids: readonly string[];
  }) => {
    if (scope.kind === 'links') {
      narrowLinks(new Set(scope.ids));
      return;
    }
    if (scope.kind === 'groups') {
      const targets = await loadGroupScopeTargets(ctx, scope.ids);
      if (targets.siteIds.length) narrowSites(new Set(targets.siteIds));
      if (targets.linkIds.length) {
        narrowLinks(new Set(targets.linkIds));
        useExplicitM365LinksOnly ||= canUseExplicitM365LinksOnly;
      }
      // An empty group should not expose report data. A link-only group leaves
      // the role's site ceiling intact while retaining its M365 link IDs.
      if (targets.siteIds.length === 0 && targets.linkIds.length === 0) {
        narrowSites(new Set());
      }
      return;
    }
    narrowSites(new Set(scope.ids));
  };

  if (workspace && workspace.scopeKind !== 'all') {
    await applyScope({
      kind: workspace.scopeKind as 'sites' | 'groups' | 'links',
      ids: workspace.scopeIds
    });
  }
  if (adhoc) await applyScope(adhoc);

  let linkSiteIds: readonly string[] | null = null;
  if (links !== null) {
    const activeLinks = await loadActiveM365ReportLinks(ctx, [...links]);
    links = new Set(activeLinks.map((link) => link.id));
    if (links.size === 0) return { kind: 'empty' };
    linkSiteIds = [...new Set(activeLinks.map((link) => link.siteId).filter(Boolean))] as string[];
  }

  if (sites !== null && sites.size === 0 && links === null) return { kind: 'empty' };
  if (sites === null && links === null) return { kind: 'unrestricted' };
  return {
    kind: 'scoped',
    siteIds: sites === null ? null : [...sites],
    linkIds: links === null ? null : [...links],
    linkSiteIds,
    useExplicitM365LinksOnly
  };
}

async function loadGroupScopeTargets(
  ctx: Context,
  groupIds: readonly string[]
): Promise<{ siteIds: string[]; linkIds: string[] }> {
  const targets = await Promise.all(groupIds.map((groupId) => loadGroupTargets(ctx.db, groupId)));
  const siteIds = [...new Set(targets.flatMap((target) => target.siteIds))];
  const activeLinks = await loadActiveM365ReportLinks(ctx, [
    ...new Set(targets.flatMap((target) => target.linkIds))
  ]);
  return { siteIds, linkIds: activeLinks.map((link) => link.id) };
}

async function loadActiveM365ReportLinks(ctx: Context, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return ctx.db
    .select({ id: integrationLinks.id, siteId: integrationLinks.siteId })
    .from(integrationLinks)
    .where(
      and(
        inArray(integrationLinks.id, ids as string[]),
        eq(integrationLinks.integrationId, REPORT_LINK_INTEGRATION_ID),
        eq(integrationLinks.status, 'active')
      )
    );
}

/**
 * Compose a WHERE fragment restricting rows to a given site-id set.
 * - `direct`: table has a `site_id` column; filter by site scope and by the
 *   selected links' sites.
 * - `link`: table has a `link_id` FK to integration_links; filter by the
 *   exact selected M365 tenant links, plus any site scope.
 */
async function buildScopeWhere(
  ctx: Context,
  shape: PolicyTableShape,
  scope: ResolvedScope
): Promise<SQL | undefined> {
  if (scope.kind === 'unrestricted') return undefined;
  if (scope.kind === 'empty') return sql`false`;

  const ss = shape.siteScope!;
  const isM365Source = shape.providerId === REPORT_LINK_INTEGRATION_ID;
  const usesM365GroupLinkScope = isM365Source && scope.useExplicitM365LinksOnly;

  // A group made up only of M365 links has no applicable scope for non-M365
  // sources. Do not let that absence of site IDs turn into an unscoped query.
  if (scope.useExplicitM365LinksOnly && !isM365Source && scope.siteIds === null) {
    return sql`false`;
  }

  if (ss.via === 'direct') {
    const directSiteIds = scope.useExplicitM365LinksOnly
      ? scope.siteIds
      : intersectScopeIds(scope.siteIds, scope.linkSiteIds);
    if (directSiteIds === null) return undefined;
    if (directSiteIds.length === 0) return sql`false`;
    return sqlUuidIn('site_id', directSiteIds);
  }

  const conditions: SQL[] = [];
  // Group M365 links are not a constraint for Sophos or other site-scoped
  // providers. Explicit link-picker scopes still constrain every link source.
  if (scope.linkIds !== null && (!scope.useExplicitM365LinksOnly || isM365Source)) {
    if (scope.linkIds.length === 0) return sql`false`;
    conditions.push(sqlUuidIn('link_id', scope.linkIds));
  }
  if (scope.siteIds !== null && !usesM365GroupLinkScope) {
    if (scope.siteIds.length === 0) return sql`false`;
    const linkRows = await ctx.db
      .select({ id: integrationLinks.id })
      .from(integrationLinks)
      .where(inArray(integrationLinks.siteId, scope.siteIds as string[]));
    const allowedLinkIds = linkRows.map((r) => r.id);
    if (allowedLinkIds.length === 0) return sql`false`;
    conditions.push(sqlUuidIn('link_id', allowedLinkIds));
  }
  return conditions.length ? and(...conditions) : undefined;
}

function intersectScopeIds(
  left: readonly string[] | null,
  right: readonly string[] | null
): readonly string[] | null {
  if (left === null) return right;
  if (right === null) return left;
  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id));
}

// -- workspace prefs helpers ------------------------------------------------

async function loadPrefs(ctx: Context) {
  const [row] = await ctx.db
    .select()
    .from(userReportPrefs)
    .where(eq(userReportPrefs.userId, ctx.user.id))
    .limit(1);
  return row ?? null;
}

// -- router -----------------------------------------------------------------

const saveReportInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  source: z.string().min(1),
  definition: reportDefinitionSchema
});

const runReportInput = z.object({
  reportId: z.string().uuid().optional(),
  source: z.string().min(1).optional(),
  definition: reportDefinitionSchema.optional(),
  adhocScope: z
    .object({
      kind: z.enum(['sites', 'groups', 'links']),
      ids: z.array(z.string().uuid())
    })
    .optional(),
  table: tableDataInputSchema
});

const savePrefsInput = z.object({
  landingDashboardId: z.string().uuid().optional().nullable(),
  scopeKind: z.enum(['all', 'sites', 'groups', 'links']).optional(),
  scopeIds: z.array(z.string().uuid()).optional(),
  favoriteReportIds: z.array(z.string().uuid()).optional()
});

/** Hard cap on rows a single bulk export returns. Exports larger than this
 * are silently truncated and the response is flagged `truncated: true` so the
 * client can warn the user. Executive reports don't need more than this. */
const MAX_EXPORT_ROWS = 100_000;
const BULK_PAGE_SIZE = 1000;

type PreparedRun =
  | { empty: true }
  | {
      empty: false;
      entry: NonNullable<ReturnType<typeof getSourceEntry>>;
      merged: TableDataInput;
      defaultSort: { column: string; direction: 'asc' | 'desc' } | undefined;
      combinedWhere: SQL | undefined;
    };

/**
 * Shared setup for `run` / `runBulk`: resolves the definition (from saved
 * report id or inline), validates it, resolves scope, and builds the WHERE
 * clause. Returns everything a paged query needs.
 */
async function prepareReportRun(
  ctx: Context,
  input: z.infer<typeof runReportInput>
): Promise<PreparedRun> {
  let sourceName: string;
  let definition: ReportDefinition;
  if (input.reportId) {
    const [row] = await ctx.db
      .select()
      .from(reports)
      .where(eq(reports.id, input.reportId))
      .limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
    sourceName = row.source;
    definition = reportDefinitionSchema.parse(row.definition);
  } else {
    if (!input.source || !input.definition) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Either reportId or (source + definition) is required'
      });
    }
    sourceName = input.source;
    definition = input.definition;
  }

  const entry = getSourceEntry(sourceName);
  if (!entry) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown or unsupported source "${sourceName}"`
    });
  }
  validateDefinition(entry.shape, definition);

  const prefs = await loadPrefs(ctx);
  const scope = await resolveScope(
    ctx,
    prefs ? { scopeKind: prefs.scopeKind, scopeIds: prefs.scopeIds ?? [] } : null,
    input.adhocScope
  );
  if (scope.kind === 'empty') return { empty: true };

  const scopeWhere = await buildScopeWhere(ctx, entry.shape, scope);
  const requirementWhere = buildLicenseWhere(definition.filters);

  const merged: TableDataInput = {
    ...input.table,
    filters: [
      ...(input.table.filters ?? []),
      ...definition.filters
        .filter(
          (filter) =>
            !isRequirementFilter(filter) &&
            !isLicenseSetFilter(filter) &&
            !isFirewallHasLicensesFilter(filter)
        )
        .map((filter) => ({
          ...filter,
          operator: filter.operator as NonNullable<TableDataInput['filters']>[number]['operator'],
          value: filter.value as string | number | boolean | undefined
        }))
    ]
  };
  const defaultSort = definition.sort
    ? { column: definition.sort.column, direction: definition.sort.direction }
    : undefined;
  const combinedWhere =
    scopeWhere && requirementWhere
      ? and(scopeWhere, requirementWhere)
      : (scopeWhere ?? requirementWhere);

  return { empty: false, entry, merged, defaultSort, combinedWhere };
}

export const reportsRouter = t.router({
  // Lists sources Reports can query (those with siteScope defined + an actual
  // drizzle table backing them).
  listSources: authProcedure.query(({ ctx }) => {
    requireReportsRead(ctx);
    return PolicyTableShapes.filter((s) => s.siteScope && SOURCE_TABLES[s.table]).map((s) => ({
      table: s.table,
      label: s.label,
      providerId: s.providerId ?? null,
      route: s.route?.path ?? null,
      shape: s.shape,
      joinFields: joinFieldsMeta(s),
      licenseRequirements: s.table === 'm365Identities' ? M365_LICENSE_REQUIREMENTS : []
    }));
  }),

  list: authProcedure.query(async ({ ctx }) => {
    requireReportsRead(ctx);
    return ctx.db.select().from(reports).orderBy(reports.name);
  }),

  // The report scope picker only needs stable site identities.  Do not reuse
  // `sites.list` here: that endpoint is governed by Sites.Read and selects
  // from the metrics view, neither of which should prevent a Reports.Read
  // user from choosing an allowed report scope.
  listScopeSites: authProcedure.query(async ({ ctx }) => {
    requireReportsRead(ctx);
    const scope = ctx.scopeFor('Reports.Read');
    if (scope !== 'all' && scope.length === 0) return [];

    return ctx.db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(scope === 'all' ? undefined : inArray(sites.id, [...scope]))
      .orderBy(sites.name);
  }),

  listFilterValues: authProcedure
    .input(z.object({ source: z.literal('m365Identities'), column: z.literal('assignedLicenses') }))
    .query(async ({ ctx }) => {
      requireReportsRead(ctx);
      const prefs = await loadPrefs(ctx);
      const scope = await resolveScope(
        ctx,
        prefs ? { scopeKind: prefs.scopeKind, scopeIds: prefs.scopeIds ?? [] } : null
      );
      if (scope.kind === 'empty') return [];
      const entry = getSourceEntry('m365Identities')!;
      const scopeWhere = await buildScopeWhere(ctx, entry.shape, scope);
      const rows = await ctx.db
        .select({
          value: m365Licenses.externalId,
          label: m365Licenses.friendlyName,
          subLabel: m365Licenses.skuPartNumber
        })
        .from(m365Licenses)
        .where(and(scopeWhere, eq(m365Licenses.isBloat, false)));
      return [...new Map(rows.map((row) => [row.value, row])).values()].sort((a, b) =>
        a.label.localeCompare(b.label)
      );
    }),

  byId: authProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireReportsRead(ctx);
    const [row] = await ctx.db.select().from(reports).where(eq(reports.id, input.id)).limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
    return row;
  }),

  save: authProcedure.input(saveReportInput).mutation(async ({ ctx, input }) => {
    requireReportsWrite(ctx);
    const entry = getSourceEntry(input.source);
    if (!entry) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown or unsupported source "${input.source}"`
      });
    }
    validateDefinition(entry.shape, input.definition);

    const now = new Date().toISOString();
    if (input.id) {
      const [updated] = await ctx.db
        .update(reports)
        .set({
          name: input.name,
          description: input.description ?? null,
          source: input.source,
          definition: input.definition,
          updatedAt: now
        })
        .where(eq(reports.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      return updated;
    }

    const [created] = await ctx.db
      .insert(reports)
      .values({
        name: input.name,
        description: input.description ?? null,
        source: input.source,
        definition: input.definition,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    return created;
  }),

  delete: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireReportsDelete(ctx);
      const [deleted] = await ctx.db
        .delete(reports)
        .where(eq(reports.id, input.id))
        .returning({ id: reports.id });
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      return { id: deleted.id };
    }),

  run: authProcedure.input(runReportInput).mutation(async ({ ctx, input }) => {
    requireReportsRead(ctx);
    const prepared = await prepareReportRun(ctx, input);
    if (prepared.empty) {
      return {
        rows: [],
        total: 0,
        page: input.table.page,
        pageSize: input.table.pageSize,
        pageCount: 0
      };
    }
    const { entry, merged, defaultSort, combinedWhere } = prepared;

    const result = await queryTableData<Record<string, unknown>>(
      ctx.db,
      entry.table,
      merged,
      undefined,
      defaultSort,
      undefined,
      combinedWhere
    );
    return {
      ...result,
      rows: await decorateReportRows(ctx, entry.shape, result.rows, new JoinCache())
    };
  }),

  /**
   * Server-side bulk export. Runs the same query as `run` but loops pages
   * server-side with a shared JoinCache so reference tables (m365Licenses,
   * m365Roles, integration_links) are loaded once per export instead of per
   * page. Enforces `MAX_EXPORT_ROWS`; the client pairs this with CSV
   * formatting so the export path is a single round trip.
   */
  runBulk: authProcedure.input(runReportInput).mutation(async ({ ctx, input }) => {
    requireReportsRead(ctx);
    const prepared = await prepareReportRun(ctx, input);
    if (prepared.empty) {
      return { rows: [], total: 0, truncated: false };
    }
    const { entry, merged, defaultSort, combinedWhere } = prepared;

    const cache = new JoinCache();
    const collected: Record<string, unknown>[] = [];
    let total = 0;
    let truncated = false;
    let page = 1;

    while (true) {
      const pageInput = { ...merged, page, pageSize: BULK_PAGE_SIZE };
      const result = await queryTableData<Record<string, unknown>>(
        ctx.db,
        entry.table,
        pageInput,
        undefined,
        defaultSort,
        undefined,
        combinedWhere
      );
      total = result.total;
      if (result.rows.length === 0) break;

      const remaining = MAX_EXPORT_ROWS - collected.length;
      const slice = result.rows.slice(0, remaining);
      const decorated = await decorateReportRows(ctx, entry.shape, slice, cache);
      collected.push(...decorated);

      if (collected.length >= MAX_EXPORT_ROWS) {
        truncated = result.total > MAX_EXPORT_ROWS;
        break;
      }
      if (page >= result.pageCount) break;
      page += 1;
    }

    return { rows: collected, total, truncated };
  }),

  getMyPrefs: authProcedure.query(async ({ ctx }) => {
    const row = await loadPrefs(ctx);
    return (
      row ?? {
        userId: ctx.user.id,
        landingDashboardId: null,
        scopeKind: 'all' as const,
        scopeIds: [] as string[],
        favoriteReportIds: [] as string[],
        updatedAt: new Date().toISOString()
      }
    );
  }),

  saveMyPrefs: authProcedure.input(savePrefsInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const existing = await loadPrefs(ctx);
    if (existing) {
      const [updated] = await ctx.db
        .update(userReportPrefs)
        .set({
          landingDashboardId:
            input.landingDashboardId === undefined
              ? existing.landingDashboardId
              : input.landingDashboardId,
          scopeKind: input.scopeKind ?? existing.scopeKind,
          scopeIds: input.scopeIds ?? existing.scopeIds,
          favoriteReportIds: input.favoriteReportIds ?? existing.favoriteReportIds,
          updatedAt: now
        })
        .where(eq(userReportPrefs.userId, ctx.user.id))
        .returning();
      return updated;
    }
    const [created] = await ctx.db
      .insert(userReportPrefs)
      .values({
        userId: ctx.user.id,
        landingDashboardId: input.landingDashboardId ?? null,
        scopeKind: input.scopeKind ?? 'all',
        scopeIds: input.scopeIds ?? [],
        favoriteReportIds: input.favoriteReportIds ?? [],
        updatedAt: now
      })
      .returning();
    return created;
  })
});

// unused-import guards for helpers only reached via drizzle relation types
void and;
