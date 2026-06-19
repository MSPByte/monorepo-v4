import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { ENCRYPTION_KEY } from "$env/static/private";
import { Encryption, HaloPSAConnector } from "@mspbyte/shared";
import type { HaloPSASite } from "@mspbyte/shared";
import { z } from "zod";
import { createServerCaller } from "$lib/server/trpc";

const HaloConfigSchema = z.object({
  url: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSites(
  connectionString: string,
  auth: App.Locals['auth'],
  org: any,
): Promise<HaloPSASite[]> {
  try {
    const caller = createServerCaller({ auth, org, connectionString });
    const integration = await caller.integrations.get({ id: "halopsa" });
    if (!integration || integration.deletedAt) return [];

    const config = HaloConfigSchema.safeParse(integration.config);
    if (!config.success) {
      console.error("[HaloPSA] Failed to parse config:", config.error);
      return [];
    }

    const { url, clientId, clientSecret } = config.data;
    if (!url || !clientId || !clientSecret) return [];

    const decrypted = Encryption.decrypt(clientSecret, ENCRYPTION_KEY);
    if (!decrypted) return [];

    const connector = new HaloPSAConnector(url, clientId, decrypted);
    return await connector.site.list();
  } catch (err) {
    console.error("[HaloPSA] Unknown Failure:", err);

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
      clientId: z.string().min(1),
      clientSecret: z.string().optional(),
    });

    const raw = await request.formData();
    const parsed = formSchema.safeParse(Object.fromEntries(raw.entries()));
    if (!parsed.success) {
      return fail(400, {
        error: parsed.error.issues[0]?.message ?? "Invalid form data",
      });
    }

    const { url, clientId, clientSecret } = parsed.data;
    const caller = createServerCaller({
      auth: locals.auth,
      org: locals.org,
      connectionString: locals.connectionString,
    });

    let encryptedSecret: string;
    if (!clientSecret) {
      const existing = await caller.integrations.get({ id: "halopsa" });
      const existingConfig = HaloConfigSchema.safeParse(existing?.config);
      if (!existingConfig.success || !existingConfig.data.clientSecret) {
        return fail(400, { error: "Client Secret is required" });
      }
      encryptedSecret = existingConfig.data.clientSecret;
    } else {
      const connector = new HaloPSAConnector(url, clientId, clientSecret);
      const healthy = await connector.checkHealth();
      if (!healthy)
        return fail(400, {
          error: "Connection failed: unable to authenticate with HaloPSA",
        });
      encryptedSecret = Encryption.encrypt(clientSecret, ENCRYPTION_KEY);
    }

    try {
      await caller.integrations.upsert({
        id: "halopsa",
        config: { url, clientId, clientSecret: encryptedSecret },
      });
      return { success: true };
    } catch (err) {
      return fail(500, { error: String(err) });
    }
  },

  testConnection: async ({ request }) => {
    const raw = await request.formData();
    const url = String(raw.get("url") ?? "");
    const clientId = String(raw.get("clientId") ?? "");
    const clientSecret = String(raw.get("clientSecret") ?? "");

    if (!url || !clientId || !clientSecret) {
      return fail(400, {
        error: "URL, Client ID, and Client Secret are required",
      });
    }

    try {
      const connector = new HaloPSAConnector(url, clientId, clientSecret);
      const healthy = await connector.checkHealth();
      if (!healthy) return fail(400, { error: "Connection failed" });
      return { success: true };
    } catch (err) {
      return fail(400, { error: String(err) });
    }
  },

  deleteIntegration: async ({ locals }) => {
    const caller = createServerCaller({
      auth: locals.auth,
      org: locals.org,
      connectionString: locals.connectionString,
    });
    try {
      await caller.integrations.delete({ id: "halopsa" });
    } catch (err) {
      return fail(500, { error: String(err) });
    }
    return redirect(303, "/setup/integrations");
  },
};
