import { Integration } from "../../../types/integration.js";

export const MSPAGENT_CONFIG: Integration = {
  id: "mspagent",
  name: "MSPAgent",
  category: "other",
  scope: "site",
  supportedFacets: [],
  navigation: [
    { label: "Agents", route: "/agents", isNullable: true },
    { label: "Logs", route: "/logs", isNullable: true },
    { label: "Tickets", route: "/tickets", isNullable: true },
  ],
};
