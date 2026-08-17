import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability, SophosEndpointRow } from '../types.js';

const inputs = z.object({
  endpointIds: z.array(z.uuid()).min(1).max(10_000)
});

const outputs = z.object({
  requestedEndpointNames: z.array(z.string()),
  skippedEndpointNames: z.array(z.string())
});

function classifyError(
  message: string
): 'permission_denied' | 'rate_limited' | 'not_found' | 'vendor_error' {
  if (message.includes(' 403') || message.toLowerCase().includes('forbidden'))
    return 'permission_denied';
  if (message.includes(' 429')) return 'rate_limited';
  if (message.includes(' 404')) return 'not_found';
  return 'vendor_error';
}

export const sophosEndpointUpgrade: Capability<z.infer<typeof inputs>, z.infer<typeof outputs>> = {
  id: 'sophos.endpoint.upgrade',
  vendor: 'sophos-partner',
  name: 'Upgrade Sophos Endpoints',
  description: 'Requests the available Sophos device software upgrade for one or more endpoints.',
  category: 'device',
  inputs,
  outputs,
  inputMeta: {
    endpointIds: {
      allowedBindings: ['entity', 'runtime'],
      entityType: 'sophos_endpoint',
      valueType: 'sophos_endpoint',
      typeHint: 'stringArray',
      label: 'Endpoints',
      description: 'Choose one or more endpoints with an available software upgrade.',
      required: true
    }
  },
  outputMeta: {
    requestedEndpointNames: { label: 'Upgrade requested for', valueType: 'text_list' },
    skippedEndpointNames: { label: 'Skipped endpoints', valueType: 'text_list' }
  },
  actionLabel: ActionLabels.SophosEndpointUpgrade,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    const endpoints: SophosEndpointRow[] = [];
    const skippedEndpointNames: string[] = [];

    for (const endpointId of [...new Set(input.endpointIds)]) {
      const endpoint = await ctx.loadSophosEndpoint(endpointId);
      if (!endpoint) {
        return {
          outcome: 'fail',
          errorClass: 'not_found',
          message: `Sophos endpoint ${endpointId} not found`
        };
      }
      if (!endpoint.needsUpgrade) {
        skippedEndpointNames.push(endpoint.hostname);
        continue;
      }
      if (!endpoint.tenantId || !endpoint.apiHost) {
        return {
          outcome: 'fail',
          errorClass: 'invalid_input',
          message: `${endpoint.hostname} is missing Sophos tenant configuration.`
        };
      }
      endpoints.push(endpoint);
    }

    if (endpoints.length === 0) {
      return {
        outcome: 'skip',
        reason: 'No selected endpoints have an available Sophos software upgrade.'
      };
    }

    const byLink = new Map<string, SophosEndpointRow[]>();
    for (const endpoint of endpoints) {
      const group = byLink.get(endpoint.linkId) ?? [];
      group.push(endpoint);
      byLink.set(endpoint.linkId, group);
    }

    const requestedEndpointNames: string[] = [];
    for (const siteEndpoints of byLink.values()) {
      const first = siteEndpoints[0]!;
      try {
        const connector = await ctx.getSophosConnector(first.linkId);
        await connector.endpoint.upgradeDeviceSoftware(
          first.apiHost!,
          first.tenantId!,
          siteEndpoints.map((endpoint) => endpoint.externalId)
        );
        await ctx.markSophosEndpointsUpgraded(siteEndpoints.map((endpoint) => endpoint.id));
        requestedEndpointNames.push(...siteEndpoints.map((endpoint) => endpoint.hostname));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorClass = classifyError(message);
        return {
          outcome: 'fail',
          errorClass,
          message: `Requested upgrades for ${requestedEndpointNames.length} endpoint(s), then ${first.hostname}'s site failed: ${message}`,
          retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error'
        };
      }
    }

    return { outcome: 'success', outputs: { requestedEndpointNames, skippedEndpointNames } };
  }
};
