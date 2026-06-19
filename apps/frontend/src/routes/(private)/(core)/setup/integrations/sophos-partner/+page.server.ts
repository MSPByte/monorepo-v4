import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ENCRYPTION_KEY } from '$env/static/private';
import { Encryption, SophosConnector } from '@mspbyte/shared';
import type { SophosTenant } from '@mspbyte/shared';
import { z } from 'zod';
import { createServerCaller } from '$lib/server/trpc';

const SophosConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTenants(connectionString: string, auth: App.Locals['auth'], org: any): Promise<{ id: string; name: string; meta: { apiHost: string | null } }[]> {
  try {
    const caller = createServerCaller({ auth, org, connectionString });
    const integration = await caller.integrations.get({ id: 'sophos-partner' });
    if (!integration || integration.deletedAt) return [];

    const config = SophosConfigSchema.safeParse(integration.config);
    if (!config.success) return [];

    const { clientId, clientSecret } = config.data;
    if (!clientId || !clientSecret) return [];

    const decrypted = Encryption.decrypt(clientSecret, ENCRYPTION_KEY);
    if (!decrypted) return [];

    const connector = new SophosConnector(clientId, decrypted);
    const tenants = await connector.partner.tenants.list().catch(() => [] as SophosTenant[]);
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      meta: { apiHost: t.apiHost ?? null },
    }));
  } catch {
    return [];
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  return {
    tenants: loadTenants(locals.connectionString, locals.auth, locals.org),
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const formSchema = z.object({
      clientId: z.string().min(1),
      clientSecret: z.string().optional(),
      credentialExpiration: z.string().optional(),
    });

    const raw = await request.formData();
    const parsed = formSchema.safeParse(Object.fromEntries(raw.entries()));
    if (!parsed.success) {
      return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid form data' });
    }

    const { clientId, clientSecret, credentialExpiration } = parsed.data;
    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });

    let encryptedSecret: string;
    if (!clientSecret) {
      const existing = await caller.integrations.get({ id: 'sophos-partner' });
      const existingConfig = SophosConfigSchema.safeParse(existing?.config);
      if (!existingConfig.success || !existingConfig.data.clientSecret) {
        return fail(400, { error: 'Client Secret is required' });
      }
      encryptedSecret = existingConfig.data.clientSecret;
    } else {
      const connector = new SophosConnector(clientId, clientSecret);
      const healthy = await connector.checkHealth();
      if (!healthy) return fail(400, { error: 'Connection failed: unable to authenticate with Sophos' });
      encryptedSecret = Encryption.encrypt(clientSecret, ENCRYPTION_KEY);
    }

    try {
      await caller.integrations.upsert({
        id: 'sophos-partner',
        config: { clientId, clientSecret: encryptedSecret },
        credentialExpiration: credentialExpiration ? new Date(credentialExpiration).toISOString() : undefined,
      });
      return { success: true };
    } catch (err) {
      return fail(500, { error: String(err) });
    }
  },

  testConnection: async ({ request }) => {
    const raw = await request.formData();
    const clientId = String(raw.get('clientId') ?? '');
    const clientSecret = String(raw.get('clientSecret') ?? '');

    if (!clientId || !clientSecret) {
      return fail(400, { error: 'Client ID and Client Secret are required' });
    }

    try {
      const connector = new SophosConnector(clientId, clientSecret);
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
      await caller.integrations.delete({ id: 'sophos-partner' });
    } catch (err) {
      return fail(500, { error: String(err) });
    }
    return redirect(303, '/setup/integrations');
  },
};
