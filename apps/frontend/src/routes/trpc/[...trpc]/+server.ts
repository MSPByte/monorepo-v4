import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@mspbyte/trpc';
import { createTenantDb } from '@mspbyte/drizzle-catalog';
import { ENCRYPTION_KEY, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from '$env/static/private';
import type { RequestHandler } from './$types';

const handler: RequestHandler = async (event) => {
  const db = createTenantDb(event.locals.connectionString, ENCRYPTION_KEY);

  return fetchRequestHandler({
    endpoint: '/trpc',
    req: event.request,
    router: appRouter,
    createContext: () => ({
      userId: event.locals.auth.userId,
      orgId: event.locals.auth.orgId,
      db: db as never,
      org: event.locals.org,
      user: event.locals.user as never,
      role: event.locals.role as never,
      connectionString: event.locals.connectionString,
      ipAddress: event.getClientAddress(),
      userAgent: event.request.headers.get('user-agent'),
      microsoftCredentials:
        MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET
          ? {
              clientId: MICROSOFT_CLIENT_ID,
              clientSecret: MICROSOFT_CLIENT_SECRET,
            }
          : null,
      redis: undefined,
    }),
  });
};

export const GET = handler;
export const POST = handler;
