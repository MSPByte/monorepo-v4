import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  tenantLinkId: z.uuid(),
  // Graph user id (externalId). Comes from m365.identity.create.userId via
  // priorOutput wiring, or a picker that surfaces externalId in a later phase.
  identityExternalId: z.string().min(1),
  skuIds: z.array(z.string()).min(1),
  removeSkuIds: z.array(z.string()).default([]),
});

const outputs = z.object({
  assigned: z.array(z.string()),
  removed: z.array(z.string()),
});

export const m365LicenseAssign: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.license.assign',
  vendor: 'microsoft-365',
  name: 'Assign M365 Licenses',
  description:
    "Assign (and optionally remove) M365 subscribed SKU licenses on a user by Graph user id.",
  category: 'license',
  inputs,
  outputs,
  inputMeta: {
    tenantLinkId: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'integration_link',
      typeHint: 'text',
    },
    identityExternalId: {
      allowedBindings: ['literal', 'runtime', 'priorOutput'],
      priorOutputCompat: ['m365.identity.create'],
      typeHint: 'text',
    },
    skuIds: { allowedBindings: ['literal', 'runtime'], typeHint: 'stringArray' },
    removeSkuIds: { allowedBindings: ['literal'], typeHint: 'stringArray' },
  },
  outputMeta: {
    assigned: {},
    removed: {},
  },
  actionLabel: ActionLabels.M365IdentityLicenseAdd,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.05,
  async handler(ctx, input) {
    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      await connector.users_licenses.modify(
        input.identityExternalId,
        input.skuIds,
        input.removeSkuIds,
      );
      return {
        outcome: 'success',
        outputs: { assigned: input.skuIds, removed: input.removeSkuIds },
      };
    } catch (err) {
      return {
        outcome: 'fail',
        errorClass: 'GRAPH_ERROR',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }
  },
};
