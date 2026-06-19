import { z } from 'zod';
import {
  eq,
  ne,
  and,
  or,
  not,
  inArray,
  ilike,
  gt,
  lt,
  gte,
  lte,
  asc,
  desc,
  sql
} from 'drizzle-orm';
import { alerts, integrationLinks } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';

type AlertRow = typeof alerts.$inferSelect;

function alertEntityKeySql() {
  const ref = sql`coalesce(${alerts.entityRef}, ${alerts.entityId}, 'unknown')`;
  const label = sql`
    case
      when ${alerts.definitionId} like 'microsoft-365.licenses.%' then coalesce(
        nullif(${alerts.metadata}->>'friendlyName', ''),
        nullif(${alerts.metadata}->>'skuName', ''),
        ${alerts.entityRef},
        ${alerts.entityId},
        'Unknown license'
      )
      else coalesce(
        nullif(${alerts.metadata}->>'endpointName', ''),
        nullif(${alerts.metadata}->>'mailboxUpn', ''),
        nullif(${alerts.metadata}->>'email', ''),
        nullif(${alerts.metadata}->>'userPrincipalName', ''),
        nullif(${alerts.metadata}->>'hostname', ''),
        ${alerts.entityRef},
        ${alerts.entityId},
        'Unknown entity'
      )
    end
  `;

  return sql<string>`
    case
      when ${label} = ${ref} and ${ref} like '%::%' then split_part(${ref}, '::', 1)
      else ${label}
    end
  `;
}

function buildAlertConditions(input: {
  siteId?: string;
  linkId?: string;
  integrationId?: string;
  status?: 'active' | 'resolved' | 'suppressed';
  severity?: number;
  entityType?: string;
  search?: string;
  definitionPrefixes?: string[];
  definitionExcludePrefixes?: string[];
}) {
  const conditions = [];
  if (input.siteId) conditions.push(eq(alerts.siteId, input.siteId));
  else if (input.linkId) conditions.push(eq(alerts.linkId, input.linkId));
  if (input.integrationId) conditions.push(eq(integrationLinks.integrationId, input.integrationId));
  if (input.status) conditions.push(eq(alerts.status, input.status));
  if (input.severity != null) conditions.push(eq(alerts.severity, input.severity));
  if (input.entityType) conditions.push(eq(alerts.entityType, input.entityType));
  if (input.definitionPrefixes?.length) {
    conditions.push(
      or(...input.definitionPrefixes.map((prefix) => ilike(alerts.definitionId, `${prefix}%`)))!
    );
  }
  if (input.definitionExcludePrefixes?.length) {
    const excluded = or(
      ...input.definitionExcludePrefixes.map((prefix) => ilike(alerts.definitionId, `${prefix}%`))
    );
    if (excluded) conditions.push(not(excluded));
  }
  if (input.search?.trim()) {
    const q = `%${input.search.trim()}%`;
    conditions.push(
      or(
        ilike(alerts.message, q),
        ilike(alerts.definitionId, q),
        ilike(alerts.entityId, q),
        ilike(alerts.entityRef, q),
        ilike(sql`${alerts.metadata}::text`, q)
      )!
    );
  }
  return conditions;
}

export const alertsRouter = t.router({
  summaryByLink: authProcedure
    .input(
      z.object({
        integrationId: z.string().optional(),
        linkIds: z.array(z.string().uuid()).optional(),
        status: z.enum(['active', 'resolved', 'suppressed']).default('active')
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(alerts.status, input.status)];
      if (input.integrationId)
        conditions.push(eq(integrationLinks.integrationId, input.integrationId));
      if (input.linkIds?.length) conditions.push(inArray(alerts.linkId, input.linkIds));

      return ctx.db
        .select({
          linkId: alerts.linkId,
          alertCount: sql<number>`count(*)::int`,
          highestSeverity: sql<number | null>`max(${alerts.severity})::int`,
          criticalCount: sql<number>`count(*) filter (where ${alerts.severity} >= 3)::int`,
          highCount: sql<number>`count(*) filter (where ${alerts.severity} = 2)::int`
        })
        .from(alerts)
        .innerJoin(integrationLinks, eq(alerts.linkId, integrationLinks.id))
        .where(and(...conditions))
        .groupBy(alerts.linkId);
    }),

  list: authProcedure
    .input(
      z.object({
        siteId: z.string().optional(),
        linkId: z.string().optional(),
        status: z.enum(['active', 'resolved', 'suppressed']).optional(),
        severity: z.number().int().optional(),
        entityType: z.string().optional()
      })
    )
    .query(async ({ ctx, input }): Promise<AlertRow[]> => {
      const conditions = buildAlertConditions(input);
      return ctx.db
        .select()
        .from(alerts)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(alerts.lastSeenAt);
    }),

  insightGroups: authProcedure
    .input(
      z.object({
        siteId: z.string().uuid().optional(),
        linkId: z.string().uuid().optional(),
        integrationId: z.string().optional(),
        status: z.enum(['active', 'resolved', 'suppressed']).default('active'),
        definitionPrefixes: z.array(z.string()).optional(),
        definitionExcludePrefixes: z.array(z.string()).optional(),
        search: z.string().optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(250).default(100)
      })
    )
    .query(async ({ ctx, input }) => {
      const entityKey = alertEntityKeySql();
      const conditions = buildAlertConditions(input);
      const where = conditions.length ? and(...conditions) : undefined;

      const [{ total } = { total: 0 }] = await ctx.db
        .select({ total: sql<number>`count(*)::int` })
        .from(
          ctx.db
            .select({ entityKey })
            .from(alerts)
            .innerJoin(integrationLinks, eq(alerts.linkId, integrationLinks.id))
            .where(where)
            .groupBy(entityKey)
            .as('alert_groups')
        );

      const rows = await ctx.db
        .select({
          entityKey,
          alertCount: sql<number>`count(*)::int`,
          highestSeverity: sql<number>`max(${alerts.severity})::int`,
          lastSeenAt: sql<Date>`max(${alerts.lastSeenAt})`,
          primaryAlertId: sql<string>`(array_agg(${alerts.id} order by ${alerts.severity} desc, ${alerts.lastSeenAt} desc))[1]`,
          primaryDefinitionId: sql<
            string | null
          >`(array_agg(${alerts.definitionId} order by ${alerts.severity} desc, ${alerts.lastSeenAt} desc))[1]`,
          primaryMessage: sql<string>`(array_agg(${alerts.message} order by ${alerts.severity} desc, ${alerts.lastSeenAt} desc))[1]`,
          primaryMetadata: sql<unknown>`(array_agg(${alerts.metadata} order by ${alerts.severity} desc, ${alerts.lastSeenAt} desc))[1]`,
          moduleIds: sql<string[]>`array_remove(array_agg(distinct ${alerts.definitionId}), null)`
        })
        .from(alerts)
        .innerJoin(integrationLinks, eq(alerts.linkId, integrationLinks.id))
        .where(where)
        .groupBy(entityKey)
        .orderBy(
          sql`max(${alerts.severity}) desc`,
          sql`count(*) desc`,
          sql`max(${alerts.lastSeenAt}) desc`
        )
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);

      return {
        rows,
        total,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.ceil(total / input.pageSize)
      };
    }),

  insightGroupCounts: authProcedure
    .input(
      z.object({
        siteId: z.string().uuid().optional(),
        linkId: z.string().uuid().optional(),
        integrationId: z.string().optional(),
        status: z.enum(['active', 'resolved', 'suppressed']).default('active'),
        search: z.string().optional(),
        buckets: z.array(
          z.object({
            id: z.string(),
            definitionPrefixes: z.array(z.string()).optional(),
            definitionExcludePrefixes: z.array(z.string()).optional()
          })
        )
      })
    )
    .query(async ({ ctx, input }) => {
      const entityKey = alertEntityKeySql();

      return Promise.all(
        input.buckets.map(async (bucket) => {
          const conditions = buildAlertConditions({ ...input, ...bucket });
          const where = conditions.length ? and(...conditions) : undefined;

          const [{ total } = { total: 0 }] = await ctx.db
            .select({ total: sql<number>`count(*)::int` })
            .from(
              ctx.db
                .select({ entityKey })
                .from(alerts)
                .innerJoin(integrationLinks, eq(alerts.linkId, integrationLinks.id))
                .where(where)
                .groupBy(entityKey)
                .as('alert_groups')
            );

          return { id: bucket.id, total };
        })
      );
    }),

  insightGroupAlerts: authProcedure
    .input(
      z.object({
        siteId: z.string().uuid().optional(),
        linkId: z.string().uuid().optional(),
        integrationId: z.string().optional(),
        status: z.enum(['active', 'resolved', 'suppressed']).default('active'),
        definitionPrefixes: z.array(z.string()).optional(),
        definitionExcludePrefixes: z.array(z.string()).optional(),
        entityKey: z.string(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(250).default(100)
      })
    )
    .query(async ({ ctx, input }) => {
      const entityKey = alertEntityKeySql();
      const conditions = [...buildAlertConditions(input), eq(entityKey, input.entityKey)];
      const where = and(...conditions);

      const [{ total } = { total: 0 }] = await ctx.db
        .select({ total: sql<number>`count(*)::int` })
        .from(alerts)
        .innerJoin(integrationLinks, eq(alerts.linkId, integrationLinks.id))
        .where(where);

      const rows = await ctx.db
        .select()
        .from(alerts)
        .innerJoin(integrationLinks, eq(alerts.linkId, integrationLinks.id))
        .where(where)
        .orderBy(desc(alerts.severity), desc(alerts.lastSeenAt))
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);

      return {
        rows: rows.map((row) => row.alerts),
        total,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.ceil(total / input.pageSize)
      };
    }),

  suppress: authProcedure
    .input(
      z.object({ alertId: z.string(), until: z.string().datetime(), note: z.string().optional() })
    )
    .mutation(async ({ ctx, input }): Promise<AlertRow> => {
      const [updated] = await ctx.db
        .update(alerts)
        .set({
          status: 'suppressed',
          suppressedAt: new Date().toISOString(),
          suppressedUntil: new Date(input.until).toISOString(),
          suppressionNote: input.note,
          suppressedBy: ctx.userId,
          updatedAt: new Date().toISOString()
        })
        .where(eq(alerts.id, input.alertId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
      return updated;
    }),

  resolve: authProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ ctx, input }): Promise<AlertRow> => {
      const [updated] = await ctx.db
        .update(alerts)
        .set({
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .where(eq(alerts.id, input.alertId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
      return updated;
    }),

  tableData: authProcedure
    .input(
      z.object({
        siteId: z.string().uuid().optional(),
        linkId: z.string().optional(),
        integrationId: z.string().optional(),
        page: z.number().int().default(0),
        pageSize: z.number().int().default(25),
        globalSearch: z.string().optional(),
        filters: z
          .array(
            z.object({
              field: z.string(),
              operator: z.enum(['eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte']),
              value: z.string().optional()
            })
          )
          .optional(),
        sortField: z.string().optional(),
        sortDir: z.enum(['asc', 'desc']).optional()
      })
    )
    .query(async ({ ctx, input }): Promise<{ rows: AlertRow[]; total: number }> => {
      const conditions = [];

      if (input.siteId) conditions.push(eq(alerts.siteId, input.siteId));
      else if (input.linkId) conditions.push(eq(alerts.linkId, input.linkId));
      if (input.integrationId) {
        conditions.push(
          inArray(
            alerts.linkId,
            ctx.db
              .select({ id: integrationLinks.id })
              .from(integrationLinks)
              .where(eq(integrationLinks.integrationId, input.integrationId))
          )
        );
      }

      if (input.globalSearch) {
        const q = `%${input.globalSearch}%`;
        conditions.push(
          or(
            ilike(alerts.message, q),
            ilike(alerts.definitionId, q),
            ilike(alerts.entityId, q),
            ilike(alerts.entityRef, q),
            ilike(sql`${alerts.metadata}::text`, q)
          )!
        );
      }

      for (const f of input.filters ?? []) {
        if (f.field === 'status' && f.value) {
          const sv = f.value as 'active' | 'resolved' | 'suppressed';
          if (f.operator === 'eq') conditions.push(eq(alerts.status, sv));
          else if (f.operator === 'neq') conditions.push(ne(alerts.status, sv));
        }
        if (f.field === 'severity' && f.value != null) {
          const sev = parseInt(f.value);
          if (!isNaN(sev)) {
            if (f.operator === 'eq') conditions.push(eq(alerts.severity, sev));
            else if (f.operator === 'neq') conditions.push(ne(alerts.severity, sev));
            else if (f.operator === 'gt') conditions.push(gt(alerts.severity, sev));
            else if (f.operator === 'lt') conditions.push(lt(alerts.severity, sev));
            else if (f.operator === 'gte') conditions.push(gte(alerts.severity, sev));
            else if (f.operator === 'lte') conditions.push(lte(alerts.severity, sev));
          }
        }
      }

      const where = conditions.length ? and(...conditions) : undefined;

      const [{ total } = { total: 0 }] = await ctx.db
        .select({ total: sql<number>`count(*)::int` })
        .from(alerts)
        .where(where);

      const sortableMap = {
        lastSeenAt: alerts.lastSeenAt,
        severity: alerts.severity,
        status: alerts.status
      } as const;
      const sortCol = input.sortField
        ? (sortableMap[input.sortField as keyof typeof sortableMap] ?? alerts.lastSeenAt)
        : alerts.lastSeenAt;
      const order = input.sortDir === 'asc' ? asc(sortCol) : desc(sortCol);

      const rows = await ctx.db
        .select()
        .from(alerts)
        .where(where)
        .orderBy(order)
        .limit(input.pageSize)
        .offset(input.page * input.pageSize);

      return { rows, total };
    })
});
