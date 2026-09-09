import { z } from 'zod';
import { config } from 'dotenv';
config();

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  CATALOG_DATABASE_URL: z.url(),
  ENCRYPTION_KEY: z.string().length(64),
  LOG_LEVEL: z.enum(['trace', 'info', 'debug', 'warn', 'silent', 'error', 'fatal']).default('info'),
  // Legacy single-tenant fallback for v1.0 routes. Not required for v2.0.
  ORG_ID: z.string().optional(),
  // Self-update: the canonical version agents should run and the public base URL.
  AGENT_CORE_VERSION: z.string().default('0.1.0'),
  AGENT_SERVER_URL: z.string().optional(),
  // Shared secret for internal cross-service calls (e.g. tRPC → agents push trigger).
  AGENTS_INTERNAL_SECRET: z.string().optional(),
  // Set to true in local dev to enable /internal/dev/trigger without auth. Never set in production.
  DEV_TRIGGER_ENABLED: z.coerce.boolean().default(false),
  // Entra app client ID — used to verify end-user SSO tokens on form submission.
  MICROSOFT_AUTH_CLIENT_ID: z.string().optional(),
  // Submission rate limiting. When unset, rate limiting is disabled (fail-open).
  REDIS_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[agents] Invalid environment:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
