import { customerLogs, roles, userRoleGrants } from '@mspbyte/drizzle';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ActionLabels, normalizePermissions } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';

type RoleRow = typeof roles.$inferSelect;

const roleInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  level: z.number().int().min(0).max(100),
  permissions: z.array(z.string().min(1).max(200)).max(200)
});

function callerMaxLevel(ctx: Context): number {
  return ctx.role?.level ?? 0;
}

// Prevents privilege escalation: a caller with level N can only create or
// modify roles at level <= N. Global Admins (level 5) can do anything;
// Owners (level 100) can too.
function assertLevelWithinCaller(ctx: Context, level: number) {
  if (level > callerMaxLevel(ctx)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Cannot manage a role with a level higher than your own'
    });
  }
}

async function auditRoleChange(
  ctx: Context,
  input: {
    roleId: string;
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetLabel: string;
    metadata?: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: null,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: ctx.user.name || ctx.user.email,
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: 'role',
    targetId: input.roleId,
    targetLabel: input.targetLabel,
    result: 'success',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata ?? null
  });
}

export const rolesRouter = t.router({
  list: authProcedure.query(async ({ ctx }): Promise<RoleRow[]> => {
    return ctx.db.select().from(roles).orderBy(roles.level);
  }),

  // Returns the grant count for each role; used by the delete-confirm UI.
  grantCounts: authProcedure.query(async ({ ctx }): Promise<Record<string, number>> => {
    const rows = await ctx.db
      .select({ roleId: userRoleGrants.roleId, n: count() })
      .from(userRoleGrants)
      .groupBy(userRoleGrants.roleId);
    const map: Record<string, number> = {};
    for (const r of rows) map[r.roleId] = Number(r.n);
    return map;
  }),

  create: authProcedure
    .input(roleInputSchema)
    .mutation(async ({ ctx, input }): Promise<RoleRow> => {
      if (!ctx.can('Roles.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Roles.Write permission required' });
      }
      assertLevelWithinCaller(ctx, input.level);
      const permissions = normalizePermissions(input.permissions);

      const [existing] = await ctx.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, input.name))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A role with this name already exists' });
      }

      const [row] = await ctx.db
        .insert(roles)
        .values({
          name: input.name,
          description: input.description ?? null,
          level: input.level,
          permissions,
          isSystem: false
        })
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create role' });
      }

      await auditRoleChange(ctx, {
        roleId: row.id,
        action: 'create',
        actionLabel: ActionLabels.RoleCreate,
        targetLabel: row.name,
        metadata: { level: row.level, permissions: row.permissions }
      });

      return row;
    }),

  update: authProcedure
    .input(
      roleInputSchema.extend({
        id: z.uuid()
      })
    )
    .mutation(async ({ ctx, input }): Promise<RoleRow> => {
      if (!ctx.can('Roles.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Roles.Write permission required' });
      }

      const [existing] = await ctx.db.select().from(roles).where(eq(roles.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      }
      if (existing.isSystem) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'System roles cannot be edited' });
      }
      assertLevelWithinCaller(ctx, existing.level);
      assertLevelWithinCaller(ctx, input.level);
      const permissions = normalizePermissions(input.permissions);

      const [row] = await ctx.db
        .update(roles)
        .set({
          name: input.name,
          description: input.description ?? null,
          level: input.level,
          permissions,
          updatedAt: new Date().toISOString()
        })
        .where(eq(roles.id, input.id))
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update role' });
      }

      await auditRoleChange(ctx, {
        roleId: row.id,
        action: 'update',
        actionLabel: ActionLabels.RoleUpdate,
        targetLabel: row.name,
        metadata: {
          level: row.level,
          permissions: row.permissions,
          previousLevel: existing.level,
          previousPermissions: existing.permissions
        }
      });

      return row;
    }),

  delete: authProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    if (!ctx.can('Roles.Write')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Roles.Write permission required' });
    }

    const [existing] = await ctx.db.select().from(roles).where(eq(roles.id, input.id)).limit(1);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
    }
    if (existing.isSystem) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'System roles cannot be deleted' });
    }
    assertLevelWithinCaller(ctx, existing.level);

    const [grantCountRow] = await ctx.db
      .select({ n: count() })
      .from(userRoleGrants)
      .where(eq(userRoleGrants.roleId, input.id));
    const grantCount = Number(grantCountRow?.n ?? 0);
    if (grantCount > 0) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Cannot delete a role with ${grantCount} active grant${grantCount === 1 ? '' : 's'}. Remove the grants first.`
      });
    }

    await ctx.db.delete(roles).where(eq(roles.id, input.id));

    await auditRoleChange(ctx, {
      roleId: existing.id,
      action: 'delete',
      actionLabel: ActionLabels.RoleDelete,
      targetLabel: existing.name,
      metadata: { level: existing.level, permissions: existing.permissions }
    });

    return { success: true };
  })
});
