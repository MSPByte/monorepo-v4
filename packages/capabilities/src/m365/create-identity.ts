import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  tenantLinkId: z.uuid(),
  displayName: z.string().min(1).max(256),
  userPrincipalName: z.email(),
  // Optional — handler derives from displayName when omitted (strip
  // non-alphanumerics, lowercase, cap at 64 chars).
  mailNickname: z.string().min(1).max(64).optional(),
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
  // Only populated when the worker generated the password — the user needs a
  // way to retrieve it. Sensitive → encrypted-at-rest + reveal-audited.
  temporaryPassword: z.string().optional(),
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
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Display name',
      required: true,
    },
    userPrincipalName: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'upn',
      label: 'User principal name',
      description: 'The full sign-in address. Domain is picked from the tenant\'s verified list.',
      required: true,
    },
    mailNickname: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Mail nickname',
      description:
        'Optional — derived from the display name if you don\'t set one. Override when you need a specific alias.',
      required: false,
      advanced: true,
    },
    initialPassword: {
      allowedBindings: ['literal', 'runtime', 'generated'],
      sensitive: true,
      typeHint: 'password',
      label: 'Initial password',
      description: 'Generate a strong random password at run time, or supply your own.',
      required: true,
    },
    forceChangeAtNextSignin: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Force password change at next sign-in',
      required: true,
      defaultValue: true,
    },
    givenName: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'First name',
      required: false,
      advanced: true,
    },
    surname: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Last name',
      required: false,
      advanced: true,
    },
    jobTitle: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Job title',
      required: false,
      advanced: true,
    },
    department: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Department',
      required: false,
      advanced: true,
    },
    companyName: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Company name',
      required: false,
      advanced: true,
    },
    officeLocation: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Office location',
      required: false,
      advanced: true,
    },
    mobilePhone: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Mobile phone',
      required: false,
      advanced: true,
    },
    usageLocation: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Usage location',
      description: 'ISO 3166-1 alpha-2 country code (US, GB, DE…). Required before licenses can be assigned.',
      required: false,
      advanced: true,
    },
    preferredLanguage: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
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
    temporaryPassword: {
      label: 'Temporary password',
      sensitive: true,
      description: 'Populated only when the worker generated the password.',
    },
  },
  actionLabel: ActionLabels.M365IdentityResetPassword,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.1,
  async handler(ctx, input) {
    // Password resolution happens in the worker's binding resolver; we only
    // need to know whether it was generated so we know whether it's safe to
    // echo back in outputs.
    const generated = ctx.generatedInputs.has('initialPassword');
    const password = input.initialPassword;

    // Derive mailNickname from displayName when the caller didn't set one:
    // strip anything that isn't a-z0-9, lowercase, cap at 64 chars. Graph
    // rejects specials so this keeps the create idempotent for the common
    // case (display "Jane Doe" → nickname "janedoe").
    const derived =
      input.displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 64) || 'user';
    const mailNickname = input.mailNickname ?? derived;

    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      const result = await connector.users.create({
        displayName: input.displayName,
        userPrincipalName: input.userPrincipalName,
        mailNickname,
        password,
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
        outputs: {
          userId: result.id,
          userPrincipalName: result.userPrincipalName,
          // Only expose the password if we generated it — a user-supplied one
          // isn't ours to echo.
          temporaryPassword: generated ? password : undefined,
        },
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
