import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  // The MSPByte site to link the new Cove account to. Use core.site.provision first.
  mspbyteSiteId: z.uuid(),
  // Name to assign the new Cove partner account.
  coveName: z.string().min(1).max(200),
});

const outputs = z.object({
  covePartnerId: z.number(),
  covePartnerName: z.string(),
  integrationLinkId: z.string(),
});

export const coveCreateSite: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'cove.site.create',
  vendor: 'cove',
  name: 'Create Cove Site',
  description:
    'Creates a new Cove partner account under the MSP\'s root Cove partner and links it to an MSPByte site. ' +
    'Run core.site.provision first to establish the site, then pass its siteId output here. ' +
    'Credentials and the root partner ID are loaded automatically from the configured Cove integration.',
  category: 'site',
  inputs,
  outputs,
  inputMeta: {
    mspbyteSiteId: {
      allowedBindings: ['priorOutput', 'entity', 'literal', 'runtime'],
      entityType: 'site',
      typeHint: 'text',
      label: 'MSPByte site',
      description: 'The MSPByte site to link the new Cove account to. Typically the output of core.site.provision.',
      required: true,
      priorOutputCompat: ['mspbyte.siteId'],
    },
    coveName: {
      allowedBindings: ['literal', 'runtime', 'priorOutput'],
      typeHint: 'text',
      label: 'Cove account name',
      description: 'Name to assign the new Cove partner account. Wire from core.site.provision\'s siteName output to keep names in sync.',
      required: true,
      priorOutputCompat: ['mspbyte.siteName'],
    },
  },
  outputMeta: {
    covePartnerId: { label: 'Cove partner ID', outputType: 'cove.partnerId' },
    covePartnerName: { label: 'Cove partner name', outputType: 'cove.partnerName' },
    integrationLinkId: { label: 'Integration link ID', outputType: 'mspbyte.integrationLinkId' },
  },
  actionLabel: ActionLabels.CoveSiteCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    try {
      const { connector, rootPartnerId } = await ctx.getCoveConnector();

      const child = await connector.partner.children.create(
        rootPartnerId,
        input.coveName,
      );

      const link = await ctx.createIntegrationLink({
        siteId: input.mspbyteSiteId,
        integrationId: 'cove',
        externalId: String(child.Info.Id),
        name: child.Info.Name,
        status: 'active',
        meta: { covePartnerId: child.Info.Id },
      });

      return {
        outcome: 'success',
        outputs: {
          covePartnerId: child.Info.Id,
          covePartnerName: child.Info.Name,
          integrationLinkId: link.id,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let errorClass: 'permission_denied' | 'already_exists' | 'invalid_input' | 'vendor_error' =
        'vendor_error';
      if (message.toLowerCase().includes('forbidden') || message.toLowerCase().includes('unauthorized')) errorClass = 'permission_denied';
      else if (message.toLowerCase().includes('already exist')) errorClass = 'already_exists';
      return {
        outcome: 'fail',
        errorClass,
        message,
        retryable: errorClass === 'vendor_error',
      };
    }
  },
};
