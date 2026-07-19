import type { Integration } from "../../../types/integration.js";
import { ProviderFacet } from "../../../types/provider.js";
import { SyncIntervals } from "../intervals.js";
import { passthroughLinkMetaSchema } from "../link-meta-passthrough.js";
import { DattoEndpointsShape } from "./shapes.js";

const DATTO_RMM_LINK_META_VERSION = 1;

export const DATTO_RMM_CONFIG: Integration = {
  id: "dattormm",
  name: "DattoRMM",
  category: "rmm",
  scope: "site",
  supportedFacets: [
    {
      facet: ProviderFacet.DattoEndpoints,
      scopeLevel: "link",
      db: {
        table: "dattoEndpoints",
        name: "Datto Endpoints",
        shape: DattoEndpointsShape,
      },
      sync: { intervalMs: SyncIntervals["24_HOURS"] },
    },
  ],
  navigation: [{ label: "Endpoints", route: "/endpoints", isNullable: false }],
  linkMetaSchema: passthroughLinkMetaSchema,
  linkMetaVersion: DATTO_RMM_LINK_META_VERSION,
};
