import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const inputs = z.object({
  tenantLinkId: z.uuid(),
  // Accepts EITHER our internal m365_identities.id (from an entity picker) OR
  // the Graph externalId (from a priorOutput wiring off create-identity). The
  // handler normalizes to the Graph externalId before calling Graph.
  identityId: z.string().min(1),
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
    'Assign (and optionally remove) M365 subscribed SKU licenses on a user. Picks live from the tenant\'s available SKUs.',
  category: 'license',
  inputs,
  outputs,
  inputMeta: {
    tenantLinkId: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'integration_link',
      typeHint: 'text',
      label: 'Tenant',
      description: 'Which M365 tenant to modify licenses in.',
      required: true,
    },
    identityId: {
      allowedBindings: ['entity', 'runtime', 'priorOutput', 'literal'],
      entityType: 'm365_identity',
      priorOutputCompat: ['m365.identity.create'],
      typeHint: 'text',
      label: 'User',
      description: 'Pick the user, or wire in from a previous create-user step.',
      required: true,
    },
    skuIds: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'm365_license',
      typeHint: 'stringArray',
      label: 'Licenses to assign',
      description: 'Pick from the tenant\'s active SKUs with live availability.',
      required: true,
    },
    removeSkuIds: {
      allowedBindings: ['entity', 'literal'],
      entityType: 'm365_license',
      typeHint: 'stringArray',
      label: 'Licenses to remove',
      description: 'Optional — SKUs to strip from the user in the same call.',
      required: false,
      advanced: true,
    },
  },
  outputMeta: {
    assigned: { label: 'Assigned SKU ids' },
    removed: { label: 'Removed SKU ids' },
  },
  actionLabel: ActionLabels.M365IdentityLicenseAdd,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.05,
  async handler(ctx, input) {
    // Normalize whatever the caller passed into a Graph externalId. Try our
    // internal m365_identities lookup first (uuid path from the entity
    // picker); if nothing matches, assume the input is already a Graph
    // externalId (priorOutput path from create-identity.userId).
    let externalId = input.identityId;
    try {
      const identity = await ctx.loadM365Identity(input.identityId);
      if (identity) externalId = identity.externalId;
    } catch {
      // Fall through — the input was probably a raw externalId that our
      // internal loader couldn't match. Use it as-is.
    }

    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      await connector.users_licenses.modify(externalId, input.skuIds, input.removeSkuIds);
      return {
        outcome: 'success',
        outputs: { assigned: input.skuIds, removed: input.removeSkuIds },
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
