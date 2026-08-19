import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  reports,
  userReportPrefs,
  integrationLinks,
  m365Identities,
  m365IdentityGroups,
  m365Groups,
  m365Roles,
  m365Licenses,
  m365Policies,
  m365Devices,
  sophosEndpoints,
  sophosFirewalls,
  dattoEndpoints,
  coveEndpoints,
  assets
} from '@mspbyte/drizzle';
import {
  PolicyTableShapes,
  getPolicyTableShape,
  type FieldDefinition,
  type PolicyTableShape,
  type SchemaFields
} from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

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
  m365Policies,
  m365Devices,
  sophosEndpoints,
  sophosFirewalls,
  dattoEndpoints,
  coveEndpoints
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
  object: ['is_null', 'is_not_null']
};

const reportFilterSchema = z.object({
  column: z.string(),
  operator: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional()
});

const reportDefinitionSchema = z.object({
  columns: z.array(z.string()).min(1),
  filters: z.array(reportFilterSchema).default([]),
  sort: z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }).optional()
});

type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

function validateDefinition(shape: PolicyTableShape, def: ReportDefinition): void {
  const fields: SchemaFields = shape.shape;
  const known = new Set(Object.keys(fields));

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
    if (filter.column === 'groupNames') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Groups can be displayed in identity reports but cannot be filtered yet'
      });
    }
    if (!OPERATORS_BY_TYPE[field.type].includes(filter.operator)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Operator "${filter.operator}" not supported for ${field.type} field "${filter.column}"`
      });
    }
  }

  if (def.sort && (!known.has(def.sort.column) || def.sort.column === 'groupNames')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown sort column "${def.sort.column}" for source "${shape.table}"`
    });
  }
}

/**
 * Identity assignments are stored as IDs so operational syncs remain stable.
 * Reports are an executive surface, so resolve those IDs to names before the
 * result leaves the API. This deliberately happens after SQL filtering: a
 * definition can still filter `assignedLicenses` efficiently in the source
 * table while exports and previews get readable values.
 */
async function decorateReportRows(
  ctx: Context,
  sourceName: string,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (sourceName !== 'm365Identities' || rows.length === 0) return rows;

  const identities = rows.filter(
    (row): row is Record<string, unknown> & { id: string } => typeof row.id === 'string'
  );
  const identityIds = identities.map((row) => row.id);
  if (!identityIds.length) return rows;

  const [licenses, roles, memberships] = await Promise.all([
    ctx.db
      .select({ externalId: m365Licenses.externalId, friendlyName: m365Licenses.friendlyName })
      .from(m365Licenses),
    ctx.db.select({ templateId: m365Roles.templateId, name: m365Roles.name }).from(m365Roles),
    ctx.db
      .select({ identityId: m365IdentityGroups.identityId, name: m365Groups.name })
      .from(m365IdentityGroups)
      .innerJoin(m365Groups, eq(m365IdentityGroups.groupId, m365Groups.id))
      .where(inArray(m365IdentityGroups.identityId, identityIds))
  ]);
  const licenseNames = new Map(licenses.map((row) => [row.externalId, row.friendlyName]));
  const roleNames = new Map(roles.map((row) => [row.templateId, row.name]));
  const groupNames = new Map<string, string[]>();
  for (const membership of memberships) {
    groupNames.set(membership.identityId, [
      ...(groupNames.get(membership.identityId) ?? []),
      membership.name
    ]);
  }

  return identities.map((row) => ({
    ...row,
    assignedLicenses: Array.isArray(row.assignedLicenses)
      ? row.assignedLicenses.map((id) => licenseNames.get(String(id)) ?? String(id))
      : row.assignedLicenses,
    assignedRoleTemplateIds: Array.isArray(row.assignedRoleTemplateIds)
      ? row.assignedRoleTemplateIds.map((id) => roleNames.get(String(id)) ?? String(id))
      : row.assignedRoleTemplateIds,
    groupNames: groupNames.get(row.id) ?? []
  }));
}

// -- scope resolution -------------------------------------------------------

type ResolvedScope =
  | { kind: 'unrestricted' }
  | { kind: 'empty' }
  | { kind: 'sites'; siteIds: readonly string[] };

/**
 * Layered scope: role scope (hard ceiling) ∩ workspace scope ∩ ad-hoc scope.
 * Ad-hoc scope arrives via `runReport` input; the workspace scope is read from
 * `user_report_prefs`. All three are expressed as site-id sets so we can
 * intersect. `groups` is resolved to sites via ctx.scopeFor primitives; `links`
 * is resolved to sites via integration_links.site_id downstream (we return the
 * link IDs directly for link-scoped sources).
 */
async function resolveScope(
  ctx: Context,
  workspace: { scopeKind: string; scopeIds: readonly string[] } | null,
  adhoc?: { kind: 'sites' | 'groups' | 'links'; ids: readonly string[] }
): Promise<ResolvedScope> {
  const roleScope = ctx.scopeFor('Reports.Read');
  if (roleScope !== 'all' && roleScope.length === 0) return { kind: 'empty' };

  // `null` means unrestricted; a Set means restricted to that set of site IDs.
  let sites: Set<string> | null = roleScope === 'all' ? null : new Set(roleScope);

  const narrow = (next: Set<string>) => {
    if (sites === null) sites = next;
    else sites = new Set([...sites].filter((id) => next.has(id)));
  };

  if (workspace && workspace.scopeKind !== 'all') {
    narrow(await scopeIdsToSiteIds(ctx, workspace.scopeKind, workspace.scopeIds));
  }

  if (adhoc) {
    narrow(await scopeIdsToSiteIds(ctx, adhoc.kind, adhoc.ids));
  }

  if (sites === null) return { kind: 'unrestricted' };
  if (sites.size === 0) return { kind: 'empty' };
  return { kind: 'sites', siteIds: [...sites] };
}

async function scopeIdsToSiteIds(
  ctx: Context,
  kind: string,
  ids: readonly string[]
): Promise<Set<string>> {
  if (kind === 'all' || ids.length === 0) return new Set();
  if (kind === 'sites') return new Set(ids);

  if (kind === 'groups') {
    const rows = await ctx.db
      .select({ siteId: sql<string>`site_id`.as('site_id') })
      .from(sql`public.site_group_members`)
      .where(sql`site_group_id = any(${ids as string[]})`);
    return new Set(rows.map((r) => r.siteId).filter((id): id is string => !!id));
  }

  if (kind === 'links') {
    const rows = await ctx.db
      .select({ siteId: integrationLinks.siteId })
      .from(integrationLinks)
      .where(inArray(integrationLinks.id, ids as string[]));
    return new Set(rows.map((r) => r.siteId).filter((id): id is string => !!id));
  }

  return new Set();
}

/**
 * Compose a WHERE fragment restricting rows to a given site-id set.
 * - `direct`: table has a `site_id` column; filter directly.
 * - `link`: table has a `link_id` FK to integration_links; resolve allowed link
 *   ids by querying integration_links.site_id ∈ siteIds, then filter link_id.
 */
async function buildScopeWhere(
  ctx: Context,
  shape: PolicyTableShape,
  scope: ResolvedScope
): Promise<SQL | undefined> {
  if (scope.kind === 'unrestricted') return undefined;
  if (scope.kind === 'empty') return sql`false`;

  const ss = shape.siteScope!;
  if (ss.via === 'direct') {
    return sql`${sql.identifier('site_id')} = any(${scope.siteIds as string[]})`;
  }

  // link scope: preload allowed link ids
  const linkRows = await ctx.db
    .select({ id: integrationLinks.id })
    .from(integrationLinks)
    .where(inArray(integrationLinks.siteId, scope.siteIds as string[]));
  const allowedLinkIds = linkRows.map((r) => r.id);
  if (allowedLinkIds.length === 0) return sql`false`;
  return sql`${sql.identifier('link_id')} = any(${allowedLinkIds})`;
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

export const reportsRouter = t.router({
  // Lists sources Reports can query (those with siteScope defined + an actual
  // drizzle table backing them).
  listSources: authProcedure.query(({ ctx }) => {
    requireReportsRead(ctx);
    return PolicyTableShapes.filter((s) => s.siteScope && SOURCE_TABLES[s.table]).map((s) => ({
      table: s.table,
      label: s.label,
      providerId: s.providerId ?? null,
      shape: s.shape
    }));
  }),

  list: authProcedure.query(async ({ ctx }) => {
    requireReportsRead(ctx);
    return ctx.db.select().from(reports).orderBy(reports.name);
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

    // Resolve definition: either from a saved report or an inline definition.
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

    if (scope.kind === 'empty') {
      return {
        rows: [],
        total: 0,
        page: input.table.page,
        pageSize: input.table.pageSize,
        pageCount: 0
      };
    }

    const scopeWhere = await buildScopeWhere(ctx, entry.shape, scope);

    // Merge the definition's saved filters into the runtime table input so both
    // the persisted filters and any ad-hoc filters the UI sends apply.
    const merged = {
      ...input.table,
      filters: [...(input.table.filters ?? []), ...definition.filters]
    };
    const defaultSort = definition.sort
      ? { column: definition.sort.column, direction: definition.sort.direction }
      : undefined;

    const result = await queryTableData<Record<string, unknown>>(
      ctx.db,
      entry.table,
      merged,
      undefined,
      defaultSort,
      undefined,
      scopeWhere
    );
    return { ...result, rows: await decorateReportRows(ctx, sourceName, result.rows) };
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
