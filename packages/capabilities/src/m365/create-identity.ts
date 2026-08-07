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
  // Advanced / optional Graph fields. Any that are undefined or empty aren't
  // sent to Graph.
  givenName: z.string().max(64).optional(),
  surname: z.string().max(64).optional(),
  jobTitle: z.string().max(128).optional(),
  department: z.string().max(64).optional(),
  companyName: z.string().max(64).optional(),
  officeLocation: z.string().max(128).optional(),
  mobilePhone: z.string().max(64).optional(),
  usageLocation: z.string().length(2).optional(),
  preferredLanguage: z.string().max(16).optional(),
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
      label: 'Tenant',
      description: 'Which M365 tenant to create the user in.',
      required: true,
    },
    displayName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Display name',
      required: true,
    },
    userPrincipalName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'User principal name',
      description: 'The full sign-in address (e.g. user@tenant.onmicrosoft.com).',
      required: true,
    },
    mailNickname: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Mail nickname',
      description: 'The local-part of the mailbox alias.',
      required: true,
    },
    initialPassword: {
      allowedBindings: ['literal', 'runtime'],
      sensitive: true,
      typeHint: 'text',
      label: 'Initial password',
      description: 'Auto-generate at run time or supply your own.',
      required: true,
    },
    forceChangeAtNextSignin: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'boolean',
      label: 'Force password change at next sign-in',
      required: true,
      defaultValue: true,
    },
    givenName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'First name',
      required: false,
      advanced: true,
    },
    surname: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Last name',
      required: false,
      advanced: true,
    },
    jobTitle: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Job title',
      required: false,
      advanced: true,
    },
    department: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Department',
      required: false,
      advanced: true,
    },
    companyName: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Company name',
      required: false,
      advanced: true,
    },
    officeLocation: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Office location',
      required: false,
      advanced: true,
    },
    mobilePhone: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Mobile phone',
      required: false,
      advanced: true,
    },
    usageLocation: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Usage location',
      description: 'ISO 3166-1 alpha-2 country code (US, GB, DE…). Required before licenses can be assigned.',
      required: false,
      advanced: true,
    },
    preferredLanguage: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Preferred language',
      description: 'BCP 47 language tag (en-US, fr-FR…).',
      required: false,
      advanced: true,
    },
  },
  outputMeta: {
    userId: { label: 'Graph user id' },
    userPrincipalName: { label: 'User principal name' },
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
        givenName: input.givenName,
        surname: input.surname,
        jobTitle: input.jobTitle,
        department: input.department,
        companyName: input.companyName,
        officeLocation: input.officeLocation,
        mobilePhone: input.mobilePhone,
        usageLocation: input.usageLocation,
        preferredLanguage: input.preferredLanguage,
      });
      return {
        outcome: 'success',
        outputs: { userId: result.id, userPrincipalName: result.userPrincipalName },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exist')) {
        return {
          outcome: 'skip',
          reason: `User ${input.userPrincipalName} already exists in tenant`,
        };
      }
      // Graph returns 403 for tenant-consent or permission problems, 400 for
      // malformed inputs, 429 for rate limits. Coarse mapping keeps the
      // classification useful for onFailure rules.
      let errorClass: 'permission_denied' | 'rate_limited' | 'invalid_input' | 'vendor_error' =
        'vendor_error';
      if (message.includes(' 403')) errorClass = 'permission_denied';
      else if (message.includes(' 429')) errorClass = 'rate_limited';
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
