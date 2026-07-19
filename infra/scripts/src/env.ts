import "dotenv/config";

export const env = {
  CATALOG_DATABASE_URL: process.env.CATALOG_DATABASE_URL,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

export function requireEncryptionKey(): string {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  return env.ENCRYPTION_KEY;
}
