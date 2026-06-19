import { eq } from 'drizzle-orm';
import { users } from '@mspbyte/drizzle';
import type { organization } from '@mspbyte/drizzle-catalog/catalog';
import { t, authProcedure } from '../trpc.js';

type UserRow = typeof users.$inferSelect;
type OrgRow = typeof organization.$inferSelect;

export const authRouter = t.router({
  me: authProcedure.query(async ({ ctx }): Promise<{ user: UserRow | undefined; org: OrgRow }> => {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.authUserId, ctx.userId))
      .limit(1);
    return { user, org: ctx.org };
  })
});
