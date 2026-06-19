import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@mspbyte/trpc';

// CRITICAL: AppRouter is imported as a type only — no server-side implementation
// is bundled into the client. Never change this to a runtime import.

export function createTrpcClient(getToken?: () => Promise<string | null>) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: '/trpc',
        headers: async () => {
          const token = getToken ? await getToken() : null;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: 'include',
          });
        },
      }),
    ],
  });
}
