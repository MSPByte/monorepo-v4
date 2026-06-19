import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { ENCRYPTION_KEY } from '$env/static/private';
import { Encryption, DattoConnector } from '@mspbyte/shared';
import { z } from 'zod';
import { createServerCaller } from '$lib/server/trpc';

const DattoConfigSchema = z.object({
  url: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecretKey: z.string().optional(),
});

const MSPAgentConfigSchema = z.object({
  primaryPsa: z.string().optional(),
  siteVariableName: z.string().optional(),
});

type MSPAgentLinkMeta = {
  rmm: 'dattormm';
  variableName: string;
  variableStatus: 'ok' | 'missing' | 'mismatch' | null;
  lastCheckedAt: string | null;
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const formSchema = z.object({
      primaryPsa: z.string().min(1),
      siteVariableName: z.string().optional(),
    });

    const raw = await request.formData();
    const parsed = formSchema.safeParse(Object.fromEntries(raw.entries()));
    if (!parsed.success) {
      return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid form data' });
    }

    const { primaryPsa, siteVariableName } = parsed.data;
    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });

    try {
      await caller.integrations.upsert({
        id: 'mspagent',
        config: { primaryPsa, siteVariableName: siteVariableName || undefined },
      });
      return { success: true };
    } catch (err) {
      return fail(500, { error: String(err) });
    }
  },

  deleteIntegration: async ({ locals }) => {
    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });
    try {
      await caller.integrations.delete({ id: 'mspagent' });
    } catch (err) {
      return fail(500, { error: String(err) });
    }
    return redirect(303, '/setup/integrations');
  },

  checkVars: async ({ request, locals }) => {
    const raw = await request.formData();
    const siteId = raw.get('siteId')?.toString() || undefined;

    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });

    const [mspagentIntegration, dattoIntegration, allDattoLinks] = await Promise.all([
      caller.integrations.get({ id: 'mspagent' }),
      caller.integrations.get({ id: 'dattormm' }),
      caller.integrationLinks.list({ integrationId: 'dattormm' }),
    ]);

    if (!dattoIntegration || dattoIntegration.deletedAt) {
      return fail(404, { error: 'DattoRMM integration not configured' });
    }

    const mspagentConfig = MSPAgentConfigSchema.parse(mspagentIntegration?.config ?? {});
    const variableName = mspagentConfig.siteVariableName ?? 'MSPSiteCode';

    const dattoConfig = DattoConfigSchema.parse(dattoIntegration.config);
    if (!dattoConfig.url || !dattoConfig.apiKey || !dattoConfig.apiSecretKey) {
      return fail(400, { error: 'DattoRMM integration not fully configured' });
    }

    const apiSecretKey = Encryption.decrypt(dattoConfig.apiSecretKey, ENCRYPTION_KEY);
    if (!apiSecretKey) return fail(500, { error: 'Failed to decrypt DattoRMM credentials' });

    const connector = new DattoConnector(dattoConfig.url, dattoConfig.apiKey, apiSecretKey);
    const links = siteId ? allDattoLinks.filter((l) => l.siteId === siteId) : allDattoLinks;

    const checkResult: { siteId: string; status: 'ok' | 'missing' | 'mismatch'; currentValue: string | null }[] = [];

    for (const link of links) {
      if (!link.externalId || !link.siteId) continue;

      const currentValue = await connector.site.variables.get(link.externalId, variableName).catch(() => null);

      let status: 'ok' | 'missing' | 'mismatch';
      if (currentValue === null || currentValue === undefined) {
        status = 'missing';
      } else if (currentValue === link.siteId) {
        status = 'ok';
      } else {
        status = 'mismatch';
      }

      checkResult.push({ siteId: link.siteId, status, currentValue: currentValue ?? null });

      const meta: MSPAgentLinkMeta = {
        rmm: 'dattormm',
        variableName,
        variableStatus: status,
        lastCheckedAt: new Date().toISOString(),
      };

      try {
        await caller.integrationLinks.update({ id: link.id, meta });
      } catch {
        // best effort
      }
    }

    return { success: true, checkResult };
  },

  pushVars: async ({ request, locals }) => {
    const raw = await request.formData();
    const siteId = raw.get('siteId')?.toString() || undefined;

    const caller = createServerCaller({ auth: locals.auth, org: locals.org, connectionString: locals.connectionString });

    const [mspagentIntegration, dattoIntegration, allDattoLinks] = await Promise.all([
      caller.integrations.get({ id: 'mspagent' }),
      caller.integrations.get({ id: 'dattormm' }),
      caller.integrationLinks.list({ integrationId: 'dattormm' }),
    ]);

    if (!dattoIntegration || dattoIntegration.deletedAt) {
      return fail(404, { error: 'DattoRMM integration not configured' });
    }

    const mspagentConfig = MSPAgentConfigSchema.parse(mspagentIntegration?.config ?? {});
    const variableName = mspagentConfig.siteVariableName ?? 'MSPSiteCode';

    const dattoConfig = DattoConfigSchema.parse(dattoIntegration.config);
    if (!dattoConfig.url || !dattoConfig.apiKey || !dattoConfig.apiSecretKey) {
      return fail(400, { error: 'DattoRMM integration not fully configured' });
    }

    const apiSecretKey = Encryption.decrypt(dattoConfig.apiSecretKey, ENCRYPTION_KEY);
    if (!apiSecretKey) return fail(500, { error: 'Failed to decrypt DattoRMM credentials' });

    const connector = new DattoConnector(dattoConfig.url, dattoConfig.apiKey, apiSecretKey);
    const links = siteId ? allDattoLinks.filter((l) => l.siteId === siteId) : allDattoLinks;

    let pushed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const link of links) {
      if (!link.externalId || !link.siteId) continue;

      try {
        await connector.site.variables.set(link.externalId, variableName, link.siteId);
      } catch (err) {
        failed++;
        errors.push(`${link.name ?? link.externalId}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      pushed++;

      const meta: MSPAgentLinkMeta = {
        rmm: 'dattormm',
        variableName,
        variableStatus: null,
        lastCheckedAt: null,
      };

      try {
        await caller.integrationLinks.update({ id: link.id, meta });
      } catch {
        // best effort
      }
    }

    return { success: true, pushed, failed, errors };
  },
};
