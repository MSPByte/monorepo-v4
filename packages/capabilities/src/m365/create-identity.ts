import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  tenantLinkId: z.uuid(),
  displayName: z.string().min(1).max(256),
  userPrincipalName: z.email(),
  mailNickname: z.string().min(1).max(64),
  initialPassword: z.string().min(8).max(256),
  forceChangeAtNextSignin: z.boolean(),
});

const outputs = z.object({
  userId: z.string(),
  userPrincipalName: z.string(),
});

export const m365IdentityCreate: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.identity.create',
  vendor: 'microsoft-365',
  name: 'Create M365 Identity',
  description:
    'Create a new Microsoft 365 user in a tenant. Returns the Graph userId for downstream steps to reference.',
  category: 'identity',
  inputs,
  outputs,
  inputMeta: {
    tenantLinkId: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'integration_link',
      typeHint: 'text',
    },
    displayName: { allowedBindings: ['literal', 'runtime'], typeHint: 'text' },
    userPrincipalName: { allowedBindings: ['literal', 'runtime'], typeHint: 'text' },
    mailNickname: { allowedBindings: ['literal', 'runtime'], typeHint: 'text' },
    initialPassword: {
      allowedBindings: ['literal', 'runtime'],
      sensitive: true,
      typeHint: 'text',
    },
    forceChangeAtNextSignin: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'boolean',
    },
  },
  outputMeta: {
    userId: {},
    userPrincipalName: {},
  },
  actionLabel: ActionLabels.M365IdentityResetPassword,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.1,
  async handler(ctx, input) {
    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      const result = await connector.users.create({
        displayName: input.displayName,
        userPrincipalName: input.userPrincipalName,
        mailNickname: input.mailNickname,
        password: input.initialPassword,
        forceChangePasswordNextSignInWithMfa: input.forceChangeAtNextSignin,
        accountEnabled: true,
      });
      return {
        outcome: 'success',
        outputs: { userId: result.id, userPrincipalName: result.userPrincipalName },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Graph returns 400 with "already exists" if the UPN is taken — treat as
      // a benign skip so a re-run of a compound package doesn't halt.
      if (message.includes('already exist')) {
        return {
          outcome: 'skip',
          reason: `User ${input.userPrincipalName} already exists in tenant`,
        };
      }
      return {
        outcome: 'fail',
        errorClass: 'GRAPH_ERROR',
        message,
        retryable: true,
      };
    }
  },
};
