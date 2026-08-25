import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  // The MSPByte site to link the new Datto site to. Use core.site.provision first.
  mspbyteSiteId: z.uuid(),
  // Name to assign the new Datto RMM site.
  dattoSiteName: z.string().min(1).max(200),
  // Optional description for the Datto site.
  dattoSiteDescription: z.string().max(500).optional()
});

const outputs = z.object({
  externalId: z.string(),
  name: z.string(),
  internalId: z.string(),
  dattoSiteId: z.number(),
});

export const dattoCreateSite: Capability<z.infer<typeof inputs>, z.infer<typeof outputs>> = {
  id: 'datto.site.create',
  vendor: 'dattormm',
  integration: { integrationId: 'dattormm', connection: 'configured' },
  name: 'Create Datto RMM Site',
  description:
    'Creates a new site in Datto RMM and links it to an MSPByte site. ' +
    'Run core.site.provision first to establish the site, then pass its siteId output here. ' +
    'Credentials are loaded automatically from the configured Datto RMM integration.',
  category: 'site',
  inputs,
  outputs,
  inputMeta: {
    mspbyteSiteId: {
      allowedBindings: ['priorOutput', 'entity', 'literal', 'runtime'],
      entityType: 'site',
      typeHint: 'text',
      label: 'MSPByte site',
      description:
        'The MSPByte site to link the new Datto site to. Typically the output of core.site.provision.',
      required: true,
      priorOutputCompat: ['mspbyte.siteId']
    },
    dattoSiteName: {
      allowedBindings: ['literal', 'runtime', 'priorOutput'],
      typeHint: 'text',
      label: 'Datto site name',
      description:
        "Name to assign the new Datto RMM site. Wire from core.site.provision's siteName output to keep names in sync.",
      required: true,
      priorOutputCompat: ['mspbyte.siteName']
    },
    dattoSiteDescription: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Datto site description',
      required: false,
      advanced: true
    }
  },
  outputMeta: {
    externalId: { label: 'Datto site UID', outputType: 'datto.siteUid' },
    name: { label: 'Datto site name', outputType: 'datto.siteName' },
    internalId: { label: 'Integration link ID', outputType: 'mspbyte.integrationLinkId' },
    dattoSiteId: { label: 'Datto site ID (integer)', outputType: 'datto.siteId' },
  },
  actionLabel: ActionLabels.DattoSiteCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    try {
      const connector = await ctx.getDattoConnector();

      const dattoSite = await connector.site.create(
        input.dattoSiteName,
        input.dattoSiteDescription
      );

      const link = await ctx.createIntegrationLink({
        siteId: input.mspbyteSiteId,
        integrationId: 'dattormm',
        externalId: dattoSite.uid,
        name: dattoSite.name,
        status: 'active',
        meta: { dattoSiteId: dattoSite.id }
      });

      return {
        outcome: 'success',
        outputs: {
          externalId: dattoSite.uid,
          name: dattoSite.name,
          internalId: link.id,
          dattoSiteId: dattoSite.id,
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let errorClass:
        | 'permission_denied'
        | 'rate_limited'
        | 'already_exists'
        | 'invalid_input'
        | 'vendor_error' = 'vendor_error';
      if (message.includes(' 403') || message.toLowerCase().includes('forbidden'))
        errorClass = 'permission_denied';
      else if (message.includes(' 429')) errorClass = 'rate_limited';
      else if (message.includes(' 409') || message.toLowerCase().includes('already exist'))
        errorClass = 'already_exists';
      else if (message.includes(' 400')) errorClass = 'invalid_input';
      return {
        outcome: 'fail',
        errorClass,
        message,
        retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error'
      };
    }
  }
};
