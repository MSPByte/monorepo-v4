import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inputs = z.object({
  // Either a UUID of an existing MSPByte site (select existing) or a name string
  // (create new). The handler discriminates by UUID format.
  site: z.string().min(1).max(200),
});

const outputs = z.object({
  siteId: z.string(),
  siteName: z.string(),
  // Whether a new site was created vs an existing one was selected.
  created: z.boolean(),
});

export const coreSiteProvision: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'core.site.provision',
  vendor: 'core',
  name: 'Provision MSPByte Site',
  description:
    'Creates a new MSPByte site or selects an existing one. Use this as the first step in ' +
    'onboarding packages so downstream vendor steps receive the site ID via priorOutput. ' +
    'Use the entity binding to select an existing site, or literal/runtime to type a new site name.',
  category: 'site',
  inputs,
  outputs,
  inputMeta: {
    site: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'site',
      typeHint: 'text',
      label: 'Site',
      description: 'Select an existing MSPByte site, or type a new site name to create one.',
      required: true,
    },
  },
  outputMeta: {
    siteId: { label: 'Site ID', outputType: 'mspbyte.siteId' },
    siteName: { label: 'Site name', outputType: 'mspbyte.siteName' },
    created: { label: 'Created' },
  },
  actionLabel: ActionLabels.CoreSiteProvision,
  auditAction: 'create',
  requiredPermission: 'Sites.Write',
  defaultUnitPrice: 0,
  async handler(ctx, input) {
    if (UUID_RE.test(input.site)) {
      // Entity binding resolved to a site UUID — use existing site.
      const site = await ctx.lookupSite(input.site);
      if (!site) {
        return {
          outcome: 'fail',
          errorClass: 'not_found',
          message: `Site ${input.site} not found`,
        };
      }
      return {
        outcome: 'success',
        outputs: { siteId: site.id, siteName: site.name, created: false },
      };
    }

    // Literal/runtime binding provided a name — create a new site.
    try {
      const site = await ctx.createSite(input.site);
      return {
        outcome: 'success',
        outputs: { siteId: site.id, siteName: site.name, created: true },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { outcome: 'fail', errorClass: 'vendor_error', message };
    }
  },
};
