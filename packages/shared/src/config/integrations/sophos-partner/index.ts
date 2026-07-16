import type { Integration } from "../../../types/integration.js";
import { ProviderFacet } from "../../../types/provider.js";
import { SyncIntervals } from "../intervals.js";
import {
  SophosEndpointsShape,
  SophosFirewallsShape,
  SophosLicensesShape,
} from "./shapes.js";

export const SOPHOS_PARTNER_CONFIG: Integration = {
  id: "sophos-partner",
  name: "Sophos Partner",
  category: "security",
  scope: "site",
  supportedFacets: [
    {
      facet: ProviderFacet.SophosEndpoints,
      scopeLevel: "link",
      db: {
        table: "sophosEndpoints",
        name: "Sophos Endpoints",
        shape: SophosEndpointsShape,
      },
      sync: { intervalMs: SyncIntervals["4_HOURS"] },
    },
    {
      facet: ProviderFacet.SophosFirewalls,
      scopeLevel: "link",
      db: {
        table: "sophosFirewalls",
        name: "Sophos Firewalls",
        shape: SophosFirewallsShape,
      },
      sync: { intervalMs: SyncIntervals["24_HOURS"] },
    },
    {
      facet: ProviderFacet.SophosLicenses,
      scopeLevel: "link",
      db: {
        table: "sophosLicenses",
        name: "Sophos Licenses",
        shape: SophosLicensesShape,
      },
      sync: { intervalMs: SyncIntervals["24_HOURS"] },
    },
    {
      facet: ProviderFacet.SophosTamperProtection,
      scopeLevel: "link",
      db: {
        table: "sophosTamperProtection",
        name: "Sophos Tamper Protection",
        shape: {},
      },
      sync: {
        intervalMs: SyncIntervals["4_HOURS"],
        dependencies: [ProviderFacet.SophosEndpoints],
      },
    },
  ],
  navigation: [
    { label: "Endpoints", route: "/endpoints", isNullable: false },
    { label: "Firewalls", route: "/firewalls", isNullable: false },
    { label: "Licenses", route: "/licenses", isNullable: false },
  ],
};
