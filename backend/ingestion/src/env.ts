import "dotenv/config";

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer`);
  }

  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function runtimeEnvironment(): string {
  return (
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
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  SCHEDULER_ENABLED: boolean("INGESTION_SCHEDULER_ENABLED", true),
  SCHEDULE_INTERVAL_MS: integer("INGESTION_SCHEDULE_INTERVAL_MS", 60_000),
  WORKER_CONCURRENCY: integer("INGESTION_WORKER_CONCURRENCY", 4),
  WORKER_REFRESH_INTERVAL_MS: integer("INGESTION_WORKER_REFRESH_INTERVAL_MS", 60_000),
  ACTIVE_RUN_STALE_MS: integer("INGESTION_ACTIVE_RUN_STALE_MS", 2 * 60 * 60 * 1000),
  FULL_SYNC_INTERVAL_MS: integer("INGESTION_FULL_SYNC_INTERVAL_MS", 24 * 60 * 60 * 1000),
  INCREMENTAL_SYNC_INTERVAL_MS: integer("INGESTION_INCREMENTAL_SYNC_INTERVAL_MS", 15 * 60 * 1000),
  RAW_BATCH_SIZE: integer("INGESTION_RAW_BATCH_SIZE", 100),
  ENABLE_DEV_ADAPTER: boolean("INGESTION_ENABLE_DEV_ADAPTER", false),
  REQUIRE_DEV_ORGS: boolean("INGESTION_REQUIRE_DEV_ORGS", !IS_PRODUCTION),
};

export function requireEncryptionKey(): string {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not set");
  }

  return env.ENCRYPTION_KEY;
}

export function requireMicrosoftCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required");
  }

  return {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  };
}

export function hasMicrosoftCredentials(): boolean {
  return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}

export function canProcessOrg(org: { isDev: boolean }): boolean {
  return !env.REQUIRE_DEV_ORGS || org.isDev;
}
