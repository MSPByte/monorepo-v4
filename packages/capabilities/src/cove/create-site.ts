import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  // The MSPByte site to link the new Cove account to. Use core.site.provision first.
  mspbyteSiteId: z.uuid(),
  // Name to assign the new Cove partner account.
  coveName: z.string().min(1).max(200),
  // Name of the Cove sub-partner to nest the new account under. Leave blank to create
  // directly under the MSP's root Cove account. The handler resolves this by name so
  // the user never needs to know Cove's internal integer partner IDs.
  coveParentPartnerName: z.string().min(1).max(200).optional(),
});

const outputs = z.object({
  externalId: z.string(),
  name: z.string(),
  internalId: z.string(),
});

export const coveCreateSite: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'cove.site.create',
  vendor: 'cove',
  integration: { integrationId: 'cove', connection: 'configured' },
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
    coveParentPartnerName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Parent partner',
      description: 'Cove sub-partner to nest the new account under. Leave blank to create directly under the MSP\'s root Cove account.',
      required: false,
      advanced: true,
      dynamicSource: 'coveChildPartners',
    },
  },
  outputMeta: {
    externalId: { label: 'Cove partner ID', outputType: 'cove.partnerId' },
    name: { label: 'Cove partner name', outputType: 'cove.partnerName' },
    internalId: { label: 'Integration link ID', outputType: 'mspbyte.integrationLinkId' },
  },
  actionLabel: ActionLabels.CoveSiteCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    try {
      const { connector, rootPartnerId } = await ctx.getCoveConnector();

      let parentId = rootPartnerId;
      if (input.coveParentPartnerName) {
        const partners = await connector.partner.children.list(rootPartnerId);
        const match = partners.find(
          (p) => p.Info.Name.toLowerCase() === input.coveParentPartnerName!.toLowerCase()
        );
        if (!match) {
          return {
            outcome: 'fail',
            errorClass: 'not_found',
            message: `Cove partner '${input.coveParentPartnerName}' not found under the root account`,
          };
        }
        parentId = match.Info.Id;
      }

      const child = await connector.partner.children.create(
        parentId,
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
          externalId: String(child.Info.Id),
          name: child.Info.Name,
          internalId: link.id,
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
