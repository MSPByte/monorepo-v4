import { roles } from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';

type RoleRow = typeof roles.$inferSelect;

export const rolesRouter = t.router({
  list: authProcedure.query(async ({ ctx }): Promise<RoleRow[]> => {
    return ctx.db.select().from(roles).orderBy(roles.level);
  }),
});
