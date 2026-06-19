import "dotenv/config";

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function runtimeEnvironment(): string {
  return (
    process.env.POLICY_ENV ??
    process.env.NORMALIZE_ENV ??
    process.env.PROJECTION_ENV ??
    process.env.INGESTION_ENV ??
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
  WORKER_CONCURRENCY: integer("POLICY_WORKER_CONCURRENCY", 4),
  WORKER_REFRESH_INTERVAL_MS: integer("POLICY_WORKER_REFRESH_INTERVAL_MS", 60_000),
  REQUIRE_DEV_ORGS: boolean("POLICY_REQUIRE_DEV_ORGS", !IS_PRODUCTION),
};

export function requireEncryptionKey(): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set");
  return env.ENCRYPTION_KEY;
}

export function canProcessOrg(org: { isDev: boolean }): boolean {
  return !env.REQUIRE_DEV_ORGS || org.isDev;
}
