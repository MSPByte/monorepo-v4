import { z } from 'zod';
import { config } from 'dotenv';
config();

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  AGENT_API_SECRET: z.string().min(1),
  CATALOG_DATABASE_URL: z.url(),
  ORG_ID: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(64),
  LOG_LEVEL: z.enum(['trace', 'info', 'debug', 'warn', 'silent', 'error', 'fatal']).default('info')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[agents] Invalid environment:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
