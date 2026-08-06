import { z } from "zod";
import { M365Connector } from "@mspbyte/connectors";
import { Encryption } from "@mspbyte/encryption";
import { env } from "./env.js";

// Minimal duplicate of packages/trpc/src/routers/vendor.ts M365ConfigSchema.
// A Phase 2 refactor should extract this into @mspbyte/connectors so the worker
// and tRPC share one source of truth.
const M365ConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  tenantId: z.string().optional(),
});

function resolveCredentials(
  config: unknown,
  encryptionKey: string,
): { clientId: string; clientSecret: string } | null {
  const parsed = M365ConfigSchema.safeParse(config);
  const clientId =
    parsed.success && parsed.data.clientId
      ? parsed.data.clientId
      : env.MICROSOFT_CLIENT_ID;
  const encryptedSecret = parsed.success ? parsed.data.clientSecret : undefined;
  const clientSecret = encryptedSecret
    ? Encryption.decrypt(encryptedSecret, encryptionKey) ?? env.MICROSOFT_CLIENT_SECRET
    : env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function buildM365Connector(
  integrationConfig: unknown,
  tenantId: string,
  encryptionKey: string,
): M365Connector {
  const credentials = resolveCredentials(integrationConfig, encryptionKey);
  if (!credentials) throw new Error("Microsoft 365 credentials are not configured");
  return new M365Connector(credentials.clientId, credentials.clientSecret, tenantId);
}
