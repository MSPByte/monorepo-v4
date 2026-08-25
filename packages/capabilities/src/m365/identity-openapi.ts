import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import { buildOpenApiRequest, defineOpenApiCapability, type OpenApiOperationManifest } from '../openapi.js';
import { classifyGraphError } from './classify-error.js';

const inputs = z.object({ identityId: z.uuid() });
const outputs = z.object({ externalId: z.string(), name: z.string() });

type IdentityAction =
  | { kind: 'setAccountEnabled'; enabled: boolean }
  | { kind: 'revokeSessions' };

type GraphIdentityOperationConfig = {
  id: string;
  name: string;
  description: string;
  operation: OpenApiOperationManifest;
  action: IdentityAction;
  actionLabel: ActionLabels;
  defaultUnitPrice: number;
};

// Generates the executable shell shared by Graph user operations. The manifest
// decides the endpoint contract; this trusted factory decides how an MSPByte
// identity is resolved, how Graph is invoked, and how errors are classified.
export function defineGraphIdentityOperation(config: GraphIdentityOperationConfig) {
  return defineOpenApiCapability({
    id: config.id,
    vendor: 'microsoft-365',
    integration: { integrationId: 'microsoft-365', connection: 'activeLink' },
    name: config.name,
    description: config.description,
    category: 'identity',
    operation: config.operation,
    inputs,
    outputs,
    inputMeta: {
      identityId: {
        allowedBindings: ['entity', 'priorOutput', 'runtime'],
        entityType: 'm365_identity',
        priorOutputCompat: ['m365_identity_internal_id'],
        typeHint: 'text',
        label: 'Identity',
        description: 'The Microsoft 365 user to change.',
        required: true,
      },
    },
    outputMeta: {
      externalId: { label: 'Graph user ID', outputType: 'm365_identity_external_id' },
      name: { label: 'Display name' },
    },
    actionLabel: config.actionLabel,
    auditAction: 'update',
    requiredPermission: 'Vendors.Write',
    defaultUnitPrice: config.defaultUnitPrice,
    async handler(ctx, input) {
      const identity = await ctx.loadM365Identity(input.identityId);
      if (!identity) return { outcome: 'fail', errorClass: 'not_found', message: 'M365 identity not found' };
      if (config.action.kind === 'setAccountEnabled' && identity.enabled === config.action.enabled) {
        return { outcome: 'skip', reason: `User is already ${config.action.enabled ? 'enabled' : 'disabled'}` };
      }
      try {
        const request = buildOpenApiRequest(config.operation, {
          userId: identity.externalId,
          body: config.action.kind === 'setAccountEnabled'
            ? { accountEnabled: config.action.enabled }
            : undefined,
        });
        const connector = await ctx.getM365Connector(identity.linkId);
        const result = await connector.operations.execute(request);
        if (!config.operation.successStatusCodes.includes(result.status)) {
          return {
            outcome: 'fail',
            errorClass: 'vendor_error',
            message: `Graph returned unexpected status ${result.status} for ${config.name}.`,
          };
        }
        return { outcome: 'success', outputs: { externalId: identity.externalId, name: identity.name } };
      } catch (error) {
        return classifyGraphError(error);
      }
    },
  });
}
