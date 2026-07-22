import { appRouter } from '@mspbyte/trpc';
import { createTenantDb, type organization } from '@mspbyte/drizzle-catalog';
import type { db } from '$lib/db';
import { ENCRYPTION_KEY, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from '$env/static/private';
import {
  hasPermission,
  hasAnyPermissionUnder,
  type Permission,
  type PermissionGrant,
} from '@mspbyte/shared';
import { getRedis } from './redis';

export function createServerCaller(locals: {
  auth: {
    userId: string;
    orgId: string;
    email: string;
  };
  org: typeof organization.$inferSelect;
  user?: db.User;
  role?: db.Role;
  grants?: PermissionGrant[];
  connectionString: string;
}) {
  const db = createTenantDb(locals.connectionString, ENCRYPTION_KEY);
  const grants = locals.grants ?? [];
  return appRouter.createCaller({
    userId: locals.auth.userId,
    orgId: locals.auth.orgId,
    db: db as never,
    org: locals.org,
    user: locals.user as never,
    role: locals.role as never,
    grants,
    can: (p: Permission) => hasPermission(grants, p),
    canUnder: (prefix: string) => hasAnyPermissionUnder(grants, prefix),
    connectionString: locals.connectionString,
    encryptionKey: ENCRYPTION_KEY,
    ipAddress: null,
    userAgent: null,
    microsoftCredentials:
      MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET
        ? {
            clientId: MICROSOFT_CLIENT_ID,
            clientSecret: MICROSOFT_CLIENT_SECRET,
          }
        : null,
    redis: getRedis(),
  });
}
