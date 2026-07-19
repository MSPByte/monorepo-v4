import type { ProviderFacet, ProviderId } from "@mspbyte/shared";

export type SyncMode = "full" | "incremental";
export type RawRecordOp = "upsert" | "delete";

export type IngestionFacet = ProviderFacet | (string & {});
export type IngestionProviderId = ProviderId | (string & {});

export type IngestionJobData = {
  orgId: string;
  linkId: string;
  siteId?: string;
  integrationId: IngestionProviderId;
  provider: IngestionProviderId;
  type: IngestionFacet;
  syncRunId: string;
  mode: SyncMode;
  cursor?: string;
  linkMeta?: Record<string, unknown>;
  integrationConfig?: Record<string, unknown>;
};

export type ProjectionJobData = {
  orgId: string;
  linkId: string;
  siteId?: string;
  provider: IngestionProviderId;
  type: IngestionFacet;
  syncRunId: string;
  rawBatchId: string;
};

export type NormalizeJobData = {
  orgId: string;
  linkId: string;
  siteId?: string;
  provider: IngestionProviderId;
  type: IngestionFacet;
  syncRunId: string;
};

export type PolicyJobData = {
  orgId: string;
  linkId: string;
  siteId?: string;
  provider: IngestionProviderId;
  type: IngestionFacet;
  syncRunId: string;
};

export type RawRecordEnvelope<TPayload = unknown> = {
  externalId: string;
  op?: RawRecordOp;
  schemaVersion?: string;
  payload: TPayload;
};

export type FetchPage<TPayload = unknown> = {
  records: Array<RawRecordEnvelope<TPayload>>;
  cursorIn?: string;
  cursorOut?: string;
};

export type FetchResultCursor = string | undefined | void;

export type IngestionAdapterContext = {
  orgId: string;
  linkId: string;
  linkMeta?: Record<string, unknown>;
  integrationConfig?: Record<string, unknown>;
  tenantDb?: unknown;
};

export type ResolveLinkMetaContext = {
  orgId: string;
  linkId: string;
  externalId: string;
  currentMeta: Record<string, unknown> | null;
  integrationConfig?: Record<string, unknown>;
  tenantDb?: unknown;
};

export interface IngestionAdapter<TPayload = unknown> {
  readonly providerId: string;
  readonly types: IngestionFacet[];
  fetch(
    type: IngestionFacet,
    mode: SyncMode,
    cursor: string | undefined,
    context: IngestionAdapterContext,
  ): AsyncGenerator<FetchPage<TPayload>, FetchResultCursor>;
  /**
   * Re-derives the link's meta from the vendor when the stored schema version
   * is stale. Optional: vendors whose meta is user-entered (no vendor source of
   * truth) can omit this and rely on the frontend to keep meta current on save.
   */
  resolveLinkMeta?(
    context: ResolveLinkMetaContext,
  ): Promise<Record<string, unknown>>;
}
