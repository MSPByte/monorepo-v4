import { getTenantServiceDbByOrgId } from '@mspbyte/drizzle-catalog';
import { env } from './env.js';

let cached: Awaited<ReturnType<typeof getTenantServiceDbByOrgId>> | null = null;

export async function getTenantDb() {
  if (!cached) {
    cached = await getTenantServiceDbByOrgId(env.ORG_ID, env.ENCRYPTION_KEY);
  }
  return cached.db;
}
