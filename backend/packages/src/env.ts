import "dotenv/config";

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function stringList(name: string, fallback?: string): string[] {
  const value = process.env[name] ?? fallback;
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function runtimeEnvironment(): string {
  return (
    process.env.PACKAGE_ENV ??
    process.env.APP_ENV ??
    process.env.NODE_ENV ??
    "development"
  );
}

const RUNTIME_ENVIRONMENT = runtimeEnvironment();
const IS_PRODUCTION = RUNTIME_ENVIRONMENT === "production";

export const env = {
  RUNTIME_ENVIRONMENT,
  IS_PRODUCTION,
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  CATALOG_DATABASE_URL: process.env.CATALOG_DATABASE_URL,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  WORKER_CONCURRENCY: integer("PACKAGE_WORKER_CONCURRENCY", 3),
  WORKER_REFRESH_INTERVAL_MS: integer("PACKAGE_WORKER_REFRESH_INTERVAL_MS", 60_000),
  WORKER_LOCK_DURATION_MS: integer("PACKAGE_WORKER_LOCK_DURATION_MS", 5 * 60_000),
  TARGET_ORG_IDS: stringList("PACKAGE_ORG_IDS", process.env.PIPELINE_ORG_IDS),
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
};

export function requireEncryptionKey(): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set");
  return env.ENCRYPTION_KEY;
}
