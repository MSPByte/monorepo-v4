import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  endpointId: z.uuid(),
});

const outputs = z.object({
  externalId: z.string(),
  internalId: z.string(),
  name: z.string(),
});

export const sophosEndpointEnableTamper: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'sophos.endpoint.enableTamper',
  vendor: 'sophos-partner',
  name: 'Enable Sophos Tamper Protection',
  description: 'Enables tamper protection on a Sophos-managed endpoint.',
  category: 'device',
  inputs,
  outputs,
  inputMeta: {
    endpointId: {
      allowedBindings: ['entity', 'runtime'],
      entityType: 'sophos_endpoint',
      typeHint: 'text',
      label: 'Endpoint',
      description: 'The Sophos endpoint to enable tamper protection on.',
      required: true,
    },
  },
  outputMeta: {
    externalId: { label: 'Sophos endpoint ID', outputType: 'sophos.endpointId' },
    internalId: { label: 'Internal endpoint ID', outputType: 'sophos.endpointInternalId' },
    name: { label: 'Hostname' },
  },
  actionLabel: ActionLabels.SophosEndpointTamperEnable,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    const endpoint = await ctx.loadSophosEndpoint(input.endpointId);
    if (!endpoint) {
      return { outcome: 'fail', errorClass: 'not_found', message: `Sophos endpoint ${input.endpointId} not found` };
    }
    if (endpoint.tamperProtectionEnabled) {
      return {
        outcome: 'skip',
        reason: `Tamper protection already enabled on ${endpoint.hostname}`,
      };
    }
    if (!endpoint.tenantId) {
      return { outcome: 'fail', errorClass: 'invalid_input', message: 'Endpoint has no associated Sophos tenant' };
    }
    if (!endpoint.apiHost) {
      return { outcome: 'fail', errorClass: 'invalid_input', message: 'Endpoint has no API host configured' };
    }

    try {
      const connector = await ctx.getSophosConnector(endpoint.linkId);
      await connector.endpoint.tamperProtection.toggle(endpoint.apiHost, endpoint.tenantId, endpoint.externalId, true);
      return {
        outcome: 'success',
        outputs: {
          externalId: endpoint.externalId,
          internalId: endpoint.id,
          name: endpoint.hostname,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let errorClass: 'permission_denied' | 'rate_limited' | 'not_found' | 'vendor_error' = 'vendor_error';
      if (message.includes(' 403') || message.toLowerCase().includes('forbidden')) errorClass = 'permission_denied';
      else if (message.includes(' 429')) errorClass = 'rate_limited';
      else if (message.includes(' 404')) errorClass = 'not_found';
      return {
        outcome: 'fail',
        errorClass,
        message,
        retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error',
      };
    }
  },
};
