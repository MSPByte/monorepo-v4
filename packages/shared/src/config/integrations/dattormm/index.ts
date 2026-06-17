import { Integration } from "../../../types/integration.js";
import { ProviderFacet } from "../../../types/provider.js";
import { SyncIntervals } from "../intervals.js";

export const DATTO_RMM_CONFIG: Integration = {
  id: "dattormm",
  name: "DattoRMM",
  category: "rmm",
  scope: "site",
  supportedFacets: [
    {
      facet: ProviderFacet.DattoEndpoints,
      scopeLevel: "link",
      db: { table: "dattoEndpoints", name: "Datto Endpoints", shape: {} },
      sync: { intervalMs: SyncIntervals["24_HOURS"] },
    },
  ],
  navigation: [{ label: "Endpoints", route: "/endpoints", isNullable: false }],
};
