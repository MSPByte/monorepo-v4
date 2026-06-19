import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ENCRYPTION_KEY } from '$env/static/private';
import { Encryption, DattoConnector } from '@mspbyte/shared';
import type { DattoSite } from '@mspbyte/shared';
import { z } from 'zod';
import { createServerCaller } from '$lib/server/trpc';

const DattoConfigSchema = z.object({
  url: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecretKey: z.string().optional(),
  siteVariableName: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSites(connectionString: string, auth: App.Locals['auth'], org: any): Promise<DattoSite[]> {
  try {
    const caller = createServerCaller({ auth, org, connectionString });
    const integration = await caller.integrations.get({ id: 'dattormm' });
    if (!integration || integration.deletedAt) return [];

    const config = DattoConfigSchema.safeParse(integration.config);
    if (!config.success) return [];

    const { url, apiKey, apiSecretKey } = config.data;
    if (!url || !apiKey || !apiSecretKey) return [];

    const decrypted = Encryption.decrypt(apiSecretKey, ENCRYPTION_KEY);
    if (!decrypted) return [];

    const connector = new DattoConnector(url, apiKey, decrypted);
    return await connector.account.sites().catch(() => []);
  } catch {
    return [];
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  return {
    sites: loadSites(locals.connectionString, locals.auth, locals.org),
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const formSchema = z.object({
      url: z.string().min(1),
      apiKey: z.string().min(1),
      apiSecretKey: z.string().optional(),
      siteVariableName: z.string().optional(),
      credentialExpiration: z.string().optional(),
    });

    const raw = await request.formData();
    const parsed = formSchema.safeParse(Object.fromEntries(raw.entries()));
    if (!parsed.success) {
      return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid form data' });
    }

    const { url, apiKey, apiSecretKey, siteVariableName, credentialExpiration } = parsed.data;
    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });

    let encryptedSecret: string;
    if (!apiSecretKey) {
      const existing = await caller.integrations.get({ id: 'dattormm' });
      const existingConfig = DattoConfigSchema.safeParse(existing?.config);
      if (!existingConfig.success || !existingConfig.data.apiSecretKey) {
        return fail(400, { error: 'API Secret Key is required' });
      }
      encryptedSecret = existingConfig.data.apiSecretKey;
    } else {
      const connector = new DattoConnector(url, apiKey, apiSecretKey);
      const healthy = await connector.checkHealth();
      if (!healthy) return fail(400, { error: 'Connection failed: unable to authenticate with DattoRMM' });
      encryptedSecret = Encryption.encrypt(apiSecretKey, ENCRYPTION_KEY);
    }

    try {
      await caller.integrations.upsert({
        id: 'dattormm',
        config: { url, apiKey, apiSecretKey: encryptedSecret, siteVariableName: siteVariableName || undefined },
        credentialExpiration: credentialExpiration ? new Date(credentialExpiration).toISOString() : undefined,
      });
      return { success: true };
    } catch (err) {
      return fail(500, { error: String(err) });
    }
  },

  testConnection: async ({ request }) => {
    const raw = await request.formData();
    const url = String(raw.get('url') ?? '');
    const apiKey = String(raw.get('apiKey') ?? '');
    const apiSecretKey = String(raw.get('apiSecretKey') ?? '');

    if (!url || !apiKey || !apiSecretKey) {
      return fail(400, { error: 'URL, API Key, and API Secret Key are required' });
    }

    try {
      const connector = new DattoConnector(url, apiKey, apiSecretKey);
      const healthy = await connector.checkHealth();
      if (!healthy) return fail(400, { error: 'Connection failed' });
      return { success: true };
    } catch (err) {
      return fail(400, { error: String(err) });
    }
  },

  deleteIntegration: async ({ locals }) => {
    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });
    try {
      await caller.integrations.delete({ id: 'dattormm' });
    } catch (err) {
      return fail(500, { error: String(err) });
    }
    return redirect(303, '/setup/integrations');
  },
};
