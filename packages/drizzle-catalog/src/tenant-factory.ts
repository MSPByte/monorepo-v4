import { eq, type EmptyRelations } from 'drizzle-orm';
import { createCatalogDb } from './clients.js';
import { organization } from './catalog/schema.js';
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

export const getCatalogDb = (connectionString?: string) => {
  if (!_catalogDb) {
    _catalogDb = createCatalogDb(connectionString);
  }

  return _catalogDb;
};

export function createTenantDb(connection: string, encryptionKey: string) {
  const client = postgres(Encryption.decrypt(connection, encryptionKey) ?? '', {
    idle_timeout: 20,
    max: 3,
    connect_timeout: 10,
  });
  return drizzle({ client });
}

// Service role. Request handlers may use this only after server-side auth, org membership,
// and tenant-user authorization have been verified.
export async function getTenantServiceDbByOrgId(
  orgId: string,
  encryptionKey: string,
  catalogConnection?: string
) {
  const catalogDb = getCatalogDb(catalogConnection);

  const [org] = await catalogDb
    .select()
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!org) throw new Error(`Org not found: ${orgId}`);

  return {
    org,
    db: createTenantDb(org.serviceConnectionString, encryptionKey)
  };
}
