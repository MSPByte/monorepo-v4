import { CoveConnector } from "@mspbyte/connectors";
import { Encryption } from "@mspbyte/encryption";
import {
  getCoveRawSchema,
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

export const coveAdapter: IngestionAdapter = {
  providerId: PROVIDER_IDS.COVE,
  types: [ProviderFacet.CoveEndpoints],

  async *fetch(
    type,
    _mode,
    _cursor,
    context,
  ): AsyncGenerator<FetchPage, FetchResultCursor> {
    const facet = type as ProviderFacet;
    if (facet !== ProviderFacet.CoveEndpoints) {
      throw new Error(`Unsupported Cove ingestion facet: ${type}`);
    }

    const connector = createConnector(context);
    const partnerId = requirePartnerId(context);
    const rows = await connector.account.statistics(partnerId);
    yield page(facet, rows as unknown[]);
  },
};

function createConnector(context: IngestionAdapterContext): CoveConnector {
  const server = stringConfig(context, "server");
  const clientId = stringConfig(context, "clientId");
  const clientSecretEnc = stringConfig(context, "clientSecret");
  const clientSecret = Encryption.decrypt(
    clientSecretEnc,
    requireEncryptionKey(),
  );
  if (!clientSecret) {
    throw new Error(
      `Cove client secret could not be decrypted for link ${context.linkId}`,
    );
  }
  return new CoveConnector(server, clientId, clientSecret);
}

function requirePartnerId(context: IngestionAdapterContext): number {
  const raw = context.linkMeta?.externalId;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Cove linkMeta.externalId missing or invalid for link ${context.linkId}`,
    );
  }
  return parsed;
}

function stringConfig(
  context: IngestionAdapterContext,
  key: string,
): string {
  const value = context.integrationConfig?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Cove integrationConfig.${key} missing for link ${context.linkId}`,
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
  const schema = getCoveRawSchema(facet);
  if (schema) schema.parse(raw);

  const accountId = raw["AccountId"];
  if (typeof accountId !== "number" || !Number.isFinite(accountId)) {
    throw new Error("Cove record missing required numeric field AccountId");
  }

  return {
    externalId: String(accountId),
    op: "upsert",
    payload: raw,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cove record is not an object");
  }
  return value as Record<string, unknown>;
}
