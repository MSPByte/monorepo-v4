import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  tenantLinkId: z.uuid(),
  displayName: z.string().min(1).max(256),
  groupType: z.enum(['Security', 'Microsoft365', 'MailEnabledSecurity']),
  mailNickname: z.string().min(1).max(64).optional(),
  description: z.string().max(1024).optional(),
  visibility: z.enum(['Private', 'Public']).optional(),
});

const outputs = z.object({
  externalId: z.string(),
  internalId: z.string(),
  name: z.string(),
});

export const m365GroupCreate: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.group.create',
  vendor: 'microsoft-365',
  name: 'Create M365 Group',
  description:
    'Create a Security, Microsoft 365, or mail-enabled security group in a tenant. Saves the group to the local DB immediately so downstream steps can wire it.',
  category: 'group',
  inputs,
  outputs,
  inputMeta: {
    tenantLinkId: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'integration_link',
      typeHint: 'text',
      label: 'Tenant',
      required: true,
    },
    displayName: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Display name',
      required: true,
    },
    groupType: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Group type',
      description: 'The type of group to create.',
      required: true,
      choices: [
        { value: 'Security', label: 'Security Group' },
        { value: 'Microsoft365', label: 'Microsoft 365 Group' },
        { value: 'MailEnabledSecurity', label: 'Mail-enabled Security Group' },
      ],
    },
    mailNickname: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Mail nickname',
      description: 'Optional — derived from the display name when not set.',
      required: false,
      advanced: true,
    },
    description: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Description',
      required: false,
      advanced: true,
    },
    visibility: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Visibility',
      description: 'Applies to Microsoft 365 Groups only.',
      required: false,
      advanced: true,
      choices: [
        { value: 'Private', label: 'Private' },
        { value: 'Public', label: 'Public' },
      ],
    },
  },
  outputMeta: {
    externalId: { label: 'Graph group id', outputType: 'm365_group_external_id' },
    internalId: { label: 'Internal group id', outputType: 'm365_group_internal_id' },
    name: { label: 'Group display name' },
  },
  actionLabel: ActionLabels.M365GroupCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.05,
  async handler(ctx, input) {
    const derived =
      input.displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 64) || 'group';
    const mailNickname = input.mailNickname ?? derived;

    let groupTypes: string[];
    let mailEnabled: boolean;
    let securityEnabled: boolean;

    if (input.groupType === 'Microsoft365') {
      groupTypes = ['Unified'];
      mailEnabled = true;
      securityEnabled = false;
    } else if (input.groupType === 'MailEnabledSecurity') {
      groupTypes = [];
      mailEnabled = true;
      securityEnabled = true;
    } else {
      groupTypes = [];
      mailEnabled = false;
      securityEnabled = true;
    }

    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      const result = await connector.groups.create({
        displayName: input.displayName,
        mailNickname,
        groupTypes,
        mailEnabled,
        securityEnabled,
        description: input.description,
        visibility: input.visibility,
      });

      // Write-through: persist immediately so the UI and downstream steps see it.
      let internalId = result.id;
      try {
        const row = await ctx.upsertM365Group({
          linkId: input.tenantLinkId,
          externalId: result.id,
          name: result.displayName,
          description: input.description,
          mailEnabled,
          securityEnabled,
        });
        internalId = row.id;
      } catch {
        // DB write failed — sync will catch it; use externalId as fallback.
      }

      return {
        outcome: 'success',
        outputs: { externalId: result.id, internalId, name: result.displayName },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exist') || message.includes(' 409')) {
        return { outcome: 'skip', reason: `Group "${input.displayName}" already exists in tenant` };
      }
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
