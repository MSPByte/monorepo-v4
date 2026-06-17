export * from './catalog/schema.js';
export * from './clients.js';
import { getCatalogDb, getTenantServiceDbByOrgId, createTenantDb } from './tenant-factory.js';

export type TenantServiceDb = Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>['db'];
export { getCatalogDb, getTenantServiceDbByOrgId, createTenantDb };
