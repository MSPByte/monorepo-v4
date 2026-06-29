import type { Integration } from "../../../types/integration.js";
import { ProviderFacet } from "../../../types/provider.js";
import { SyncIntervals } from "../intervals.js";

export const HALOPSA_CONFIG: Integration = {
  id: "halopsa",
  name: "HaloPSA",
  category: "psa",
  scope: "site",
  supportedFacets: [
    {
      facet: ProviderFacet.HaloPsaRecurringItems,
      scopeLevel: "link",
      db: { table: "haloPsaRecurringItems", name: "HaloPSA Recurring Items", shape: {} },
      sync: { intervalMs: SyncIntervals["24_HOURS"] },
    },
  ],
  navigation: [{ label: "Recurring Items", route: "/recurring-items", isNullable: false }],
};
