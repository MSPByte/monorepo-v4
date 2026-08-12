import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  endpointId: z.uuid(),
});

const outputs = z.object({
  endpointId: z.string(),
  hostname: z.string(),
});

export const sophosEndpointDelete: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'sophos.endpoint.delete',
  vendor: 'sophos-partner',
  name: 'Delete Sophos Endpoint',
  description: 'Removes a Sophos endpoint from the Sophos console.',
  category: 'device',
  inputs,
  outputs,
  inputMeta: {
    endpointId: {
      allowedBindings: ['entity', 'runtime'],
      entityType: 'sophos_endpoint',
      typeHint: 'text',
      label: 'Endpoint',
      description: 'The Sophos endpoint to delete.',
      required: true,
    },
  },
  outputMeta: {
    endpointId: { label: 'Endpoint ID' },
    hostname: { label: 'Hostname' },
  },
  actionLabel: ActionLabels.SophosEndpointDelete,
  auditAction: 'delete',
  requiredPermission: 'Vendors.Delete',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    const endpoint = await ctx.loadSophosEndpoint(input.endpointId);
    if (!endpoint) {
      return { outcome: 'fail', errorClass: 'not_found', message: `Sophos endpoint ${input.endpointId} not found` };
    }
    if (!endpoint.tenantId) {
      return { outcome: 'fail', errorClass: 'invalid_input', message: 'Endpoint has no associated Sophos tenant' };
    }
    if (!endpoint.apiHost) {
      return { outcome: 'fail', errorClass: 'invalid_input', message: 'Endpoint has no API host configured' };
    }

    try {
      const connector = await ctx.getSophosConnector(endpoint.linkId);
      await connector.endpoint.delete(endpoint.apiHost, endpoint.tenantId, endpoint.externalId);
      return {
        outcome: 'success',
        outputs: {
          endpointId: endpoint.id,
          hostname: endpoint.hostname,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(' 404')) {
        return { outcome: 'skip', reason: `Endpoint ${endpoint.hostname} not found in Sophos (already deleted)` };
      }
      let errorClass: 'permission_denied' | 'rate_limited' | 'vendor_error' = 'vendor_error';
      if (message.includes(' 403') || message.toLowerCase().includes('forbidden')) errorClass = 'permission_denied';
      else if (message.includes(' 429')) errorClass = 'rate_limited';
      return {
        outcome: 'fail',
        errorClass,
        message,
        retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error',
      };
    }
  },
};
