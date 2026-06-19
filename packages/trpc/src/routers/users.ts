import { users, roles } from '@mspbyte/drizzle';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { hasPermission } from '@mspbyte/shared';
import {
  getCatalogDb,
  user as catalogUser,
  member as catalogMember
} from '@mspbyte/drizzle-catalog';

export type UserWithRole = typeof users.$inferSelect & { role: typeof roles.$inferSelect | null };

export const usersRouter = t.router({
  list: authProcedure.query(async ({ ctx }): Promise<UserWithRole[]> => {
    const rows = await ctx.db
      .select()
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .orderBy(users.name);
    return rows.map((r) => ({ ...r.users, role: r.roles ?? null }));
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
      const attrs = (ctx.role.attributes as Record<string, boolean>) ?? null;
      if (!hasPermission(attrs, 'Users.Write')) {
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
          email: input.email,
          roleId: input.roleId
        })
        .returning();

      if (!tenantUser) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create user' });
      }

      const [role] = await ctx.db.select().from(roles).where(eq(roles.id, input.roleId)).limit(1);

      return { ...tenantUser, role: role ?? null };
    }),

  delete: authProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const attrs = (ctx.role.attributes as Record<string, boolean>) ?? null;
      if (!hasPermission(attrs, 'Users.Delete')) {
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
