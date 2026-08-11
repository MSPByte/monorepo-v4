import { building, dev } from '$app/environment';
import { redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { PUBLIC_DEV_ORG } from '$env/static/public';
import { eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { roles, users, userRoleGrants } from '@mspbyte/drizzle';
import type { PermissionGrant, Scope } from '@mspbyte/shared';
import {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  CATALOG_DATABASE_URL,
  ENCRYPTION_KEY,
} from '$env/static/private';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { sequence } from '@sveltejs/kit/hooks';

const isPublicRoute = (route: string): boolean => {
  return route.startsWith('/auth') || route.startsWith('/api/auth') || route === '/';
};

const handleAuth: Handle = async ({ event, resolve }) => {
  if (!building && (!BETTER_AUTH_SECRET || !BETTER_AUTH_URL)) {
    throw new Error('BETTER_AUTH_SECRET and BETTER_AUTH_URL are required');
  }

  if (isPublicRoute(event.url.pathname)) {
    return svelteKitHandler({ event, resolve, auth, building });
  }

  if (await applyLocalDevAuth(event)) {
    return svelteKitHandler({ event, resolve, auth, building });
  }

  try {
    const session = await auth.api.getSession({
      headers: event.request.headers,
    });

    if (!session) {
      throw { message: 'Failed to get session', state: 'no_session' };
    }

    let authOrgId = session.session.activeOrganizationId;
    if (!authOrgId) {
      const organizations = await auth.api
        .listOrganizations({ headers: event.request.headers })
        .catch(() => []);
      if (organizations.length === 1) {
        authOrgId = organizations[0]!.id;
        await auth.api
          .setActiveOrganization({
            headers: event.request.headers,
            body: { organizationId: authOrgId },
          })
          .catch(() => null);
      } else {
        throw { message: 'Choose organization', state: 'select_org' };
      }
    }

    if (!authOrgId) {
      throw { message: 'No active organization', state: 'invalid' };
    }

    const result = await getTenantServiceDbByOrgId(authOrgId, ENCRYPTION_KEY, CATALOG_DATABASE_URL);
    if (!result) {
      throw { message: 'Org not found', state: 'invalid' };
    }

    const { org, db } = result;
    if (org.status !== 'active') {
      throw { message: 'Org is not active', state: 'invalid' };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.authUserId, session.user.id))
      .limit(1);

    if (!user) {
      throw { message: 'User not found', state: 'invalid' };
    }

    const { grants, primaryRole } = await loadGrants(db, user.id);
    if (grants.length === 0 || !primaryRole) {
      throw { message: 'No role grants', state: 'invalid' };
    }

    event.locals.auth = {
      userId: session.user.id,
      orgId: org.id,
      email: session.user.email,
    };
    event.locals.user = user;
    event.locals.role = primaryRole;
    event.locals.grants = grants;
    event.locals.org = org;
    event.locals.connectionString = org.serviceConnectionString;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err);
    const state = (err as { state?: string })?.state;
    console.error(`HOOK_ERR: ${message}`);

    if (state === 'invalid') {
      await auth.api.signOut({ headers: event.request.headers }).catch(() => null);
      return redirect(302, '/auth/login?error=account');
    } else if (state === 'select_org') {
      return redirect(302, '/auth/organization');
    }

    return redirect(302, '/auth/login');
  }

  return svelteKitHandler({ event, resolve, auth, building });
};

const handleDev: Handle = async ({ event, resolve }) => {
  return svelteKitHandler({ event, resolve, auth, building });
};

export const handle = sequence(handleAuth, handleDev);

/**
 * Enables browser testing against local development data without a social-login flow.
 * It is deliberately unavailable outside a Vite dev build, off loopback hosts, or
 * unless explicitly enabled in the local environment.
 */
async function applyLocalDevAuth(event: RequestEvent): Promise<boolean> {
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const enabled = env.LOCAL_DEV_AUTH_BYPASS === 'true';
  const orgId = PUBLIC_DEV_ORG;
  if (!dev || !enabled || !orgId || !loopbackHosts.has(event.url.hostname)) return false;

  const result = await getTenantServiceDbByOrgId(orgId, ENCRYPTION_KEY, CATALOG_DATABASE_URL);
  if (!result?.org.isDev || result.org.status !== 'active') {
    throw new Error('LOCAL_DEV_AUTH_BYPASS requires an active development organization');
  }

  const [user] = await result.db.select().from(users).limit(1);
  if (!user) throw new Error('LOCAL_DEV_AUTH_BYPASS requires a user in the development organization');

  const { grants, primaryRole } = await loadGrants(result.db, user.id);
  if (!primaryRole || grants.length === 0) {
    throw new Error('LOCAL_DEV_AUTH_BYPASS requires a user with role grants');
  }

  event.locals.auth = { userId: user.authUserId, orgId: result.org.id, email: user.email };
  event.locals.user = user;
  event.locals.role = primaryRole;
  event.locals.grants = grants;
  event.locals.org = result.org;
  event.locals.connectionString = result.org.serviceConnectionString;
  return true;
}

async function loadGrants(
  db: Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>['db'],
  tenantUserId: string,
): Promise<{ grants: PermissionGrant[]; primaryRole: typeof roles.$inferSelect | null }> {
  const rows = await db
    .select({
      permissions: roles.permissions,
      scopeKind: userRoleGrants.scopeKind,
      scopeIds: userRoleGrants.scopeIds,
      role: roles,
    })
    .from(userRoleGrants)
    .innerJoin(roles, eq(userRoleGrants.roleId, roles.id))
    .where(eq(userRoleGrants.userId, tenantUserId));

  const grants = rows.map(
    (r): PermissionGrant => ({
      permissions: r.permissions ?? [],
      scope: toScope(r.scopeKind, r.scopeIds),
    }),
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
