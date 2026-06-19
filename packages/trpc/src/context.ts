import { TRPCError } from '@trpc/server';
import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { roles, users } from '@mspbyte/drizzle';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
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

  return {
    userId,
    orgId: org.id,
    db,
    org,
    user: tenantUser,
    role,
    connectionString: org.serviceConnectionString,
    ipAddress:
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null,
    userAgent: headers.get('user-agent') ?? null,
    redis
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
