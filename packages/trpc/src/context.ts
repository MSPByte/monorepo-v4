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
  if (!tenantUser?.roleId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User is not provisioned for this organization'
    });
  }

  const [role] = await db.select().from(roles).where(eq(roles.id, tenantUser.roleId)).limit(1);
  if (!role) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User role is not provisioned' });
  }

  const grants = await loadGrants(db, tenantUser.id, role);

  return {
    userId,
    orgId: org.id,
    db,
    org,
    user: tenantUser,
    role,
    grants,
    can: (permission: Permission) => hasPermission(grants, permission),
    canUnder: (prefix: string) => hasAnyPermissionUnder(grants, prefix),
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
 * Resolves the caller's PermissionGrant[]. Prefers rows from user_role_grants
 * (Stage 2+). Falls back to synthesizing a single grant from the legacy
 * user.role_id → role.attributes path if grants is empty — this keeps Stage 4a
 * non-breaking for any tenant not yet fully migrated. Stage 4d removes the
 * fallback and drops the legacy columns.
 */
async function loadGrants(
  db: Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>['db'],
  tenantUserId: string,
  role: { permissions: string[] | null; attributes: unknown }
): Promise<PermissionGrant[]> {
  const rows = await db
    .select({
      permissions: roles.permissions,
      scopeKind: userRoleGrants.scopeKind,
      scopeIds: userRoleGrants.scopeIds
    })
    .from(userRoleGrants)
    .innerJoin(roles, eq(userRoleGrants.roleId, roles.id))
    .where(eq(userRoleGrants.userId, tenantUserId));

  if (rows.length > 0) {
    return rows.map(
      (r): PermissionGrant => ({
        permissions: r.permissions ?? [],
        scope: toScope(r.scopeKind, r.scopeIds)
      })
    );
  }

  // Legacy fallback — synthesize one 'all'-scoped grant from role.permissions
  // (already populated by Stage 2 migration) or from the raw attributes bag.
  if (role.permissions && role.permissions.length > 0) {
    return [{ permissions: role.permissions, scope: { kind: 'all' } }];
  }

  const attrs = (role.attributes as Record<string, boolean> | null) ?? {};
  const legacyPerms = Object.entries(attrs)
    .filter(([, v]) => v === true)
    .map(([k]) => (k === 'Global.Admin' || k === '*' ? '*' : k));
  return [{ permissions: legacyPerms, scope: { kind: 'all' } }];
}

function toScope(kind: string | null, ids: string[] | null): Scope {
  if (kind === 'sites') return { kind: 'sites', ids: ids ?? [] };
  if (kind === 'groups') return { kind: 'groups', ids: ids ?? [] };
  return { kind: 'all' };
}
