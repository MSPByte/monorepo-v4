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
export type IngestScopeLevel = "site" | "link";
export type IntegrationScope = "site" | "tenant";

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
  scopeLevel: IngestScopeLevel;
  db?: DbRoute;
  sync?: FacetSyncConfig;
};

export type IntegrationNavItem = {
  label: string;
  route: string;
  isNullable: boolean;
};

/** Product knowledge shown before and after an integration is connected. */
export type IntegrationInfo = {
  summary: string;
  manages: string[];
  requirements?: string[];
  notes?: string[];
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
  info: IntegrationInfo;
  linkMetaSchema: z.ZodTypeAny;
  linkMetaVersion: number;
};
