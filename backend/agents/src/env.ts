import { z } from 'zod';
import { config } from 'dotenv';
config();

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  CATALOG_DATABASE_URL: z.url(),
  ORG_ID: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(64),
  LOG_LEVEL: z.enum(['trace', 'info', 'debug', 'warn', 'silent', 'error', 'fatal']).default('info'),
  // Self-update: the canonical version agents should run and the public base URL.
  AGENT_CORE_VERSION: z.string().default('0.1.0'),
  AGENT_SERVER_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[agents] Invalid environment:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
