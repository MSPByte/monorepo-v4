import { appRouter, type EffectiveScope } from '@mspbyte/trpc';
import { createTenantDb, getCatalogDb, type organization } from '@mspbyte/drizzle-catalog';
import type { db } from '$lib/db';
import { ENCRYPTION_KEY, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from '$env/static/private';
import { env } from '$env/dynamic/private';
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
    scopeFor: (p: Permission): EffectiveScope => computeScopeFor(grants, p),
    groupScopeFor: (p: Permission): EffectiveScope => computeGroupScopeFor(grants, p),
    linkScopeFor: (_p: Permission): EffectiveScope => [],
    connectionString: locals.connectionString,
    encryptionKey: ENCRYPTION_KEY,
    agentsInternalUrl: env.AGENTS_INTERNAL_URL ?? null,
    agentsInternalSecret: env.AGENTS_INTERNAL_SECRET ?? null,
    ipAddress: null,
    userAgent: null,
    microsoftCredentials:
      MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET
        ? {
            clientId: MICROSOFT_CLIENT_ID,
            clientSecret: MICROSOFT_CLIENT_SECRET,
          }
        : null,
    catalogDb: getCatalogDb(),
    redis: getRedis(),
  });
}

function computeScopeFor(grants: PermissionGrant[], permission: Permission): EffectiveScope {
  const satisfying = grants.filter((g) => hasPermission([g], permission));
  if (satisfying.length === 0) return [];
  if (satisfying.some((g) => g.scope.kind === 'all')) return 'all';
  const sites = new Set<string>();
  for (const g of satisfying) {
    if (g.scope.kind === 'sites') for (const id of g.scope.ids) sites.add(id);
  }
  return [...sites];
}

function computeGroupScopeFor(grants: PermissionGrant[], permission: Permission): EffectiveScope {
  const satisfying = grants.filter((g) => hasPermission([g], permission));
  if (satisfying.length === 0) return [];
  if (satisfying.some((g) => g.scope.kind === 'all')) return 'all';
  const groups = new Set<string>();
  for (const g of satisfying) {
    if (g.scope.kind === 'groups') for (const id of g.scope.ids) groups.add(id);
  }
  return [...groups];
}
