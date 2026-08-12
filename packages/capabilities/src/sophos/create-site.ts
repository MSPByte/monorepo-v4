import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  // The MSPByte site to link the new Sophos tenant to. Use core.site.provision first.
  mspbyteSiteId: z.uuid(),
  // Name to assign the new Sophos tenant.
  sophosName: z.string().min(1).max(200),
  // Optional Sophos data geography (e.g. 'US', 'EU', 'CA').
  dataGeography: z.string().max(10).optional(),
});

const outputs = z.object({
  sophosTenantId: z.string(),
  sophosTenantName: z.string(),
  // Sophos API host for this tenant — pass to subsequent Sophos capabilities via priorOutput.
  sophosApiHost: z.string().optional(),
  integrationLinkId: z.string(),
});

export const sophosCreateSite: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'sophos.site.create',
  vendor: 'sophos-partner',
  name: 'Create Sophos Partner Site',
  description:
    'Creates a new Sophos tenant via the partner API and links it to an MSPByte site. ' +
    'Run core.site.provision first to establish the site, then pass its siteId output here. ' +
    'Credentials are loaded automatically from the configured Sophos Partner integration.',
  category: 'site',
  inputs,
  outputs,
  inputMeta: {
    mspbyteSiteId: {
      allowedBindings: ['priorOutput', 'entity', 'literal', 'runtime'],
      entityType: 'site',
      typeHint: 'text',
      label: 'MSPByte site',
      description: 'The MSPByte site to link the new Sophos tenant to. Typically the output of core.site.provision.',
      required: true,
      priorOutputCompat: ['mspbyte.siteId'],
    },
    sophosName: {
      allowedBindings: ['literal', 'runtime', 'priorOutput'],
      typeHint: 'text',
      label: 'Sophos tenant name',
      description: 'Name to assign the new Sophos tenant. Wire from core.site.provision\'s siteName output to keep names in sync.',
      required: true,
      priorOutputCompat: ['mspbyte.siteName'],
    },
    dataGeography: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Data geography',
      description: 'Region for tenant data (e.g. US, EU, CA). Defaults to the partner\'s region.',
      required: false,
      advanced: true,
      choices: [
        { value: 'US', label: 'United States' },
        { value: 'EU', label: 'Europe' },
        { value: 'CA', label: 'Canada' },
        { value: 'AU', label: 'Australia' },
        { value: 'JP', label: 'Japan' },
        { value: 'IN', label: 'India' },
        { value: 'BR', label: 'Brazil' },
      ],
    },
  },
  outputMeta: {
    sophosTenantId: { label: 'Sophos tenant ID', outputType: 'sophos.tenantId' },
    sophosTenantName: { label: 'Sophos tenant name', outputType: 'sophos.tenantName' },
    sophosApiHost: { label: 'Sophos API host', outputType: 'sophos.apiHost' },
    integrationLinkId: { label: 'Integration link ID', outputType: 'mspbyte.integrationLinkId' },
  },
  actionLabel: ActionLabels.SophosPartnerSiteCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    try {
      const connector = await ctx.getSophosPartnerConnector();

      const tenant = await connector.partner.tenants.create(
        input.sophosName,
        input.dataGeography,
      );

      const apiHost = (tenant as unknown as Record<string, unknown>).apiHost as string | undefined;

      const link = await ctx.createIntegrationLink({
        siteId: input.mspbyteSiteId,
        integrationId: 'sophos-partner',
        externalId: tenant.id,
        name: tenant.name,
        status: 'active',
        meta: apiHost ? { apiHost } : undefined,
      });

      return {
        outcome: 'success',
        outputs: {
          sophosTenantId: tenant.id,
          sophosTenantName: tenant.name,
          sophosApiHost: apiHost,
          integrationLinkId: link.id,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let errorClass: 'permission_denied' | 'rate_limited' | 'already_exists' | 'invalid_input' | 'vendor_error' =
        'vendor_error';
      if (message.includes(' 403') || message.toLowerCase().includes('forbidden')) errorClass = 'permission_denied';
      else if (message.includes(' 429')) errorClass = 'rate_limited';
      else if (message.includes(' 409') || message.toLowerCase().includes('already exist')) errorClass = 'already_exists';
      else if (message.includes(' 400')) errorClass = 'invalid_input';
      return {
        outcome: 'fail',
        errorClass,
        message,
        retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error',
      };
    }
  },
};
