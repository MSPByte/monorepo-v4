import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';
import { classifyGraphError } from './classify-error.js';

const inputs = z.object({
  tenantLinkId: z.uuid(),
  // Entity pickers return a local identity UUID while a create-identity wire
  // returns the Graph object ID. The handler accepts either.
  identityId: z.string().min(1),
  // The m365_role picker deliberately returns the Entra role template ID,
  // which is the roleDefinitionId Graph expects for a tenant-wide assignment.
  roleDefinitionIds: z.array(z.string().min(1)).min(1)
});

const outputs = z.object({
  userExternalId: z.string(),
  assignedRoleDefinitionIds: z.array(z.string())
});

export const m365IdentityAssignRole: Capability<z.infer<typeof inputs>, z.infer<typeof outputs>> = {
  id: 'm365.identity.role.assign',
  vendor: 'microsoft-365',
  integration: { integrationId: 'microsoft-365', connection: 'activeLink' },
  name: 'Assign M365 Directory Roles',
  description: 'Assign one or more Microsoft Entra directory roles to a user at the tenant scope.',
  category: 'role',
  inputs,
  outputs,
  inputMeta: {
    tenantLinkId: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'integration_link',
      typeHint: 'text',
      label: 'Tenant',
      required: true
    },
    identityId: {
      allowedBindings: ['entity', 'literal', 'runtime', 'priorOutput'],
      entityType: 'm365_identity',
      typeHint: 'text',
      priorOutputCompat: ['m365_identity_external_id', 'm365_identity_internal_id'],
      label: 'User',
      description: 'Pick a tenant identity or wire the user created by an earlier step.',
      required: true
    },
    roleDefinitionIds: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'm365_role',
      typeHint: 'stringArray',
      label: 'Directory roles',
      description: 'Choose the Microsoft Entra directory roles to assign to the user.',
      required: true
    }
  },
  outputMeta: {
    userExternalId: { label: 'Graph user id', outputType: 'm365_identity_external_id' },
    assignedRoleDefinitionIds: { label: 'Assigned directory role template IDs' }
  },
  actionLabel: ActionLabels.M365IdentityRoleAdd,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.05,
  async handler(ctx, input) {
    let userExternalId = input.identityId;
    try {
      const identity = await ctx.loadM365Identity(input.identityId);
      if (identity) userExternalId = identity.externalId;
    } catch {
      // A prior-output wire carries the Graph ID, so there is nothing to load.
    }

    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      await Promise.all(
        input.roleDefinitionIds.map((roleDefinitionId) =>
          connector.roleManagement.directory.roleAssignments.create(
            userExternalId,
            roleDefinitionId
          )
        )
      );
      return {
        outcome: 'success',
        outputs: { userExternalId, assignedRoleDefinitionIds: input.roleDefinitionIds }
      };
    } catch (err) {
      return classifyGraphError(err);
    }
  }
};
