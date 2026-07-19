import type { z } from "zod";
import type { ProviderFacet, ProviderId } from "./provider.js";
import type { SchemaFields } from "./schema-registry.js";

export type IntegrationCategory =
  | "psa"
  | "rmm"
  | "recovery"
  | "security"
  | "identity"
  | "other";
export type IntegrationScope = "site" | "link";

export type DbRoute = {
  table: string;
  name: string;
  shape: SchemaFields;
};

export type FacetSyncConfig = {
  enabled?: boolean;
  intervalMs?: number;
  fullIntervalMs?: number;
  incrementalIntervalMs?: number;
  supportsIncremental?: boolean;
  dependencies?: ProviderFacet[];
};

export type IngestTypeConfig = {
  facet: ProviderFacet;
  scopeLevel: IntegrationScope;
  db?: DbRoute;
  sync?: FacetSyncConfig;
};

export type IntegrationNavItem = {
  label: string;
  route: string;
  isNullable: boolean;
};

export const META_VERSION_KEY = "_v" as const;

export type LinkMeta = Record<string, unknown> & { [META_VERSION_KEY]?: number };

export type Integration = {
  id: ProviderId;
  name: string;
  category: IntegrationCategory;
  scope: IntegrationScope;
  supportedFacets: IngestTypeConfig[];
  navigation: IntegrationNavItem[];
  linkMetaSchema: z.ZodTypeAny;
  linkMetaVersion: number;
};
