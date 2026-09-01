import { QueryClient } from '@tanstack/svelte-query';

export const STALE = {
  /** Short-lived data that changes during a user session (e.g. live counts, status). */
  SHORT: 3_000,
  /** Entity detail pages — fresh enough to catch background updates. */
  ENTITY: 15_000,
  /** List queries where stale items are tolerable for ~30 s. */
  LIST: 30_000,
  /** Data that rarely changes within a session (e.g. site list, finding list). */
  PAGE: 60_000,
  /** Reference/catalog data that almost never changes (e.g. integrations, frameworks). */
  REF: 5 * 60_000,
  /** Dashboard tiles — long TTL, manually refreshed. */
  DASHBOARD: 5 * 60_000,
} as const;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.LIST,
        refetchOnWindowFocus: true,
      },
    },
  });
}
