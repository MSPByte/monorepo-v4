import type { Integration } from "../../../types/integration.js";
import { ProviderFacet } from "../../../types/provider.js";
import { SyncIntervals } from "../intervals.js";
import { CoveEndpointsShape } from "./shapes.js";

export const COVE_CONFIG: Integration = {
  id: "cove",
  name: "Cove",
  category: "recovery",
  scope: "site",
  supportedFacets: [
    {
      facet: ProviderFacet.CoveEndpoints,
      scopeLevel: "link",
      db: {
        table: "coveEndpoints",
        name: "Cove Endpoints",
        shape: CoveEndpointsShape,
      },
      sync: { intervalMs: SyncIntervals["12_HOURS"] },
    },
  ],
  navigation: [{ label: "Endpoints", route: "/endpoints", isNullable: false }],
};
