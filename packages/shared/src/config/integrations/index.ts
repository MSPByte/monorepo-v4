import { M365_INTEGRATION_CONFIG } from "./microsoft-365/index.js";
import { SOPHOS_PARTNER_CONFIG } from "./sophos-partner/index.js";
import { DATTO_RMM_CONFIG } from "./dattormm/index.js";
import { COVE_CONFIG } from "./cove/index.js";
import { MSPAGENT_CONFIG } from "./mspagent/index.js";
import { HALOPSA_CONFIG } from "./halopsa/index.js";
import type {
  Integration,
  DbRoute,
  IngestTypeConfig,
} from "../../types/integration.js";
import { ProviderFacet } from "../../types/provider.js";
import type { ProviderId } from "../../types/provider.js";
import type { SchemaFields } from "../../types/schema-registry.js";

export { M365_INTEGRATION_CONFIG } from "./microsoft-365/index.js";
export { M365PoliciesShape } from "./microsoft-365/policies.js";
export {
  CAPABILITY_PLANS,
  CONSENT_VERSION,
  REQUIRED_DIRECTORY_ROLES,
} from "./microsoft-365/index.js";
export { SOPHOS_PARTNER_CONFIG } from "./sophos-partner/index.js";
export { DATTO_RMM_CONFIG } from "./dattormm/index.js";
export { COVE_CONFIG } from "./cove/index.js";
export { MSPAGENT_CONFIG } from "./mspagent/index.js";
export { HALOPSA_CONFIG } from "./halopsa/index.js";

export const INTEGRATIONS: Record<ProviderId, Integration> = {
  "microsoft-365": M365_INTEGRATION_CONFIG,
  "sophos-partner": SOPHOS_PARTNER_CONFIG,
  dattormm: DATTO_RMM_CONFIG,
  cove: COVE_CONFIG,
  mspagent: MSPAGENT_CONFIG,
  halopsa: HALOPSA_CONFIG,
};

export function getIntegration(id: ProviderId): Integration {
  return INTEGRATIONS[id];
}

export function getAllDbRoutedFacets(): {
  providerId: ProviderId;
  facet: ProviderFacet;
  db: DbRoute;
}[] {
  return Object.values(INTEGRATIONS).flatMap((integration) =>
    integration.supportedFacets
      .filter((t): t is IngestTypeConfig & { db: DbRoute } => t.db != null)
      .map((t) => ({
        providerId: integration.id,
        facet: t.facet,
        db: t.db,
      })),
  );
}

export function getFacetTableMap(): Map<ProviderFacet, string> {
  const map = new Map<ProviderFacet, string>();
  for (const integration of Object.values(INTEGRATIONS)) {
    for (const t of integration.supportedFacets) {
      if (t.db?.table) {
        map.set(t.facet, t.db.table);
      }
    }
  }
  return map;
}

export function getFacetRoute(facet: ProviderFacet): DbRoute | undefined {
  for (const integration of Object.values(INTEGRATIONS)) {
    const found = integration.supportedFacets.find((f) => f.facet === facet);
    if (found?.db) return found.db;
  }
  return undefined;
}

export function getFacetShape(facet: ProviderFacet): SchemaFields {
  return getFacetRoute(facet)?.shape ?? {};
}

export function getFacetByTable(
  table: string,
): { providerId: ProviderId; facet: ProviderFacet; db: DbRoute } | undefined {
  for (const integration of Object.values(INTEGRATIONS)) {
    const found = integration.supportedFacets.find(
      (f) => f.db?.table === table,
    );
    if (found?.db) {
      return { providerId: integration.id, facet: found.facet, db: found.db };
    }
  }
  return undefined;
}
