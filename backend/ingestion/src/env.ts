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

function ratio(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }

  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function stringList(name: string, fallback?: string): string[] {
  const value = process.env[name] ?? fallback;
  if (!value) return [];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function runtimeEnvironment(): string {
  return process.env.INGESTION_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
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
  MICROSOFT_CERT_PEM: process.env.MICROSOFT_CERT_PEM,
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  SCHEDULER_ENABLED: boolean("INGESTION_SCHEDULER_ENABLED", IS_PRODUCTION),
  // Safety-net poll cadence. Jobs self-schedule their next run on completion,
  // so this only needs to catch brand-new links, links updated in the DB, and
  // jobs whose delayed entry vanished. 5 min is plenty.
  SCHEDULE_INTERVAL_MS: integer("INGESTION_SCHEDULE_INTERVAL_MS", 5 * 60_000),
  SCHEDULE_ORG_CONCURRENCY: integer("INGESTION_SCHEDULE_ORG_CONCURRENCY", 5),
  // Longer than 2× SCHEDULE_INTERVAL_MS so a running scan can't lose its
  // lease before the next tick refreshes it, and a died leader is picked up
  // by another replica within one tick.
  SCHEDULER_LOCK_TTL_MS: integer("INGESTION_SCHEDULER_LOCK_TTL_MS", 15 * 60_000),
  WORKER_CONCURRENCY: integer("INGESTION_WORKER_CONCURRENCY", 4),
  WORKER_REFRESH_INTERVAL_MS: integer("INGESTION_WORKER_REFRESH_INTERVAL_MS", 60_000),
  WORKER_LOCK_DURATION_MS: integer("INGESTION_WORKER_LOCK_DURATION_MS", 5 * 60_000),
  ACTIVE_RUN_STALE_MS: integer("INGESTION_ACTIVE_RUN_STALE_MS", 2 * 60 * 60 * 1000),
  FULL_SYNC_INTERVAL_MS: integer("INGESTION_FULL_SYNC_INTERVAL_MS", 24 * 60 * 60 * 1000),
  INCREMENTAL_SYNC_INTERVAL_MS: integer("INGESTION_INCREMENTAL_SYNC_INTERVAL_MS", 15 * 60 * 1000),
  RAW_BATCH_SIZE: integer("INGESTION_RAW_BATCH_SIZE", 100),
  DEAD_LETTER_FAILURE_RATIO: ratio("INGESTION_DEAD_LETTER_FAILURE_RATIO", 0.5),
  DEAD_LETTER_MIN_SAMPLES: integer("INGESTION_DEAD_LETTER_MIN_SAMPLES", 10),
  ENABLE_DEV_ADAPTER: boolean("INGESTION_ENABLE_DEV_ADAPTER", false),
  TARGET_ORG_IDS: stringList("INGESTION_ORG_IDS", process.env.PIPELINE_ORG_IDS),
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

export function getMicrosoftCertPem(): string | null {
  const raw = env.MICROSOFT_CERT_PEM;
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) return decoded;
  } catch {
    /* not base64 */
  }
  return raw;
}

