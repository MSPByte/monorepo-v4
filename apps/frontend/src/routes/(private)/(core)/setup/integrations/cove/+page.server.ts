import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ENCRYPTION_KEY } from '$env/static/private';
import { Encryption, CoveConnector } from '@mspbyte/shared';
import { z } from 'zod';
import { createServerCaller } from '$lib/server/trpc';

const CoveConfigSchema = z.object({
  server: z.string().optional(),
  partnerId: z.number().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCustomers(connectionString: string, auth: App.Locals['auth'], org: any) {
  try {
    const caller = createServerCaller({ auth, org, connectionString });
    const integration = await caller.integrations.get({ id: 'cove' });
    if (!integration || integration.deletedAt) return [];

    const config = CoveConfigSchema.safeParse(integration.config);
    if (!config.success) return [];

    const { server, partnerId, clientId, clientSecret } = config.data;
    if (!server || !clientId || !clientSecret || partnerId == null) return [];

    const decrypted = Encryption.decrypt(clientSecret, ENCRYPTION_KEY);
    if (!decrypted) return [];

    const connector = new CoveConnector(server, clientId, decrypted);
    return await connector.partner.children.list(partnerId).catch(() => []);
  } catch {
    return [];
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  return {
    customers: loadCustomers(locals.connectionString, locals.auth, locals.org),
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const formSchema = z.object({
      server: z.string().min(1),
      partnerId: z.coerce.number().int().min(1),
      clientId: z.string().min(1),
      clientSecret: z.string().optional(),
      credentialExpiration: z.string().optional(),
    });

    const raw = await request.formData();
    const parsed = formSchema.safeParse(Object.fromEntries(raw.entries()));
    if (!parsed.success) {
      return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid form data' });
    }

    const { server, partnerId, clientId, clientSecret, credentialExpiration } = parsed.data;
    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });

    let encryptedSecret: string;
    if (!clientSecret) {
      const existing = await caller.integrations.get({ id: 'cove' });
      const existingConfig = CoveConfigSchema.safeParse(existing?.config);
      if (!existingConfig.success || !existingConfig.data.clientSecret) {
        return fail(400, { error: 'Client Secret is required' });
      }
      encryptedSecret = existingConfig.data.clientSecret;
    } else {
      const connector = new CoveConnector(server, clientId, clientSecret);
      const healthy = await connector.checkHealth();
      if (!healthy) return fail(400, { error: 'Connection failed: unable to authenticate with Cove' });
      encryptedSecret = Encryption.encrypt(clientSecret, ENCRYPTION_KEY);
    }

    try {
      await caller.integrations.upsert({
        id: 'cove',
        config: { server, partnerId, clientId, clientSecret: encryptedSecret },
        credentialExpiration: credentialExpiration ? new Date(credentialExpiration).toISOString() : undefined,
      });
      return { success: true };
    } catch (err) {
      return fail(500, { error: String(err) });
    }
  },

  testConnection: async ({ request }) => {
    const raw = await request.formData();
    const server = String(raw.get('server') ?? '');
    const clientId = String(raw.get('clientId') ?? '');
    const clientSecret = String(raw.get('clientSecret') ?? '');

    if (!server || !clientId || !clientSecret) {
      return fail(400, { error: 'Server URL, Client ID, and Client Secret are required for connection test' });
    }

    try {
      const connector = new CoveConnector(server, clientId, clientSecret);
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
      await caller.integrations.delete({ id: 'cove' });
    } catch (err) {
      return fail(500, { error: String(err) });
    }
    return redirect(303, '/setup/integrations');
  },
};
