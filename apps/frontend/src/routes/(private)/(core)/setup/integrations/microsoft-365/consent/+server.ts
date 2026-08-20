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

const CONSENT_PROPAGATION_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 10_000,
};

async function fetchWithRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
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

type TenantSetup = {
  domains: string[];
  defaultDomain: string | null;
  userCount: number;
  capabilities: Record<string, boolean>;
};

/**
 * Admin consent changes the roles in newly issued app-only tokens. A token
 * obtained just before consent can remain cached for nearly an hour, while
 * Entra may also take a short time to propagate the new grant. Keep the user
 * in the callback until a freshly issued token can complete every required
 * discovery read.
 */
async function waitForTenantSetup(connector: M365Connector): Promise<TenantSetup> {
  return fetchWithRetry(async () => {
    connector.clearTokenCache();

    const [domainsResult, capabilitiesResult, usersResult] = await Promise.allSettled([
      connector.domains.listAll(),
      new TenantCapabilityService(connector).probe(CAPABILITY_PLANS),
      connector.users.listAll('id'),
    ]);

    if (
      domainsResult.status !== 'fulfilled' ||
      capabilitiesResult.status !== 'fulfilled' ||
      usersResult.status !== 'fulfilled'
    ) {
      throw new Error('Microsoft Graph permissions have not propagated yet');
    }

    const allDomains = domainsResult.value;
    return {
      domains: allDomains.filter((domain) => domain.isVerified).map((domain) => domain.id),
      defaultDomain: allDomains.find((domain) => domain.isDefault)?.id ?? null,
      userCount: usersResult.value.length,
      capabilities: capabilitiesResult.value,
    };
  }, CONSENT_PROPAGATION_RETRY_OPTIONS);
}

const M365ConfigSchema = z.object({
  tenantId: z.string(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

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

    // Wait for a new token with the consent grant, and for every setup read to
    // succeed, before redirecting back to the UI. The old flow marked consent
    // successful after swallowing failed reads, which required repeated consent
    // attempts to populate the tenant.
    let tenantSetup: TenantSetup;
    try {
      tenantSetup = await waitForTenantSetup(connector);
    } catch {
      return redirect(
        302,
        `/setup/integrations/microsoft-365?error=${encodeURIComponent(
          'Microsoft accepted consent, but its Graph permissions are still propagating. The setup check retried automatically; wait a minute and try again.'
        )}`
      );
    }

    // Assign directory roles after the consent grant is usable. This is
    // advisory: data collection can succeed even when a tenant disallows role
    // assignment to the application.
    let assignedRoles: string[] = [];
    try {
      const result = await new Microsoft365RoleManagerService(connector).ensureDirectoryRoles(
        REQUIRED_DIRECTORY_ROLES
      );
      assignedRoles = result.assigned;
    } catch {
      /* non-fatal */
    }

    // Update the link only after all required discovery reads completed.
    try {
      const links = await caller.integrationLinks.list({ integrationId: 'microsoft-365' });
      const existingLink = links.find((l) => l.externalId === gdapTenantId && !l.siteId);

      if (!existingLink) throw new Error('The tenant link no longer exists');

      const existingMeta = (existingLink.meta as Record<string, unknown>) ?? {};
      await caller.integrationLinks.update({
        id: existingLink.id,
        status: 'active',
        meta: {
          ...existingMeta,
          consentVersion: CONSENT_VERSION,
          domains: tenantSetup.domains,
          defaultDomain: tenantSetup.defaultDomain,
          userCount: tenantSetup.userCount,
          roles: assignedRoles,
          capabilities: tenantSetup.capabilities,
          capabilitiesCheckedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('Failed to update link after GDAP consent:', err);
      return redirect(
        302,
        `/setup/integrations/microsoft-365?error=${encodeURIComponent(
          'Consent completed, but the tenant setup could not be saved. Please try again.'
        )}`
      );
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
