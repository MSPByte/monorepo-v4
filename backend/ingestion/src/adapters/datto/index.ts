import { DattoConnector } from "@mspbyte/connectors";
import { Encryption } from "@mspbyte/encryption";
import {
  getDattoRawSchema,
  PROVIDER_IDS,
  ProviderFacet,
} from "@mspbyte/shared";
import type {
  FetchPage,
  FetchResultCursor,
  IngestionAdapter,
  IngestionAdapterContext,
  RawRecordEnvelope,
} from "@mspbyte/pipeline";
import { requireEncryptionKey } from "../../env.js";

export const dattoAdapter: IngestionAdapter = {
  providerId: PROVIDER_IDS.DATTO,
  types: [ProviderFacet.DattoEndpoints],

  async *fetch(
    type,
    _mode,
    _cursor,
    context,
  ): AsyncGenerator<FetchPage, FetchResultCursor> {
    const facet = type as ProviderFacet;
    if (facet !== ProviderFacet.DattoEndpoints) {
      throw new Error(`Unsupported DattoRMM ingestion facet: ${type}`);
    }

    const connector = createConnector(context);
    const siteUid = requireSiteUid(context);
    const devices = await connector.site.devices(siteUid);
    yield page(facet, devices as unknown[]);
  },
};

function createConnector(context: IngestionAdapterContext): DattoConnector {
  const url = stringConfig(context, "url");
  const apiKey = stringConfig(context, "apiKey");
  const apiSecretKeyEnc = stringConfig(context, "apiSecretKey");
  const apiSecretKey = Encryption.decrypt(
    apiSecretKeyEnc,
    requireEncryptionKey(),
  );
  if (!apiSecretKey) {
    throw new Error(
      `DattoRMM apiSecretKey could not be decrypted for link ${context.linkId}`,
    );
  }
  return new DattoConnector(url, apiKey, apiSecretKey);
}

function requireSiteUid(context: IngestionAdapterContext): string {
  const siteUid = context.linkMeta?.externalId;
  if (typeof siteUid !== "string" || siteUid.length === 0) {
    throw new Error(
      `DattoRMM linkMeta.externalId missing for link ${context.linkId}`,
    );
  }
  return siteUid;
}

function stringConfig(
  context: IngestionAdapterContext,
  key: string,
): string {
  const value = context.integrationConfig?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `DattoRMM integrationConfig.${key} missing for link ${context.linkId}`,
    );
  }
  return value;
}

function page(facet: ProviderFacet, records: unknown[]): FetchPage {
  return {
    records: records.map((record) => envelope(facet, record)),
  };
}

function envelope(facet: ProviderFacet, record: unknown): RawRecordEnvelope {
  const raw = asRecord(record);
  const schema = getDattoRawSchema(facet);
  if (schema) schema.parse(raw);

  const uid = raw["uid"];
  if (typeof uid !== "string" || uid.length === 0) {
    throw new Error("DattoRMM record missing required string field uid");
  }

  return {
    externalId: uid,
    op: "upsert",
    payload: raw,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DattoRMM record is not an object");
  }
  return value as Record<string, unknown>;
}
