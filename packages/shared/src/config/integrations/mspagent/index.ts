import type { Integration } from "../../../types/integration.js";
import { passthroughLinkMetaSchema } from "../link-meta-passthrough.js";

const MSPAGENT_LINK_META_VERSION = 1;

export const MSPAGENT_CONFIG: Integration = {
  id: "mspagent",
  name: "MSPAgent",
  category: "other",
  scope: "site",
  supportedFacets: [],
  navigation: [
    { label: "Agents", route: "/agents", isNullable: false },
    { label: "Logs", route: "/logs", isNullable: false },
    { label: "Tickets", route: "/tickets", isNullable: false },
  ],
  linkMetaSchema: passthroughLinkMetaSchema,
  linkMetaVersion: MSPAGENT_LINK_META_VERSION,
};
