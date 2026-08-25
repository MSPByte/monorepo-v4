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
  externalId: z.string(),
  name: z.string(),
  temporaryPassword: z.string(),
});

export const m365IdentityResetPassword: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.identity.reset-password',
  vendor: 'microsoft-365',
  integration: { integrationId: 'microsoft-365', connection: 'activeLink' },
  name: 'Reset M365 Password',
  description: 'Reset the password for a Microsoft 365 identity.',
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
      description: 'The M365 user whose password to reset.',
      required: true,
    },
    mode: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Password mode',
      required: true,
      defaultValue: 'random',
      choices: [
        { value: 'random', label: 'Generate random password' },
        { value: 'custom', label: 'Set custom password' },
      ],
    },
    password: {
      allowedBindings: ['literal', 'runtime'],
      sensitive: true,
      typeHint: 'password',
      label: 'Custom password',
      description: 'Required when mode is "custom".',
      required: false,
    },
    forceChangeAtNextSignin: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'boolean',
      label: 'Force change at next sign-in',
      required: true,
      defaultValue: true,
    },
  },
  outputMeta: {
    externalId: { label: 'Graph user id', outputType: 'm365_identity_external_id' },
    name: { label: 'Display name' },
    temporaryPassword: { label: 'Temporary password', sensitive: true },
  },
  actionLabel: ActionLabels.M365IdentityResetPassword,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.05,
  async handler(ctx, input) {
    const identity = await ctx.loadM365Identity(input.identityId);
    if (!identity) {
      return { outcome: 'fail', errorClass: 'not_found', message: 'M365 identity not found' };
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
      outputs: {
        externalId: identity.externalId,
        name: identity.name ?? identity.externalId,
        temporaryPassword: password,
      },
    };
  },
};
