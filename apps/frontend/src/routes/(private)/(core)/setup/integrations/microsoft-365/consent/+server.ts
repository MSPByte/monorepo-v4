import { redirect } from '@sveltejs/kit';
import {
  CAPABILITY_PLANS,
  CONSENT_VERSION,
  REQUIRED_DIRECTORY_ROLES,
  M365Connector,
  TenantCapabilityService,
  Microsoft365RoleManagerService,
  Encryption,
} from '@mspbyte/shared';
import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, ENCRYPTION_KEY } from '$env/static/private';
import { createServerCaller } from '$lib/server/trpc';
import type { RequestHandler } from './$types';
import { z } from 'zod';

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10_000 } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}


const M365ConfigSchema = z.object({
  tenantId: z.string(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

// TODO: Issue with link not getting correct info because application takes time to register, add delay 10s
export const GET: RequestHandler = async ({ url, locals }) => {
  const msTenantId = url.searchParams.get('tenant');
  const stateRaw = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    const desc = url.searchParams.get('error_description') ?? errorParam;
    return redirect(302, `/setup/integrations/microsoft-365?error=${encodeURIComponent(desc)}`);
  }

  if (!msTenantId || !stateRaw) {
    return redirect(
      302,
      `/setup/integrations/microsoft-365?error=${encodeURIComponent('Consent flow returned incomplete parameters')}`
    );
  }

  let parsedState: { gdapTenantId?: string; orgId?: string } = {};
  try {
    parsedState = z
      .object({
        gdapTenantId: z.string().optional(),
        orgId: z.string().optional(),
      })
      .parse(JSON.parse(stateRaw));
  } catch {
    return redirect(
      302,
      `/setup/integrations/microsoft-365?error=${encodeURIComponent('Invalid state parameter')}`
    );
  }

  const { gdapTenantId } = parsedState;
  const caller = createServerCaller(locals);

  if (gdapTenantId) {
    // Resolve MSP credentials from stored integration config
    let clientId = MICROSOFT_CLIENT_ID;
    let clientSecret = MICROSOFT_CLIENT_SECRET;
    try {
      const integration = await caller.integrations.get({ id: 'microsoft-365' });
      if (integration) {
        const cfg = M365ConfigSchema.safeParse(integration.config);
        if (cfg.success) {
          if (cfg.data.clientId) clientId = cfg.data.clientId;
          if (cfg.data.clientSecret) {
            clientSecret =
              Encryption.decrypt(cfg.data.clientSecret, ENCRYPTION_KEY) ?? clientSecret;
          }
        }
      }
    } catch {
      /* non-fatal — fall back to env vars */
    }

    // Scoped to the selected customer tenant (MSP client credentials + target tenantId)
    const connector = new M365Connector(clientId, clientSecret, gdapTenantId);

    // 1. Assign directory roles (non-fatal, retry for post-consent API propagation delay)
    let assignedRoles: string[] = [];
    try {
      const result = await fetchWithRetry(
        () => {
          connector.clearTokenCache();
          return new Microsoft365RoleManagerService(connector).ensureDirectoryRoles(
            REQUIRED_DIRECTORY_ROLES
          );
        },
        { maxRetries: 3, baseDelayMs: 1000 }
      );
      assignedRoles = result.assigned;
    } catch {
      /* non-fatal */
    }

    // 2. Fetch verified domains (non-fatal)
    let domains: string[] = [];
    let defaultDomain: string | null = null;
    try {
      const allDomains = await connector.domains.listAll();
      domains = allDomains.filter((d) => d.isVerified).map((d) => d.id);
      defaultDomain = allDomains.find((d) => d.isDefault)?.id ?? null;
    } catch {
      /* non-fatal */
    }

    // 3. Probe capabilities (non-fatal)
    let capabilities: Record<string, boolean> | null = null;
    try {
      capabilities = await new TenantCapabilityService(connector).probe(CAPABILITY_PLANS);
    } catch {
      /* non-fatal */
    }

    // 4. Count users (non-fatal)
    let userCount = 0;
    try {
      const userIds = await connector.users.listIdsAll();
      userCount = userIds.length;
    } catch {
      /* non-fatal */
    }

    // 5. Update link with all gathered data
    try {
      const links = await caller.integrationLinks.list({ integrationId: 'microsoft-365' });
      const existingLink = links.find((l) => l.externalId === gdapTenantId && !l.siteId);

      if (existingLink) {
        const existingMeta = (existingLink.meta as Record<string, unknown>) ?? {};
        await caller.integrationLinks.update({
          id: existingLink.id,
          status: 'active',
          meta: {
            ...existingMeta,
            consentVersion: CONSENT_VERSION,
            domains,
            defaultDomain,
            userCount,
            roles: assignedRoles,
            ...(capabilities
              ? { capabilities, capabilitiesCheckedAt: new Date().toISOString() }
              : {}),
          },
        });
      }
    } catch (err) {
      console.error('Failed to update link after GDAP consent:', err);
    }

    return redirect(
      302,
      `/setup/integrations/microsoft-365?consentedTenant=${encodeURIComponent(gdapTenantId)}`
    );
  }

  // Initial MSP consent — upsert integration with MSP tenant ID
  try {
    await caller.integrations.upsert({ id: 'microsoft-365', config: { tenantId: msTenantId } });
  } catch (err) {
    return redirect(
      302,
      `/setup/integrations/microsoft-365?error=${encodeURIComponent(String(err))}`
    );
  }

  return redirect(302, '/setup/integrations/microsoft-365?initialConsent=success');
};
