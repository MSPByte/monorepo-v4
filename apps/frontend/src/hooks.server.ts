import { building } from '$app/environment';
import { redirect, type Handle } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { roles, users } from '@mspbyte/drizzle';
import {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  CATALOG_DATABASE_URL,
  ENCRYPTION_KEY,
} from '$env/static/private';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_DEV_ORG } from '$env/static/public';

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

    if (!user || !user.roleId) {
      throw { message: 'User not found', state: 'invalid' };
    }

    const [role] = await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1);
    if (!role) {
      throw { message: 'Role not found', state: 'invalid' };
    }

    event.locals.auth = {
      userId: session.user.id,
      orgId: org.id,
      email: session.user.email,
    };
    event.locals.user = user;
    event.locals.role = role;
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
