import { customerLogs, users, roles, userRoleGrants } from '@mspbyte/drizzle';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ActionLabels } from '@mspbyte/shared';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';
import {
  getCatalogDb,
  user as catalogUser,
  member as catalogMember
} from '@mspbyte/drizzle-catalog';

export type UserWithRole = typeof users.$inferSelect & {
  role: typeof roles.$inferSelect | null;
};

export type UserGrant = typeof userRoleGrants.$inferSelect & {
  role: typeof roles.$inferSelect;
};

const scopeInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('sites'), ids: z.array(z.uuid()).min(1).max(500) })
  // groups scope shape defined but no UI ships in Phase 1
]);

async function auditGrantChange(
  ctx: Context,
  input: {
    userId: string;
    roleId: string;
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetLabel: string;
    metadata: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: null,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: ctx.user.name || ctx.user.email,
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: 'user_role_grant',
    targetId: `${input.userId}:${input.roleId}`,
    targetLabel: input.targetLabel,
    result: 'success',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata
  });
}

// Returns the highest-level role granted to each user for display in the
// users list. Multi-grant management ships in Stage 6.
async function loadUsersWithPrimaryRole(db: any): Promise<UserWithRole[]> {
  const rows = await db
    .select({
      user: users,
      role: roles,
      level: roles.level
    })
    .from(users)
    .leftJoin(userRoleGrants, eq(userRoleGrants.userId, users.id))
    .leftJoin(roles, eq(userRoleGrants.roleId, roles.id))
    .orderBy(users.name, desc(roles.level));

  const seen = new Set<string>();
  const result: UserWithRole[] = [];
  for (const r of rows) {
    if (seen.has(r.user.id)) continue;
    seen.add(r.user.id);
    result.push({ ...r.user, role: r.role ?? null });
  }
  return result;
}

export const usersRouter = t.router({
  list: authProcedure.query(async ({ ctx }): Promise<UserWithRole[]> => {
    return loadUsersWithPrimaryRole(ctx.db);
  }),

  create: authProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.email(),
        roleId: z.uuid()
      })
    )
    .mutation(async ({ ctx, input }): Promise<UserWithRole> => {
      if (!ctx.can('Users.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Users.Write permission required' });
      }

      const [existingTenantUser] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existingTenantUser) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A user with this email already exists' });
      }

      const catalogDb = getCatalogDb();

      let [authUser] = await catalogDb
        .select()
        .from(catalogUser)
        .where(eq(catalogUser.email, input.email))
        .limit(1);

      if (!authUser) {
        [authUser] = await catalogDb
          .insert(catalogUser)
          .values({
            id: crypto.randomUUID(),
            name: input.name,
            email: input.email,
            emailVerified: true
          })
          .returning();
      }

      const [existingMember] = await catalogDb
        .select()
        .from(catalogMember)
        .where(
          and(eq(catalogMember.userId, authUser!.id), eq(catalogMember.organizationId, ctx.orgId))
        )
        .limit(1);

      if (!existingMember) {
        await catalogDb.insert(catalogMember).values({
          id: crypto.randomUUID(),
          organizationId: ctx.orgId,
          userId: authUser!.id,
          role: 'member'
        });
      }

      const [tenantUser] = await ctx.db
        .insert(users)
        .values({
          authUserId: authUser!.id,
          name: input.name,
          email: input.email
        })
        .returning();

      if (!tenantUser) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create user' });
      }

      const [role] = await ctx.db.select().from(roles).where(eq(roles.id, input.roleId)).limit(1);
      if (!role) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      }

      await ctx.db.insert(userRoleGrants).values({
        userId: tenantUser.id,
        roleId: input.roleId,
        scopeKind: 'all',
        scopeIds: []
      });

      return { ...tenantUser, role };
    }),

  listGrants: authProcedure
    .input(z.object({ userId: z.uuid() }))
    .query(async ({ ctx, input }): Promise<UserGrant[]> => {
      const rows = await ctx.db
        .select({ grant: userRoleGrants, role: roles })
        .from(userRoleGrants)
        .innerJoin(roles, eq(userRoleGrants.roleId, roles.id))
        .where(eq(userRoleGrants.userId, input.userId))
        .orderBy(desc(roles.level));
      return rows.map((r) => ({ ...r.grant, role: r.role }));
    }),

  addGrant: authProcedure
    .input(
      z.object({
        userId: z.uuid(),
        roleId: z.uuid(),
        scope: scopeInputSchema
      })
    )
    .mutation(async ({ ctx, input }): Promise<UserGrant> => {
      if (!ctx.can('Users.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Users.Write permission required' });
      }

      const [targetUser] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const [role] = await ctx.db
        .select()
        .from(roles)
        .where(eq(roles.id, input.roleId))
        .limit(1);
      if (!role) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      }
      // Escalation guard — cannot grant a role above the caller's own level.
      if (role.level > (ctx.role?.level ?? 0)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot grant a role above your own level'
        });
      }

      const scopeIds = input.scope.kind === 'sites' ? input.scope.ids : [];
      const [grant] = await ctx.db
        .insert(userRoleGrants)
        .values({
          userId: input.userId,
          roleId: input.roleId,
          scopeKind: input.scope.kind,
          scopeIds
        })
        .onConflictDoNothing({ target: userRoleGrants.id })
        .returning();

      if (!grant) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Grant already exists' });
      }

      await auditGrantChange(ctx, {
        userId: input.userId,
        roleId: input.roleId,
        action: 'create',
        actionLabel: ActionLabels.UserGrantAdd,
        targetLabel: `${targetUser.email} → ${role.name}`,
        metadata: { scope: input.scope, roleLevel: role.level }
      });

      return { ...grant, role };
    }),

  updateGrantScope: authProcedure
    .input(
      z.object({
        grantId: z.uuid(),
        scope: scopeInputSchema
      })
    )
    .mutation(async ({ ctx, input }): Promise<UserGrant> => {
      if (!ctx.can('Users.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Users.Write permission required' });
      }

      const [existing] = await ctx.db
        .select({ grant: userRoleGrants, role: roles, user: users })
        .from(userRoleGrants)
        .innerJoin(roles, eq(userRoleGrants.roleId, roles.id))
        .innerJoin(users, eq(userRoleGrants.userId, users.id))
        .where(eq(userRoleGrants.id, input.grantId))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Grant not found' });
      }
      if (existing.role.level > (ctx.role?.level ?? 0)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot modify a grant whose role level exceeds your own'
        });
      }

      const scopeIds = input.scope.kind === 'sites' ? input.scope.ids : [];
      const [row] = await ctx.db
        .update(userRoleGrants)
        .set({
          scopeKind: input.scope.kind,
          scopeIds,
          updatedAt: new Date().toISOString()
        })
        .where(eq(userRoleGrants.id, input.grantId))
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update grant' });
      }

      await auditGrantChange(ctx, {
        userId: existing.user.id,
        roleId: existing.role.id,
        action: 'update',
        actionLabel: ActionLabels.UserGrantAdd,
        targetLabel: `${existing.user.email} → ${existing.role.name}`,
        metadata: {
          scope: input.scope,
          previousScope: { kind: existing.grant.scopeKind, ids: existing.grant.scopeIds }
        }
      });

      return { ...row, role: existing.role };
    }),

  removeGrant: authProcedure
    .input(z.object({ grantId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Users.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Users.Write permission required' });
      }

      const [existing] = await ctx.db
        .select({ grant: userRoleGrants, role: roles, user: users })
        .from(userRoleGrants)
        .innerJoin(roles, eq(userRoleGrants.roleId, roles.id))
        .innerJoin(users, eq(userRoleGrants.userId, users.id))
        .where(eq(userRoleGrants.id, input.grantId))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Grant not found' });
      }
      // Cannot revoke a grant whose role level exceeds the caller's — same
      // escalation guard applied inversely.
      if (existing.role.level > (ctx.role?.level ?? 0)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot revoke a grant whose role level exceeds your own'
        });
      }
      // Guardrail against locking yourself out: if this is the caller's only
      // grant, refuse.
      if (existing.user.authUserId === ctx.userId) {
        const remainingGrants = await ctx.db
          .select({ id: userRoleGrants.id })
          .from(userRoleGrants)
          .where(eq(userRoleGrants.userId, existing.user.id));
        if (remainingGrants.length <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot remove your own only remaining grant'
          });
        }
      }

      await ctx.db.delete(userRoleGrants).where(eq(userRoleGrants.id, input.grantId));

      await auditGrantChange(ctx, {
        userId: existing.user.id,
        roleId: existing.role.id,
        action: 'delete',
        actionLabel: ActionLabels.UserGrantRemove,
        targetLabel: `${existing.user.email} ⇐ ${existing.role.name}`,
        metadata: {
          scope: { kind: existing.grant.scopeKind, ids: existing.grant.scopeIds },
          roleLevel: existing.role.level
        }
      });

      return { success: true };
    }),

  delete: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Users.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Users.Delete permission required' });
      }

      const [tenantUser] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.id, input.id))
        .limit(1);

      if (!tenantUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      if (tenantUser.authUserId === ctx.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete yourself' });
      }

      await ctx.db.delete(users).where(eq(users.id, input.id));

      const catalogDb = getCatalogDb();
      await catalogDb
        .delete(catalogMember)
        .where(
          and(
            eq(catalogMember.userId, tenantUser.authUserId),
            eq(catalogMember.organizationId, ctx.orgId)
          )
        );

      return { success: true };
    })
});
