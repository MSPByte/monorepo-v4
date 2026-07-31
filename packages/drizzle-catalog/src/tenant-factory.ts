import { eq, type EmptyRelations } from 'drizzle-orm';
import { createCatalogDb } from './clients.js';
import { organization, type AuthOrganization } from './catalog/schema.js';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { Encryption } from './encryption.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let _catalogDb:
  | (NeonHttpDatabase<EmptyRelations> & {
      $client: NeonQueryFunction<false, false>;
    })
  | undefined = undefined;
const tenantDbs = new Map<string, ReturnType<typeof createTenantDb>>();

// Cache org rows for a short window so hot paths (per-job worker lookups,
// per-org scheduler passes) don't hit the catalog on every call. TTL is short
// enough that org edits (status flip, connection-string rotation) are picked
// up within a scheduler cycle.
const ORG_CACHE_TTL_MS = 60_000;
type OrgCacheEntry = { org: AuthOrganization; expiresAt: number };
const orgCache = new Map<string, OrgCacheEntry>();

export const getCatalogDb = (connectionString?: string) => {
  if (!_catalogDb) {
    _catalogDb = createCatalogDb(connectionString);
  }

  return _catalogDb;
};

export function createTenantDb(connection: string, encryptionKey: string) {
  const client = postgres(Encryption.decrypt(connection, encryptionKey) ?? '', {
    idle_timeout: 20,
    max: 10,
    connect_timeout: 10,
  });
  return drizzle({ client });
}

async function loadOrg(
  orgId: string,
  catalogConnection?: string
): Promise<AuthOrganization> {
  const cached = orgCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.org;

  const catalogDb = getCatalogDb(catalogConnection);
  const [org] = await catalogDb
    .select()
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!org) {
    orgCache.delete(orgId);
    throw new Error(`Org not found: ${orgId}`);
  }

  orgCache.set(orgId, { org, expiresAt: Date.now() + ORG_CACHE_TTL_MS });
  return org;
}

export function invalidateOrgCache(orgId?: string): void {
  if (orgId) orgCache.delete(orgId);
  else orgCache.clear();
}

// Service role. Request handlers may use this only after server-side auth, org membership,
// and tenant-user authorization have been verified.
export async function getTenantServiceDbByOrgId(
  orgId: string,
  encryptionKey: string,
  catalogConnection?: string
) {
  const org = await loadOrg(orgId, catalogConnection);

  const cacheKey = `${org.id}:${org.serviceConnectionString}`;
  let db = tenantDbs.get(cacheKey);
  if (!db) {
    db = createTenantDb(org.serviceConnectionString, encryptionKey);
    tenantDbs.set(cacheKey, db);
  }

  return {
    org,
    db
  };
}
