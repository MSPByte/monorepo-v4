import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  // One endpoint is deliberately represented as a one-item selection. That
  // gives package authors one capability whether an operator acts on one
  // endpoint or a selected set, without adding graph-level loop semantics.
  endpointIds: z.array(z.uuid()).min(1).max(200),
  enabled: z.boolean(),
});

const outputs = z.object({
  changedEndpointNames: z.array(z.string()),
  unchangedEndpointNames: z.array(z.string()),
});

export const sophosEndpointToggleTamper: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'sophos.endpoint.toggleTamper',
  vendor: 'sophos-partner',
  name: 'Toggle Sophos Tamper Protection',
  description:
    'Sets tamper protection on or off for one or more selected Sophos-managed endpoints.',
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
      description: 'Choose one or more endpoints to update.',
      required: true,
    },
    enabled: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      valueType: 'boolean',
      typeHint: 'boolean',
      label: 'Tamper protection enabled',
      description: 'Turn tamper protection on or off for every selected endpoint.',
      required: true,
      defaultValue: true,
    },
  },
  outputMeta: {
    changedEndpointNames: { label: 'Updated endpoints', valueType: 'text_list' },
    unchangedEndpointNames: { label: 'Endpoints already in the requested state', valueType: 'text_list' },
  },
  actionLabel: ActionLabels.SophosEndpointTamperSet,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    const changedEndpointNames: string[] = [];
    const unchangedEndpointNames: string[] = [];
    const requestedState = input.enabled ? 'enabled' : 'disabled';

    for (const endpointId of input.endpointIds) {
      const endpoint = await ctx.loadSophosEndpoint(endpointId);
      if (!endpoint) {
        return {
          outcome: 'fail',
          errorClass: 'not_found',
          message: `Updated ${changedEndpointNames.length} endpoint(s), then could not find selected endpoint ${endpointId}.`,
        };
      }
      if (endpoint.tamperProtectionEnabled === input.enabled) {
        unchangedEndpointNames.push(endpoint.hostname);
        continue;
      }
      if (!endpoint.tenantId || !endpoint.apiHost) {
        return {
          outcome: 'fail',
          errorClass: 'invalid_input',
          message: `Updated ${changedEndpointNames.length} endpoint(s), then ${endpoint.hostname} was missing Sophos tenant configuration.`,
        };
      }

      try {
        const connector = await ctx.getSophosConnector(endpoint.linkId);
        await connector.endpoint.tamperProtection.toggle(
          endpoint.apiHost,
          endpoint.tenantId,
          endpoint.externalId,
          input.enabled,
        );
        changedEndpointNames.push(endpoint.hostname);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        let errorClass: 'permission_denied' | 'rate_limited' | 'not_found' | 'vendor_error' = 'vendor_error';
        if (message.includes(' 403') || message.toLowerCase().includes('forbidden')) errorClass = 'permission_denied';
        else if (message.includes(' 429')) errorClass = 'rate_limited';
        else if (message.includes(' 404')) errorClass = 'not_found';
        return {
          outcome: 'fail',
          errorClass,
          message: `Updated ${changedEndpointNames.length} endpoint(s), then ${endpoint.hostname} failed to be ${requestedState}: ${message}`,
          retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error',
        };
      }
    }

    if (changedEndpointNames.length === 0) {
      return {
        outcome: 'skip',
        reason: `Tamper protection was already ${requestedState} on every selected endpoint.`,
      };
    }
    return { outcome: 'success', outputs: { changedEndpointNames, unchangedEndpointNames } };
  },
};

// Saved packages created before the toggle capability existed continue to run.
// These adapters are intentionally hidden from the authoring catalog; new
// packages only ever see `sophos.endpoint.toggleTamper`.
const legacySingleInputs = z.object({ endpointId: z.uuid() });
const legacySingleOutputs = z.object({
  externalId: z.string(),
  internalId: z.string(),
  name: z.string(),
});

function legacySingleToggle(
  id: string,
  enabled: boolean,
): Capability<z.infer<typeof legacySingleInputs>, z.infer<typeof legacySingleOutputs>> {
  return {
    id,
    hidden: true,
    vendor: 'sophos-partner',
    name: 'Legacy Sophos tamper protection action',
    description: 'Compatibility bridge for a saved package.',
    category: 'device',
    inputs: legacySingleInputs,
    outputs: legacySingleOutputs,
    inputMeta: {},
    outputMeta: {},
    actionLabel: enabled ? ActionLabels.SophosEndpointTamperEnable : ActionLabels.SophosEndpointTamperDisable,
    auditAction: 'update',
    requiredPermission: 'Vendors.Write',
    defaultUnitPrice: 0,
    async handler(ctx, input) {
      const result = await sophosEndpointToggleTamper.handler(ctx, {
        endpointIds: [input.endpointId],
        enabled,
      });
      if (result.outcome !== 'success') return result;
      const endpoint = await ctx.loadSophosEndpoint(input.endpointId);
      if (!endpoint) {
        return { outcome: 'fail', errorClass: 'not_found', message: `Sophos endpoint ${input.endpointId} not found` };
      }
      return {
        outcome: 'success',
        outputs: { externalId: endpoint.externalId, internalId: endpoint.id, name: endpoint.hostname },
      };
    },
  };
}

export const legacySophosEndpointEnableTamper = legacySingleToggle(
  'sophos.endpoint.enableTamper',
  true,
);
export const legacySophosEndpointDisableTamper = legacySingleToggle(
  'sophos.endpoint.disableTamper',
  false,
);

const legacySelectionInputs = z.object({ endpointIds: z.array(z.uuid()).min(1).max(200) });
const legacySelectionOutputs = z.object({
  enabledEndpointNames: z.array(z.string()),
  skippedEndpointNames: z.array(z.string()),
});

export const legacySophosEndpointsEnableTamper: Capability<
  z.infer<typeof legacySelectionInputs>,
  z.infer<typeof legacySelectionOutputs>
> = {
  id: 'sophos.endpoint.enableTamperSelection',
  hidden: true,
  vendor: 'sophos-partner',
  name: 'Legacy Sophos tamper protection action',
  description: 'Compatibility bridge for a saved package.',
  category: 'device',
  inputs: legacySelectionInputs,
  outputs: legacySelectionOutputs,
  inputMeta: {},
  outputMeta: {},
  actionLabel: ActionLabels.SophosEndpointTamperEnable,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    const result = await sophosEndpointToggleTamper.handler(ctx, { ...input, enabled: true });
    if (result.outcome !== 'success') return result;
    return {
      outcome: 'success',
      outputs: {
        enabledEndpointNames: result.outputs.changedEndpointNames,
        skippedEndpointNames: result.outputs.unchangedEndpointNames,
      },
    };
  },
};
