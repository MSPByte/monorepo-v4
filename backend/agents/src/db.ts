import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { env } from './env.js';

const cache = new Map<string, Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>>();

export async function getTenantDbForOrg(orgId: string) {
  let entry = cache.get(orgId);
  if (!entry) {
    entry = await getTenantServiceDbByOrgId(orgId, env.ENCRYPTION_KEY);
    cache.set(orgId, entry);
  }
  return entry.db;
}

/** Legacy wrapper for v1.0 routes — requires ORG_ID env var. */
export async function getTenantDb() {
  if (!env.ORG_ID) throw new Error('ORG_ID not configured for legacy routes');
  return getTenantDbForOrg(env.ORG_ID);
}
