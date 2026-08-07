import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  identityId: z.uuid(),
});

const outputs = z.object({
  userId: z.string(),
});

export const m365IdentityRevokeSessions: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.identity.revoke-sessions',
  vendor: 'microsoft-365',
  name: 'Revoke M365 Sign-in Sessions',
  description: 'Invalidate all active Microsoft 365 sign-in sessions for a user.',
  category: 'identity',
  inputs,
  outputs,
  inputMeta: {
    identityId: {
      allowedBindings: ['entity', 'priorOutput', 'runtime'],
      entityType: 'm365_identity',
      typeHint: 'text',
      label: 'Identity',
      description: 'The M365 user whose sessions to revoke.',
      required: true,
    },
  },
  outputMeta: { userId: { label: 'Graph user id' } },
  actionLabel: ActionLabels.M365IdentityRevokeSessions,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.02,
  async handler(ctx, input) {
    const identity = await ctx.loadM365Identity(input.identityId);
    if (!identity) {
      return { outcome: 'fail', errorClass: 'not_found', message: 'M365 identity not found' };
    }
    try {
      const connector = await ctx.getM365Connector(identity.linkId);
      await connector.users.revokeSignInSessions(identity.externalId);
      return { outcome: 'success', outputs: { userId: identity.externalId } };
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
