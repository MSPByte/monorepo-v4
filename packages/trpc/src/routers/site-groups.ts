import { z } from 'zod';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  customerLogs,
  siteGroupMembers,
  siteGroups,
  sites
} from '@mspbyte/drizzle';
import { ActionLabels, hasPermission, type Permission } from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';
import type { Context } from '../context.js';

function requirePermission(ctx: Context, permission: Permission) {
  const attrs = (ctx.role.attributes as Record<string, boolean> | null) ?? null;
  if (!hasPermission(attrs, permission)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${permission} permission required` });
  }
}

async function auditGroupChange(
  ctx: Context,
  input: {
    groupId: string;
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetLabel: string;
    siteId?: string | null;
    result?: 'success' | 'failure';
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: input.siteId ?? null,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: ctx.user.name || ctx.user.email,
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: 'site_group',
    targetId: input.groupId,
    targetLabel: input.targetLabel,
    result: input.result ?? 'success',
    errorMessage: input.errorMessage,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata ?? null
  });
}

export const siteGroupsRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData<typeof siteGroups.$inferSelect>(
      ctx.db,
      siteGroups,
      input,
      [],
      { column: 'name', direction: 'asc' }
    );

    const groupIds = result.rows.map((row) => row.id);
    const counts = groupIds.length
      ? await ctx.db
          .select({
            siteGroupId: siteGroupMembers.siteGroupId,
            memberCount: count()
          })
          .from(siteGroupMembers)
          .where(inArray(siteGroupMembers.siteGroupId, groupIds))
          .groupBy(siteGroupMembers.siteGroupId)
          .catch(() => [])
      : [];

    const countByGroup = new Map<string, number>(
      counts.map((row) => [row.siteGroupId, Number(row.memberCount)])
    );

    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        memberCount: countByGroup.get(row.id) ?? 0
      }))
    };
  }),

  list: authProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: siteGroups.id,
        name: siteGroups.name,
        description: siteGroups.description
      })
      .from(siteGroups)
      .orderBy(siteGroups.name)
      .catch(() => []);
  }),

  byId: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [group] = await ctx.db
        .select()
        .from(siteGroups)
        .where(eq(siteGroups.id, input.id))
        .limit(1)
        .catch(() => []);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND' });

      const [memberCountRow] = await ctx.db
        .select({ value: count() })
        .from(siteGroupMembers)
        .where(eq(siteGroupMembers.siteGroupId, input.id))
        .catch(() => [{ value: 0 }]);

      return {
        ...group,
        memberCount: Number(memberCountRow?.value ?? 0)
      };
    }),

  members: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: sites.id,
          name: sites.name,
          description: sites.description,
          addedAt: siteGroupMembers.createdAt
        })
        .from(siteGroupMembers)
        .innerJoin(sites, eq(siteGroupMembers.siteId, sites.id))
        .where(eq(siteGroupMembers.siteGroupId, input.id))
        .orderBy(sites.name)
        .catch(() => []);
      return rows;
    }),

  forSite: authProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: siteGroups.id,
          name: siteGroups.name,
          description: siteGroups.description,
          addedAt: siteGroupMembers.createdAt
        })
        .from(siteGroupMembers)
        .innerJoin(siteGroups, eq(siteGroupMembers.siteGroupId, siteGroups.id))
        .where(eq(siteGroupMembers.siteId, input.siteId))
        .orderBy(siteGroups.name)
        .catch(() => []);
      return rows;
    }),

  recentActivity: authProcedure
    .input(z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: customerLogs.id,
          action: customerLogs.action,
          actionLabel: customerLogs.actionLabel,
          actorLabel: customerLogs.actorLabel,
          targetLabel: customerLogs.targetLabel,
          result: customerLogs.result,
          metadata: customerLogs.metadata,
          createdAt: customerLogs.createdAt
        })
        .from(customerLogs)
        .where(
          and(eq(customerLogs.targetType, 'site_group'), eq(customerLogs.targetId, input.id))
        )
        .orderBy(desc(customerLogs.createdAt))
        .limit(input.limit)
        .catch(() => []);
      return rows;
    }),

  create: authProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).optional().nullable()
      })
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx, 'Sites.Write');
      const [row] = await ctx.db
        .insert(siteGroups)
        .values({ name: input.name, description: input.description ?? null })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await auditGroupChange(ctx, {
        groupId: row.id,
        action: 'create',
        actionLabel: ActionLabels.SiteGroupCreate,
        targetLabel: row.name,
        metadata: { name: row.name, description: row.description }
      });

      return row;
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).optional().nullable()
      })
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx, 'Sites.Write');
      const [existing] = await ctx.db
        .select()
        .from(siteGroups)
        .where(eq(siteGroups.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      const nextDescription = input.description ?? null;
      if (existing.name === input.name && (existing.description ?? null) === nextDescription) {
        return existing;
      }

      const [row] = await ctx.db
        .update(siteGroups)
        .set({
          name: input.name,
          description: nextDescription,
          updatedAt: new Date().toISOString()
        })
        .where(eq(siteGroups.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      await auditGroupChange(ctx, {
        groupId: row.id,
        action: 'update',
        actionLabel: ActionLabels.SiteGroupUpdate,
        targetLabel: row.name,
        metadata: {
          previous: { name: existing.name, description: existing.description },
          next: { name: row.name, description: row.description }
        }
      });

      return row;
    }),

  delete: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx, 'Sites.Write');
      const [existing] = await ctx.db
        .select()
        .from(siteGroups)
        .where(eq(siteGroups.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      try {
        await ctx.db.delete(siteGroups).where(eq(siteGroups.id, input.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await auditGroupChange(ctx, {
          groupId: existing.id,
          action: 'delete',
          actionLabel: ActionLabels.SiteGroupDelete,
          targetLabel: existing.name,
          result: 'failure',
          errorMessage: message,
          metadata: { name: existing.name }
        });
        throw new TRPCError({ code: 'CONFLICT', message });
      }

      await auditGroupChange(ctx, {
        groupId: existing.id,
        action: 'delete',
        actionLabel: ActionLabels.SiteGroupDelete,
        targetLabel: existing.name,
        metadata: { name: existing.name, description: existing.description }
      });

      return { ok: true };
    }),

  addMember: authProcedure
    .input(z.object({ siteGroupId: z.string().uuid(), siteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx, 'Sites.Write');
      const [group] = await ctx.db
        .select({ id: siteGroups.id, name: siteGroups.name })
        .from(siteGroups)
        .where(eq(siteGroups.id, input.siteGroupId))
        .limit(1);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });

      const [site] = await ctx.db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(eq(sites.id, input.siteId))
        .limit(1);
      if (!site) throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });

      const result = await ctx.db
        .insert(siteGroupMembers)
        .values({ siteId: input.siteId, siteGroupId: input.siteGroupId })
        .onConflictDoNothing()
        .returning();

      if (!result.length) return { ok: true, changed: false };

      await auditGroupChange(ctx, {
        groupId: group.id,
        action: 'update',
        actionLabel: ActionLabels.SiteGroupMemberAdd,
        targetLabel: group.name,
        siteId: site.id,
        metadata: { siteId: site.id, siteName: site.name, groupName: group.name }
      });

      return { ok: true, changed: true };
    }),

  removeMember: authProcedure
    .input(z.object({ siteGroupId: z.string().uuid(), siteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx, 'Sites.Write');
      const [group] = await ctx.db
        .select({ id: siteGroups.id, name: siteGroups.name })
        .from(siteGroups)
        .where(eq(siteGroups.id, input.siteGroupId))
        .limit(1);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });

      const [site] = await ctx.db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(eq(sites.id, input.siteId))
        .limit(1);
      if (!site) throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });

      const removed = await ctx.db
        .delete(siteGroupMembers)
        .where(
          and(
            eq(siteGroupMembers.siteId, input.siteId),
            eq(siteGroupMembers.siteGroupId, input.siteGroupId)
          )
        )
        .returning();

      if (!removed.length) return { ok: true, changed: false };

      await auditGroupChange(ctx, {
        groupId: group.id,
        action: 'update',
        actionLabel: ActionLabels.SiteGroupMemberRemove,
        targetLabel: group.name,
        siteId: site.id,
        metadata: { siteId: site.id, siteName: site.name, groupName: group.name }
      });

      return { ok: true, changed: true };
    })
});
