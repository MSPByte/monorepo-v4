import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { customerLogs, sites } from '@mspbyte/drizzle';
import { hasPermission } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';

const filterSchema = z.object({
  column: z.string(),
  operator: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']),
  value: z.string().optional()
});

const SORT_COLUMNS = {
  createdAt: customerLogs.createdAt,
  actorLabel: customerLogs.actorLabel,
  action: customerLogs.action,
  actionLabel: customerLogs.actionLabel,
  targetType: customerLogs.targetType,
  targetLabel: customerLogs.targetLabel,
  result: customerLogs.result
} as const;

const FILTER_COLUMNS = {
  createdAt: customerLogs.createdAt,
  actorType: customerLogs.actorType,
  actorId: customerLogs.actorId,
  actorLabel: customerLogs.actorLabel,
  action: customerLogs.action,
  actionLabel: customerLogs.actionLabel,
  targetType: customerLogs.targetType,
  targetId: customerLogs.targetId,
  targetLabel: customerLogs.targetLabel,
  result: customerLogs.result,
  errorMessage: customerLogs.errorMessage,
  ipAddress: customerLogs.ipAddress,
  userAgent: customerLogs.userAgent
} as const;

function requireAdmin(attributes: unknown) {
  const attrs = (attributes as Record<string, boolean>) ?? null;
  if (!hasPermission(attrs, 'Global.Admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Global.Admin permission required' });
  }
}

function buildFilterCondition(filter: z.infer<typeof filterSchema>) {
  const column = FILTER_COLUMNS[filter.column as keyof typeof FILTER_COLUMNS];
  if (!column) return null;

  switch (filter.operator) {
    case 'eq':
      return eq(column, filter.value ?? '');
    case 'neq':
      return sql`${column} != ${filter.value ?? ''}`;
    case 'contains':
      return ilike(column, `%${filter.value ?? ''}%`);
    case 'gt':
      return sql`${column} > ${filter.value ?? ''}`;
    case 'gte':
      return sql`${column} >= ${filter.value ?? ''}`;
    case 'lt':
      return sql`${column} < ${filter.value ?? ''}`;
    case 'lte':
      return sql`${column} <= ${filter.value ?? ''}`;
    case 'is_null':
      return sql`${column} is null`;
    case 'is_not_null':
      return sql`${column} is not null`;
    default:
      return null;
  }
}

export const auditRouter = t.router({
  listCustomerLogs: authProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(1000).default(100),
        sortColumn: z.string().optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        filters: z.array(filterSchema).optional(),
        globalSearch: z.string().optional()
      })
    )
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.role.attributes);

      const offset = (input.page - 1) * input.pageSize;
      const conditions: SQL[] = [];

      for (const filter of input.filters ?? []) {
        const condition = buildFilterCondition(filter);
        if (condition) conditions.push(condition);
      }

      if (input.globalSearch) {
        const term = `%${input.globalSearch}%`;
        const searchConditions: SQL[] = [
          ilike(customerLogs.actorLabel, term),
          ilike(customerLogs.actionLabel, term),
          ilike(customerLogs.targetLabel, term),
          ilike(customerLogs.targetType, term),
          ilike(customerLogs.targetId, term),
          ilike(customerLogs.errorMessage, term)
        ];

        const searchCondition = or(...searchConditions);
        if (searchCondition) conditions.push(searchCondition);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const sortColumn = input.sortColumn
        ? SORT_COLUMNS[input.sortColumn as keyof typeof SORT_COLUMNS]
        : customerLogs.createdAt;
      const orderClause =
        input.sortDirection === 'asc'
          ? asc(sortColumn)
          : desc(sortColumn ?? customerLogs.createdAt);

      const baseSelect = {
        id: customerLogs.id,
        siteId: customerLogs.siteId,
        siteName: sites.name,
        actorType: customerLogs.actorType,
        actorId: customerLogs.actorId,
        actorLabel: customerLogs.actorLabel,
        action: customerLogs.action,
        actionLabel: customerLogs.actionLabel,
        targetType: customerLogs.targetType,
        targetId: customerLogs.targetId,
        targetLabel: customerLogs.targetLabel,
        result: customerLogs.result,
        errorMessage: customerLogs.errorMessage,
        ipAddress: customerLogs.ipAddress,
        userAgent: customerLogs.userAgent,
        metadata: customerLogs.metadata,
        createdAt: customerLogs.createdAt
      };

      const [rows, [countRow]] = await Promise.all([
        ctx.db
          .select(baseSelect)
          .from(customerLogs)
          .leftJoin(sites, eq(customerLogs.siteId, sites.id))
          .where(whereClause)
          .orderBy(orderClause)
          .limit(input.pageSize)
          .offset(offset),
        ctx.db.select({ count: count() }).from(customerLogs).where(whereClause)
      ]);

      return {
        rows,
        total: Number(countRow?.count ?? 0),
        page: input.page,
        pageSize: input.pageSize
      };
    })
});
