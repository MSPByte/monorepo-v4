import { SophosConnector } from "@mspbyte/connectors";
import { sophosEndpoints } from "@mspbyte/drizzle";
import { Encryption } from "@mspbyte/encryption";
import {
  getSophosRawSchema,
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
import { eq } from "drizzle-orm";
import { requireEncryptionKey } from "../../env.js";
import { logger } from "../../logger.js";
import { serializeError } from "../../errors.js";

const TAMPER_PROTECTION_REQUEST_DELAY_MS = 150;
const TAMPER_PROTECTION_BATCH_SIZE = 100;

type SophosEndpointRow = { id: string; externalId: string };

export const sophosAdapter: IngestionAdapter = {
  providerId: PROVIDER_IDS.SOPHOS,
  types: [
    ProviderFacet.SophosEndpoints,
    ProviderFacet.SophosFirewalls,
    ProviderFacet.SophosLicenses,
    ProviderFacet.SophosTamperProtection,
  ],

  async *fetch(
    type,
    _mode,
    _cursor,
    context,
  ): AsyncGenerator<FetchPage, FetchResultCursor> {
    const facet = type as ProviderFacet;
    const connector = createConnector(context);

    switch (facet) {
      case ProviderFacet.SophosEndpoints:
        return yield* fetchEndpoints(connector, context);
      case ProviderFacet.SophosFirewalls:
        return yield* fetchFirewalls(connector, context);
      case ProviderFacet.SophosLicenses:
        return yield* fetchLicenses(connector, context);
      case ProviderFacet.SophosTamperProtection:
        return yield* fetchTamperProtection(connector, context);
      default:
        throw new Error(`Unsupported Sophos ingestion facet: ${type}`);
    }
  },
};

function createConnector(context: IngestionAdapterContext): SophosConnector {
  const clientId = stringConfig(context, "clientId");
  const clientSecretEnc = stringConfig(context, "clientSecret");
  const clientSecret = Encryption.decrypt(
    clientSecretEnc,
    requireEncryptionKey(),
  );
  if (!clientSecret) {
    throw new Error(
      `Sophos client secret could not be decrypted for link ${context.linkId}`,
    );
  }

  return new SophosConnector(clientId, clientSecret);
}

function getTenantId(context: IngestionAdapterContext): string | undefined {
  const tenantId = context.linkMeta?.externalId;
  return typeof tenantId === "string" && tenantId.length > 0
    ? tenantId
    : undefined;
}

function requireApiHost(context: IngestionAdapterContext): string {
  const apiHost = context.linkMeta?.apiHost;
  if (typeof apiHost !== "string" || apiHost.length === 0) {
    throw new Error(`Sophos apiHost missing in linkMeta for link ${context.linkId}`);
  }
  return apiHost;
}

function stringConfig(
  context: IngestionAdapterContext,
  key: string,
): string {
  const value = context.integrationConfig?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Sophos integrationConfig.${key} missing for link ${context.linkId}`,
    );
  }
  return value;
}

async function* fetchEndpoints(
  connector: SophosConnector,
  context: IngestionAdapterContext,
): AsyncGenerator<FetchPage> {
  const apiHost = requireApiHost(context);
  const tenantId = getTenantId(context);
  const endpoints = await connector.endpoint.list(apiHost, tenantId);
  yield page(ProviderFacet.SophosEndpoints, endpoints);
}

async function* fetchFirewalls(
  connector: SophosConnector,
  context: IngestionAdapterContext,
): AsyncGenerator<FetchPage> {
  const apiHost = requireApiHost(context);
  const tenantId = getTenantId(context);
  const firewalls = (await connector.firewall.list(apiHost, tenantId)) as Array<
    Record<string, unknown>
  >;

  const upgradeMap = new Map<string, string | null>();
  if (firewalls.length > 0 && tenantId) {
    try {
      const ids = firewalls
        .map((fw) => (typeof fw.id === "string" ? fw.id : null))
        .filter((id): id is string => id != null);
      const results = await connector.firewall.firmwareUpgradeCheck(
        apiHost,
        tenantId,
        ids,
      );
      for (const fw of results) {
        if (fw.id) upgradeMap.set(fw.id, fw.upgradeToVersion?.[0] ?? null);
      }
    } catch (error) {
      logger.warn(
        "Sophos firmware upgrade check failed, continuing without upgrade info",
        {
          linkId: context.linkId,
          error: serializeError(error),
        },
      );
    }
  }

  const records = firewalls.map((fw) => ({
    ...fw,
    _upgrade_to_version:
      typeof fw.id === "string" ? (upgradeMap.get(fw.id) ?? null) : null,
  }));
  yield page(ProviderFacet.SophosFirewalls, records);
}

async function* fetchLicenses(
  connector: SophosConnector,
  context: IngestionAdapterContext,
): AsyncGenerator<FetchPage> {
  const tenantId = getTenantId(context);
  const licenses = await connector.license.list(tenantId);
  yield page(ProviderFacet.SophosLicenses, licenses);
}

async function* fetchTamperProtection(
  connector: SophosConnector,
  context: IngestionAdapterContext,
): AsyncGenerator<FetchPage> {
  const apiHost = requireApiHost(context);
  const tenantId = getTenantId(context);
  if (!tenantId) {
    throw new Error(
      `Sophos tenant externalId missing in linkMeta for link ${context.linkId}`,
    );
  }
  if (!context.tenantDb) {
    throw new Error(
      `Sophos tenant DB missing for tamper protection fetch on link ${context.linkId}`,
    );
  }

  const db = context.tenantDb as any;
  const rows: SophosEndpointRow[] = await db
    .select({
      id: sophosEndpoints.id,
      externalId: sophosEndpoints.externalId,
    })
    .from(sophosEndpoints)
    .where(eq(sophosEndpoints.linkId, context.linkId));

  let batch: Record<string, unknown>[] = [];
  for (const endpoint of rows) {
    try {
      const tamperProtection = await connector.endpoint.tamperProtection.get(
        apiHost,
        tenantId,
        endpoint.externalId,
      );
      batch.push({
        _endpoint_id: endpoint.id,
        _endpoint_external_id: endpoint.externalId,
        password: tamperProtection.password,
        previousPasswords: normalizePreviousPasswords(
          tamperProtection.previousPasswords,
        ),
      });

      if (batch.length >= TAMPER_PROTECTION_BATCH_SIZE) {
        yield page(ProviderFacet.SophosTamperProtection, batch);
        batch = [];
      }
    } catch (error) {
      logger.warn("Sophos tamper protection fetch failed for endpoint", {
        linkId: context.linkId,
        endpointId: endpoint.id,
        externalId: endpoint.externalId,
        error: serializeError(error),
      });
    }

    if (TAMPER_PROTECTION_REQUEST_DELAY_MS > 0) {
      await sleep(TAMPER_PROTECTION_REQUEST_DELAY_MS);
    }
  }

  if (batch.length > 0) {
    yield page(ProviderFacet.SophosTamperProtection, batch);
  }
}

function normalizePreviousPasswords(
  raw: unknown,
): Array<{ password: string; invalidatedAt?: string }> {
  if (Array.isArray(raw)) return raw as Array<{ password: string; invalidatedAt?: string }>;
  if (raw && typeof raw === "object") {
    return [raw as { password: string; invalidatedAt?: string }];
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function page(facet: ProviderFacet, records: unknown[]): FetchPage {
  return {
    records: records.map((record) => envelope(facet, record)),
  };
}

function envelope(facet: ProviderFacet, record: unknown): RawRecordEnvelope {
  const raw = asRecord(record);
  const schema = getSophosRawSchema(facet);
  if (schema) schema.parse(raw);

  return {
    externalId: externalId(facet, raw),
    op: "upsert",
    payload: raw,
  };
}

function externalId(
  facet: ProviderFacet,
  record: Record<string, unknown>,
): string {
  if (facet === ProviderFacet.SophosTamperProtection) {
    return stringField(record, "_endpoint_external_id");
  }

  return stringField(record, "id");
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Sophos record missing required string field ${key}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sophos record is not an object");
  }
  return value as Record<string, unknown>;
}
