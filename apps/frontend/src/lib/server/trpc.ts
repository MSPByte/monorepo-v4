import { appRouter } from '@mspbyte/trpc';
import { createTenantDb, type organization } from '@mspbyte/drizzle-catalog';
import type { db } from '$lib/db';
import { ENCRYPTION_KEY } from '$env/static/private';

export function createServerCaller(locals: {
  auth: {
    userId: string;
    orgId: string;
    email: string;
  };
  org: typeof organization.$inferSelect;
  user?: db.User;
  role?: db.Role;
  connectionString: string;
}) {
  const db = createTenantDb(locals.connectionString, ENCRYPTION_KEY);
  return appRouter.createCaller({
    userId: locals.auth.userId,
    orgId: locals.auth.orgId,
    db: db as never,
    org: locals.org,
    user: locals.user as never,
    role: locals.role as never,
    connectionString: locals.connectionString,
    ipAddress: null,
    userAgent: null,
    redis: undefined,
  });
}
