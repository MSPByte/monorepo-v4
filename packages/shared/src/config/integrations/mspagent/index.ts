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
  info: {
    summary: 'MSPAgent connects MSPByte-managed agents to their devices, logs, and automation activity.',
    manages: ['Agent inventory and health', 'Agent logs', 'Agent-generated tickets'],
    requirements: ['Install and enroll an MSPAgent on each managed device.']
  },
  linkMetaSchema: passthroughLinkMetaSchema,
  linkMetaVersion: MSPAGENT_LINK_META_VERSION,
};
