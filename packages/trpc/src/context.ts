import { TRPCError } from '@trpc/server';
import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { roles, users, userRoleGrants } from '@mspbyte/drizzle';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import {
  hasPermission,
  hasAnyPermissionUnder,
  type Permission,
  type PermissionGrant,
  type Scope
} from '@mspbyte/shared';
import { auth } from './auth.js';

type TenantDb = Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>['db'];

// Generic enough for both Fastify and other HTTP frameworks
interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
}

function toHeaders(headers: IncomingRequest['headers']) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (value !== undefined) {
      result.set(key, value);
    }
  }
  return result;
}

export async function createContext({ req, redis }: { req: IncomingRequest; redis?: Redis }) {
  if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Better Auth is not configured'
    });
  }

  if (!process.env.ENCRYPTION_KEY) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Encryption Key is not configured'
    });
  }

  const headers = toHeaders(req.headers);
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or missing session' });
  }

  const userId = session.user.id;
  let authOrgId = session.session.activeOrganizationId;

  if (!authOrgId) {
    const organizations = await auth.api.listOrganizations({ headers }).catch(() => []);
    if (organizations.length === 1) {
      authOrgId = organizations[0]!.id;
      await auth.api
        .setActiveOrganization({ headers, body: { organizationId: authOrgId } })
        .catch(() => null);
    }
  }

  if (!authOrgId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No active organization in session' });
  }

  const result = await getTenantServiceDbByOrgId(authOrgId, process.env.ENCRYPTION_KEY).catch(
    () => null
  );
  if (!result) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Organization not provisioned - contact support'
    });
  }

  const { org, db } = result;
  if (org.status !== 'active') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Organization is not active' });
  }

  const [tenantUser] = await db.select().from(users).where(eq(users.authUserId, userId)).limit(1);
  if (!tenantUser) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User is not provisioned for this organization'
    });
  }

  const { grants, primaryRole } = await loadGrants(db, tenantUser.id);
  if (grants.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User has no role grants in this organization'
    });
  }

  return {
    userId,
    orgId: org.id,
    db,
    org,
    user: tenantUser,
    role: primaryRole,
    grants,
    can: (permission: Permission) => hasPermission(grants, permission),
    canUnder: (prefix: string) => hasAnyPermissionUnder(grants, prefix),
    scopeFor: (permission: Permission) => scopeFor(grants, permission),
    connectionString: org.serviceConnectionString,
    encryptionKey: process.env.ENCRYPTION_KEY,
    ipAddress:
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null,
    userAgent: headers.get('user-agent') ?? null,
    microsoftCredentials:
      process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
        ? {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET
          }
        : null,
    redis
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/**
 * Loads all grants for a tenant user (join user_role_grants → roles). Also
 * returns the highest-level role from those grants as `primaryRole`, used
 * only for display (nav badge, "logged in as" chips) — real authorization
 * derives from `grants` and the evaluator.
 */
async function loadGrants(
  db: TenantDb,
  tenantUserId: string
): Promise<{ grants: PermissionGrant[]; primaryRole: typeof roles.$inferSelect | null }> {
  const rows = await db
    .select({
      permissions: roles.permissions,
      scopeKind: userRoleGrants.scopeKind,
      scopeIds: userRoleGrants.scopeIds,
      role: roles
    })
    .from(userRoleGrants)
    .innerJoin(roles, eq(userRoleGrants.roleId, roles.id))
    .where(eq(userRoleGrants.userId, tenantUserId));

  const grants = rows.map(
    (r): PermissionGrant => ({
      permissions: r.permissions ?? [],
      scope: toScope(r.scopeKind, r.scopeIds)
    })
  );

  let primaryRole: typeof roles.$inferSelect | null = null;
  for (const r of rows) {
    if (!primaryRole || r.role.level > primaryRole.level) primaryRole = r.role;
  }

  return { grants, primaryRole };
}

function toScope(kind: string | null, ids: string[] | null): Scope {
  if (kind === 'sites') return { kind: 'sites', ids: ids ?? [] };
  if (kind === 'groups') return { kind: 'groups', ids: ids ?? [] };
  return { kind: 'all' };
}

export type EffectiveScope = 'all' | readonly string[];

/**
 * Computes the effective site scope for a specific permission. Only grants
 * that actually satisfy the permission contribute their scope — a user with
 * `Assets.Read at sites [A,B]` + `Users.Read at all` gets `[A,B]` for
 * Assets.Read but `'all'` for Users.Read.
 *
 * Returns:
 *   - 'all' if any satisfying grant is unscoped → no WHERE filter needed.
 *   - readonly string[] of site IDs otherwise (empty = user cannot see any
 *     site-attached record for this permission → short-circuit to empty list).
 *
 * Groups-scope grants are treated as empty in Stage 4c (no site expansion).
 * Phase 2 wires site_group_members lookup here.
 */
function scopeFor(grants: PermissionGrant[], permission: Permission): EffectiveScope {
  const satisfying = grants.filter((g) => hasPermission([g], permission));
  if (satisfying.length === 0) return [];
  if (satisfying.some((g) => g.scope.kind === 'all')) return 'all';
  const sites = new Set<string>();
  for (const g of satisfying) {
    if (g.scope.kind === 'sites') {
      for (const id of g.scope.ids) sites.add(id);
    }
    // g.scope.kind === 'groups' — Phase 2
  }
  return [...sites];
}
