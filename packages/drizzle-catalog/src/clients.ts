import { drizzle } from 'drizzle-orm/neon-http';

export function createCatalogDb(connectionString?: string) {
  const url = connectionString ?? process.env.CATALOG_DATABASE_URL;
  if (!url) throw new Error('CATALOG_DATABASE_URL is not set');
  return drizzle(url);
}

export type CatalogDb = ReturnType<typeof createCatalogDb>;
