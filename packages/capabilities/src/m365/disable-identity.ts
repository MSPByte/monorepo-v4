import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  identityId: z.uuid(),
});

const outputs = z.object({
  externalId: z.string(),
  name: z.string(),
});

export const m365IdentityDisable: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.identity.disable',
  vendor: 'microsoft-365',
  name: 'Disable M365 Identity',
  description: 'Set accountEnabled=false on a Microsoft 365 user.',
  category: 'identity',
  inputs,
  outputs,
  inputMeta: {
    identityId: {
      allowedBindings: ['entity', 'priorOutput', 'runtime'],
      entityType: 'm365_identity',
      priorOutputCompat: ['m365_identity_internal_id'],
      typeHint: 'text',
      label: 'Identity',
      description: 'The M365 user to disable.',
      required: true,
    },
  },
  outputMeta: {
    externalId: { label: 'Graph user id', outputType: 'm365_identity_external_id' },
    name: { label: 'Display name' },
  },
  actionLabel: ActionLabels.M365IdentityDisable,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.02,
  async handler(ctx, input) {
    const identity = await ctx.loadM365Identity(input.identityId);
    if (!identity) {
      return { outcome: 'fail', errorClass: 'not_found', message: 'M365 identity not found' };
    }
    if (identity.enabled === false) {
      return { outcome: 'skip', reason: 'User is already disabled' };
    }
    try {
      const connector = await ctx.getM365Connector(identity.linkId);
      await connector.users.update(identity.externalId, { accountEnabled: false });
      return { outcome: 'success', outputs: { externalId: identity.externalId, name: identity.name } };
    } catch (err) {
      return {
        outcome: 'fail',
        errorClass: 'vendor_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }
  },
};
