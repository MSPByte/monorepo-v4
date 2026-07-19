import { z } from 'zod';
import type { Integration } from '../../../types/integration.js';
import { ProviderFacet } from '../../../types/provider.js';
import { SyncIntervals } from '../intervals.js';

const HALOPSA_LINK_META_VERSION = 1;

const halopsaLinkMetaSchema = z.object({
  clientId: z.number(),
  _v: z.number().int().optional()
});

export const HALOPSA_CONFIG: Integration = {
  id: 'halopsa',
  name: 'HaloPSA',
  category: 'psa',
  scope: 'site',
  supportedFacets: [
    {
      facet: ProviderFacet.HaloPsaRecurringItems,
      scopeLevel: 'link',
      db: { table: 'haloPsaRecurringItems', name: 'HaloPSA Recurring Items', shape: {} },
      sync: { intervalMs: SyncIntervals['24_HOURS'] }
    }
  ],
  navigation: [{ label: 'Recurring Items', route: '/recurring-items', isNullable: false }],
  linkMetaSchema: halopsaLinkMetaSchema,
  linkMetaVersion: HALOPSA_LINK_META_VERSION
};
