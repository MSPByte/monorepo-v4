import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  tenantLinkId: z.uuid(),
  groupId: z.string().min(1),
  identityExternalId: z.string().min(1),
});

const outputs = z.object({
  groupExternalId: z.string(),
  userExternalId: z.string(),
});

export const m365GroupAddMember: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.group.add-member',
  vendor: 'microsoft-365',
  integration: { integrationId: 'microsoft-365', connection: 'activeLink' },
  name: 'Add M365 User to Group',
  description: 'Add a Microsoft 365 user to a security or Microsoft 365 group.',
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
    groupId: {
      allowedBindings: ['entity', 'literal', 'runtime', 'siteFact', 'priorOutput'],
      entityType: 'm365_group',
      typeHint: 'text',
      priorOutputCompat: ['m365_group_external_id'],
      label: 'Group',
      description:
        'The group to add the user to. Wire from a create-group step, pick from the tenant, or supply a Graph group id directly.',
      required: true,
    },
    identityExternalId: {
      allowedBindings: ['literal', 'runtime', 'priorOutput'],
      priorOutputCompat: ['m365_identity_external_id'],
      typeHint: 'text',
      label: 'User (Graph id)',
      description:
        'The user\'s Graph object id. Wire from a create-identity step, or provide directly.',
      required: true,
    },
  },
  outputMeta: {
    groupExternalId: { label: 'Graph group id', outputType: 'm365_group_external_id' },
    userExternalId: { label: 'Graph user id', outputType: 'm365_identity_external_id' },
  },
  actionLabel: ActionLabels.M365IdentityGroupAdd,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.02,
  async handler(ctx, input) {
    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      await connector.groups.addMember(input.groupId, input.identityExternalId);
      return {
        outcome: 'success',
        outputs: { groupExternalId: input.groupId, userExternalId: input.identityExternalId },
      };
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
