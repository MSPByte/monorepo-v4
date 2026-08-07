import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';
import { generateM365Password } from './password.js';

const inputs = z
  .object({
    identityId: z.uuid(),
    mode: z.enum(['random', 'custom']),
    password: z.string().min(8).max(256).optional(),
    forceChangeAtNextSignin: z.boolean(),
  })
  .refine((v) => v.mode !== 'custom' || (v.password?.length ?? 0) >= 8, {
    message: 'Password is required when mode is custom',
    path: ['password'],
  });

const outputs = z.object({
  userId: z.string(),
  temporaryPassword: z.string(),
});

export const m365IdentityResetPassword: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.identity.reset-password',
  vendor: 'microsoft-365',
  name: 'Reset M365 Password',
  description: 'Reset the password for a Microsoft 365 identity.',
  category: 'identity',
  inputs,
  outputs,
  inputMeta: {
    identityId: {
      allowedBindings: ['entity', 'priorOutput'],
      entityType: 'm365_identity',
    },
    mode: { allowedBindings: ['literal', 'runtime'], typeHint: 'text' },
    password: {
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
    temporaryPassword: { sensitive: true },
  },
  actionLabel: ActionLabels.M365IdentityResetPassword,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.05,
  async handler(ctx, input) {
    const identity = await ctx.loadM365Identity(input.identityId);
    if (!identity) {
      return {
        outcome: 'fail',
        errorClass: 'not_found',
        message: 'M365 identity not found',
      };
    }

    const password = input.mode === 'random' ? generateM365Password() : input.password!;

    try {
      const connector = await ctx.getM365Connector(identity.linkId);
      await connector.users.update(identity.externalId, {
        passwordProfile: {
          password,
          forceChangePasswordNextSignInWithMfa: input.forceChangeAtNextSignin,
        },
      });
    } catch (err) {
      return {
        outcome: 'fail',
        errorClass: 'vendor_error',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }

    return {
      outcome: 'success',
      outputs: { userId: identity.externalId, temporaryPassword: password },
    };
  },
};
